using System.IO.Compression;
using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.FilApi;
using Projekteringsverktyg.Server.KomponentApi;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;
using static Projekteringsverktyg.Server.Export.ProjektImport;

namespace Projekteringsverktyg.Server.Export;

/// <summary>
/// Kompletterar ett BEFINTLIGT projekt från en projektexport/importfil (samma ZIP-format som Exportera projektet).
/// Det som redan finns känns igen och uppdateras, det som är nytt läggs till. Inget tas bort och inget fält töms:
/// <list type="bullet">
/// <item>Komponenter känns igen på beteckning; ifyllda fält i filen ersätter projektets, I/O-punkterna ersätts om filen har några.</item>
/// <item>Listrader känns igen på lista + komponent (rader utan komponent på exakt samma innehåll); ifyllda fält ersätts.</item>
/// <item>Apparatskåp på namn, dokument (funktionstexter, driftkort …) på typ + namn, ritbordsbilder på namn,
/// kontroller på typ + namn, att göra och projektstatus på text.</item>
/// <item>Texter (projektinformation, riskanalys …) ersätts när filen har en ifylld text.</item>
/// <item>Placeringsritningen ersätts om filen har en; den tidigare sparas i ritningens historik.</item>
/// <item>Projektfiler blir en ny version om innehållet skiljer sig från senaste versionen, annars används den befintliga.</item>
/// </list>
/// Alla hänvisningar (komponent-id i listor, ritning och modulbeläggning, funktionstexternas originalfiler) pekar efteråt på projektets poster.
/// Med provkörning räknas allt ut men ingenting sparas.
/// </summary>
public static class ProjektKomplettering
{
    public sealed record Resultat(List<string> Rapport, List<string> Varningar, bool Sparad);

    public static IEndpointRouteBuilder MapProjektKompletteringEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/projekt/{projektId:guid}/komplettera", async (Guid projektId, bool? provkor, HttpRequest request, ClaimsPrincipal user,
            Behorighet beh, PvDbContext db, IFilLagring lagring, IHubContext<ProjektHub> hub, CancellationToken ct) =>
        {
            if (!await beh.KanLedaProjekt(user, projektId))
                return Results.Problem(statusCode: 403, title: "Bara projektets projektledare och Admin kan komplettera projektet från en fil.");
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId, ct)) return Results.NotFound();
            if (!request.HasFormContentType) return Fel("Skicka filen som formulär.");
            var form = await request.ReadFormAsync(ct);
            var fil = form.Files.GetFile("fil");
            if (fil is null || fil.Length == 0) return Fel("Ingen fil valdes.");

            await using var s = fil.OpenReadStream();
            ZipArchive zip;
            try { zip = new ZipArchive(s, ZipArchiveMode.Read); }
            catch (InvalidDataException) { return Fel("Filen är ingen projektexport (ZIP)."); }
            using (zip)
            {
                var av = Anvandare.Fran(user);
                try
                {
                    var r = await KompletteraAsync(zip, projektId, av, fil.FileName, provkor == true, db, lagring, ct);
                    if (r.Sparad)
                        await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad",
                            new ListaHandelse("komplettering", "andrad", new { rapport = r.Rapport }, av.Id, av.Namn), ct);
                    return Results.Ok(new { rapport = r.Rapport, varningar = r.Varningar, sparad = r.Sparad });
                }
                catch (InvalidDataException e) { return Fel(e.Message); }
            }
        }).AddEndpointFilter<ProjektAtkomst>().DisableAntiforgery();
        return app;
    }

    private static string Nyckel(string s) => s.Trim().ToUpperInvariant();

    public static async Task<Resultat> KompletteraAsync(ZipArchive zip, Guid projektId, Anvandare av, string filnamn, bool provkor,
        PvDbContext db, IFilLagring lagring, CancellationToken ct)
    {
        var post = zip.GetEntry("projekt.json") ?? throw new InvalidDataException("Zip-filen saknar projekt.json.");
        JsonDocument dok;
        try { await using var st = post.Open(); dok = await JsonDocument.ParseAsync(st, cancellationToken: ct); }
        catch (JsonException) { throw new InvalidDataException("projekt.json kunde inte läsas."); }
        using (dok)
        {
            var rot = dok.RootElement;
            if (Str(rot, "format") != "Projekteringsverktyg projektexport")
                throw new InvalidDataException("Filen är ingen projektexport från Projekteringsverktyg.");
            if (rot.TryGetProperty("formatVersion", out var fv) && fv.TryGetInt32(out var v) && v > FormatVersion)
                throw new InvalidDataException("Filen kommer från en nyare version av verktyget. Uppdatera först.");

            var projekt = await db.Projekt.FirstAsync(p => p.Id == projektId, ct);
            var rapport = new List<string>();
            var varningar = new List<string>();
            var nu = DateTimeOffset.UtcNow;

            // ---- Steg 1: känn igen det som redan finns och bygg id-kartan (filens id → projektets id) ----
            var karta = new Dictionary<Guid, Guid>();
            void Mappa(JsonElement e, Guid till) { if (e.TryGetProperty("id", out var x) && Guid.TryParse(x.GetString(), out var g)) karta[g] = till; }
            Guid NyttEllerBefintligt(JsonElement e, Guid? befintligt)
            {
                var id = befintligt ?? Guid.NewGuid();
                Mappa(e, id);
                return id;
            }
            if (rot.TryGetProperty("projekt", out var pEl)) Mappa(pEl, projektId);

            var komponenter = await db.Komponenter.Where(k => k.ProjektId == projektId).ToListAsync(ct);
            var perBeteckning = komponenter.Where(k => k.Beteckning.Trim() != "")
                .GroupBy(k => Nyckel(k.Beteckning)).ToDictionary(g => g.Key, g => g.First());
            var kompPlan = new List<(JsonElement E, Komponent? Befintlig, Guid Id)>();
            foreach (var e in Arr(rot, "komponenter"))
            {
                var bet = Nyckel(Str(e, "beteckning"));
                var bef = bet != "" && perBeteckning.TryGetValue(bet, out var k) ? k : null;
                kompPlan.Add((e, bef, NyttEllerBefintligt(e, bef?.Id)));
            }

            var skapen = await db.Skap.Where(x => x.ProjektId == projektId).ToListAsync(ct);
            var skapPlan = Arr(rot, "apparatskap").Select(e =>
            {
                var bef = skapen.FirstOrDefault(x => Nyckel(x.Namn) == Nyckel(Str(e, "namn")));
                return (E: e, Befintlig: bef, Id: NyttEllerBefintligt(e, bef?.Id));
            }).ToList();

            var dokumenten = await db.Dokument.Where(x => x.ProjektId == projektId).ToListAsync(ct);
            var dokPlan = Arr(rot, "dokument").Select(e =>
            {
                var bef = dokumenten.FirstOrDefault(x => x.Typ == Str(e, "typ") && Nyckel(x.Namn) == Nyckel(Str(e, "namn")));
                return (E: e, Befintlig: bef, Id: NyttEllerBefintligt(e, bef?.Id));
            }).ToList();

            var ritbord = await db.RitbordBilder.Where(x => x.ProjektId == projektId).ToListAsync(ct);
            var ritbordPlan = Arr(rot, "ritbord").Select(e =>
            {
                var bef = ritbord.FirstOrDefault(x => Nyckel(x.Namn) == Nyckel(Str(e, "namn")));
                return (E: e, Befintlig: bef, Id: NyttEllerBefintligt(e, bef?.Id));
            }).ToList();

            var kontroller = await db.Kontroller.Where(x => x.ProjektId == projektId).ToListAsync(ct);
            var kontrollPlan = Arr(rot, "kontroller").Select(e =>
            {
                var bef = kontroller.FirstOrDefault(x => x.Typ == Str(e, "typ") && Nyckel(x.Namn) == Nyckel(Str(e, "namn")));
                return (E: e, Befintlig: bef, Id: NyttEllerBefintligt(e, bef?.Id));
            }).ToList();

            var attGora = await db.AttGora.Where(x => x.ProjektId == projektId).ToListAsync(ct);
            var attGoraPlan = Arr(rot, "attGora").Select(e =>
            {
                var bef = attGora.FirstOrDefault(x => Nyckel(x.Text) == Nyckel(Str(e, "text")));
                return (E: e, Befintlig: bef, Id: NyttEllerBefintligt(e, bef?.Id));
            }).ToList();

            // Projektfiler: samma mapp + namn och samma innehåll som senaste versionen = befintlig fil.
            var filerna = await db.Filer.Where(x => x.ProjektId == projektId).ToListAsync(ct);
            var filPlan = new List<(JsonElement E, ZipArchiveEntry Entry, ProjektFil? Befintlig, Guid Id)>();
            var utanFil = 0;
            foreach (var e in Arr(rot, "filer"))
            {
                var sokvag = Str(e, "sokvag");
                var entry = sokvag == "" ? null : zip.GetEntry(sokvag);
                if (entry is null) { utanFil++; continue; }
                var senaste = filerna.Where(x => x.Mapp == Str(e, "mapp") && Nyckel(x.Namn) == Nyckel(Str(e, "namn")))
                    .OrderByDescending(x => x.Version).FirstOrDefault();
                ProjektFil? lika = null;
                if (senaste is not null && senaste.Storlek == entry.Length && await LikaInnehallAsync(lagring, senaste, entry, ct)) lika = senaste;
                filPlan.Add((e, entry, lika, NyttEllerBefintligt(e, lika?.Id)));
            }

            // Listrader: id-kartan för komponenterna måste finnas innan raderna kan kännas igen.
            var listRader = await db.ListRader.Where(x => x.ProjektId == projektId).ToListAsync(ct);
            var radPlan = new List<(string Lista, JsonElement E, ListRad? Befintlig, Guid Id, Guid? KomponentId, Dictionary<string, string> Data)>();
            // ---- id-utbyte i text (listor, ritning, modulbeläggning, funktionstexter) ----
            string Byt(string? text) => string.IsNullOrEmpty(text) ? "" : GuidRegex().Replace(text, m =>
                Guid.TryParse(m.Value, out var g) && karta.TryGetValue(g, out var ny) ? ny.ToString() : m.Value);
            Guid? BytId(JsonElement e, string falt) =>
                e.TryGetProperty(falt, out var x) && Guid.TryParse(x.GetString(), out var g) ? karta.GetValueOrDefault(g, g) : null;

            if (rot.TryGetProperty("listor", out var listorEl) && listorEl.ValueKind == JsonValueKind.Object)
                foreach (var l in listorEl.EnumerateObject())
                {
                    var lista = Byt(l.Name);
                    foreach (var e in l.Value.EnumerateArray())
                    {
                        var data = new Dictionary<string, string>();
                        if (e.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
                            foreach (var f in d.EnumerateObject()) data[f.Name] = Byt(f.Value.ValueKind == JsonValueKind.String ? f.Value.GetString() : f.Value.GetRawText());
                        var komponentId = BytId(e, "komponentId");
                        var json = JsonSerializer.Serialize(data);
                        var bef = komponentId is { } kid
                            ? listRader.FirstOrDefault(x => x.Lista == lista && x.KomponentId == kid)
                            : listRader.FirstOrDefault(x => x.Lista == lista && x.KomponentId is null && x.Data == json);
                        radPlan.Add((lista, e, bef, NyttEllerBefintligt(e, bef?.Id), komponentId, data));
                    }
                }

            var texter = rot.TryGetProperty("texter", out var tEl) && tEl.ValueKind == JsonValueKind.Object
                ? tEl.EnumerateObject().Where(t => t.Value.ValueKind == JsonValueKind.String && (t.Value.GetString() ?? "").Trim() != "")
                    .Select(t => (Nyckel: t.Name, Text: Byt(t.Value.GetString()))).ToList()
                : [];
            var ritningData = Raw(rot, "placeringsritning");
            var statusPoster = Arr(rot, "status").ToList();

            // ---- Rapport (samma för provkörning och skarp körning) ----
            int Nya<T>(IEnumerable<T> plan, Func<T, object?> bef) => plan.Count(x => bef(x) is null);
            rapport.Add($"Komponenter: {Nya(kompPlan, x => x.Befintlig)} nya, {kompPlan.Count(x => x.Befintlig is not null)} uppdateras");
            rapport.Add($"Listrader: {Nya(radPlan, x => x.Befintlig)} nya, {radPlan.Count(x => x.Befintlig is not null)} uppdateras");
            if (skapPlan.Count > 0) rapport.Add($"Apparatskåp: {Nya(skapPlan, x => x.Befintlig)} nya, {skapPlan.Count(x => x.Befintlig is not null)} uppdateras");
            if (dokPlan.Count > 0) rapport.Add($"Funktionstexter och dokument: {Nya(dokPlan, x => x.Befintlig)} nya, {dokPlan.Count(x => x.Befintlig is not null)} uppdateras");
            if (ritbordPlan.Count > 0) rapport.Add($"Ritbordsbilder: {Nya(ritbordPlan, x => x.Befintlig)} nya, {ritbordPlan.Count(x => x.Befintlig is not null)} uppdateras");
            if (kontrollPlan.Count > 0) rapport.Add($"Kontroller: {Nya(kontrollPlan, x => x.Befintlig)} nya, {kontrollPlan.Count(x => x.Befintlig is not null)} finns redan");
            if (attGoraPlan.Count > 0) rapport.Add($"Att göra: {Nya(attGoraPlan, x => x.Befintlig)} nya, {attGoraPlan.Count(x => x.Befintlig is not null)} finns redan");
            if (filPlan.Count > 0) rapport.Add($"Projektfiler: {Nya(filPlan, x => x.Befintlig)} nya eller nya versioner, {filPlan.Count(x => x.Befintlig is not null)} oförändrade");
            if (texter.Count > 0) rapport.Add($"Texter: {string.Join(", ", texter.Select(t => t.Nyckel))}");
            if (ritningData != "") rapport.Add("Placeringsritningen ersätts (den nuvarande sparas i historiken)");
            if (utanFil > 0) varningar.Add($"{utanFil} projektfiler finns inte i zip-filen och hoppas över.");
            var dubbla = Arr(rot, "komponenter").Select(e => Nyckel(Str(e, "beteckning"))).Where(b => b != "")
                .GroupBy(b => b).Where(g => g.Count() > 1).Select(g => g.Key).ToList();
            if (dubbla.Count > 0) varningar.Add($"Beteckningar som finns flera gånger i filen: {string.Join(", ", dubbla.Take(10))}{(dubbla.Count > 10 ? " …" : "")}");
            if (provkor) return new Resultat(rapport, varningar, false);

            // ---- Steg 2: spara ----
            await using var tx = await db.Database.BeginTransactionAsync(ct);

            foreach (var (e, bef, id) in kompPlan)
            {
                var k = bef ?? new Komponent { Id = id, ProjektId = projektId };
                var andrade = new List<string>();
                void Falt(string falt, string varde, Func<string> hamta, Action<string> satt)
                {
                    if (varde.Trim() == "" || hamta() == varde) return;
                    satt(varde);
                    andrade.Add(falt);
                }
                Falt("system", Str(e, "system"), () => k.System, x => k.System = x);
                // Beteckningen är nyckeln: en befintlig komponent behåller sin stavning.
                if (bef is null) Falt("beteckning", Str(e, "beteckning"), () => k.Beteckning, x => k.Beteckning = x);
                Falt("komponenttyp", Str(e, "komponenttyp"), () => k.Komponenttyp, x => k.Komponenttyp = x);
                Falt("beskrivning", Str(e, "beskrivning"), () => k.Beskrivning, x => k.Beskrivning = x);
                Falt("anslutsTill", Str(e, "anslutsTill"), () => k.AnslutsTill, x => k.AnslutsTill = x);
                Falt("kabeltyp", Str(e, "kabeltyp"), () => k.Kabeltyp, x => k.Kabeltyp = x);
                Falt("placering", Str(e, "placering"), () => k.Placering, x => k.Placering = x);
                Falt("ovrigt", Str(e, "ovrigt"), () => k.Ovrigt, x => k.Ovrigt = x);
                Falt("produkttyp", Str(e, "produkttyp"), () => k.Produkttyp, x => k.Produkttyp = x);
                Falt("produkt", Str(e, "produkt"), () => k.Produkt, x => k.Produkt = x);
                Falt("monteringsanvisning", Str(e, "monteringsanvisning"), () => k.Monteringsanvisning, x => k.Monteringsanvisning = x);
                if (e.TryGetProperty("signaler", out var sig) && sig.ValueKind == JsonValueKind.Array && sig.GetArrayLength() > 0)
                {
                    var fore = k.Signaltyp;
                    Signaler.Satt(k, Signaler.LasJson(sig.GetRawText()));
                    if (bef is null || fore != k.Signaltyp) andrade.Add("signaler");
                }
                else if (bef is null && Str(e, "signaltyp") is { Length: > 0 } st) Signaler.Satt(k, Signaler.Tolka(st));
                if (bef is null)
                {
                    k.AndradAv = av.Namn;
                    db.Komponenter.Add(k);
                    Andringslogg.Logga(db, projektId, av, "Komponent", k.Id, $"skapade {k.Beteckning} (komplettering från fil)");
                }
                else if (andrade.Count > 0)
                {
                    k.Version++; k.Andrad = nu; k.AndradAv = av.Namn;
                    Andringslogg.Logga(db, projektId, av, "Komponent", k.Id, $"uppdaterade {k.Beteckning} (komplettering från fil): {string.Join(", ", andrade)}");
                }
            }

            var maxOrdning = listRader.GroupBy(x => x.Lista).ToDictionary(g => g.Key, g => g.Max(x => x.Ordning));
            foreach (var (lista, e, bef, id, komponentId, data) in radPlan)
            {
                if (bef is null)
                {
                    var ordning = Int(e, "ordning") is > 0 and var o ? o : (maxOrdning.GetValueOrDefault(lista) + 1);
                    maxOrdning[lista] = Math.Max(maxOrdning.GetValueOrDefault(lista), ordning);
                    db.ListRader.Add(new ListRad { Id = id, ProjektId = projektId, Lista = lista, KomponentId = komponentId,
                        Data = JsonSerializer.Serialize(data), Ordning = ordning, AndradAv = av.Namn });
                    continue;
                }
                Dictionary<string, string> nuv;
                try { nuv = JsonSerializer.Deserialize<Dictionary<string, string>>(bef.Data) ?? []; } catch (JsonException) { nuv = []; }
                var andrad = false;
                foreach (var (f, varde) in data)
                    if (varde.Trim() != "" && nuv.GetValueOrDefault(f) != varde) { nuv[f] = varde; andrad = true; }
                if (!andrad) continue;
                bef.Data = JsonSerializer.Serialize(nuv); bef.Version++; bef.Andrad = nu; bef.AndradAv = av.Namn;
            }
            var nyaRader = radPlan.Count(x => x.Befintlig is null);
            if (radPlan.Count > 0)
                Andringslogg.Logga(db, projektId, av, "Lista", projektId, $"kompletterade listor från fil: {nyaRader} nya rader, {radPlan.Count - nyaRader} uppdaterade");

            foreach (var (e, bef, id) in skapPlan)
            {
                var data = Byt(Raw(e, "data")); var moduler = Byt(Raw(e, "moduler"));
                if (bef is null)
                {
                    db.Skap.Add(new Skap { Id = id, ProjektId = projektId, Namn = Str(e, "namn"), Beteckning = Str(e, "beteckning"),
                        Placering = Str(e, "placering"), Beskrivning = Str(e, "beskrivning"), Data = data, Moduler = moduler,
                        Ordning = skapen.Count + Int(e, "ordning"), AndradAv = av.Namn });
                    Andringslogg.Logga(db, projektId, av, "Skap", id, $"skapade apparatskåp {Str(e, "namn")} (komplettering från fil)");
                    continue;
                }
                if (Str(e, "beteckning") is { Length: > 0 } b) bef.Beteckning = b;
                if (Str(e, "placering") is { Length: > 0 } pl) bef.Placering = pl;
                if (Str(e, "beskrivning") is { Length: > 0 } be) bef.Beskrivning = be;
                if (data != "") bef.Data = data;
                if (moduler != "") bef.Moduler = moduler;
                bef.Version++; bef.Andrad = nu; bef.AndradAv = av.Namn;
                Andringslogg.Logga(db, projektId, av, "Skap", bef.Id, $"uppdaterade apparatskåp {bef.Namn} (komplettering från fil)");
            }

            // Filerna sparas före dokumenten: funktionstexternas originalfiler måste finnas.
            foreach (var (e, entry, bef, id) in filPlan)
            {
                if (bef is not null) continue;
                var tidigare = filerna.Where(x => x.Mapp == Str(e, "mapp") && Nyckel(x.Namn) == Nyckel(Str(e, "namn"))).Select(x => x.Version).DefaultIfEmpty(0).Max();
                var f = new ProjektFil
                {
                    Id = id, ProjektId = projektId, Mapp = Str(e, "mapp"), Namn = Str(e, "namn"), Version = tidigare + 1, Storlek = entry.Length,
                    Typ = Str(e, "typ") is { Length: > 0 } ty ? ty : "application/octet-stream", UppladdadAv = av.Namn,
                };
                f.BlobNamn = $"{projektId}/{f.Id}";
                await using (var inn = entry.Open())
                using (var buffert = new MemoryStream())
                {
                    await inn.CopyToAsync(buffert, ct);
                    buffert.Position = 0;
                    await lagring.SparaAsync(f.BlobNamn, buffert, f.Typ, ct);
                }
                db.Filer.Add(f);
                Andringslogg.Logga(db, projektId, av, "Fil", f.Id, tidigare == 0 ? $"skapade {f.Namn} i {f.Mapp} (komplettering från fil)" : $"skapade version {f.Version} av {f.Namn} i {f.Mapp} (komplettering från fil)");
            }

            var maxDok = dokumenten.GroupBy(x => x.Typ).ToDictionary(g => g.Key, g => g.Max(x => x.Ordning));
            foreach (var (e, bef, id) in dokPlan)
            {
                var data = Byt(Str(e, "data"));
                if (bef is null)
                {
                    var typ = Str(e, "typ");
                    maxDok[typ] = maxDok.GetValueOrDefault(typ) + 1;
                    db.Dokument.Add(new ProjektDokument { Id = id, ProjektId = projektId, Typ = typ, Namn = Str(e, "namn"), Data = data,
                        Ordning = maxDok[typ], AndradAv = av.Namn });
                    Andringslogg.Logga(db, projektId, av, "Dokument", id, $"skapade {Str(e, "namn")} (komplettering från fil)");
                }
                else if (data != "" && bef.Data != data)
                {
                    bef.Data = data; bef.Version++; bef.Andrad = nu; bef.AndradAv = av.Namn;
                    Andringslogg.Logga(db, projektId, av, "Dokument", bef.Id, $"uppdaterade {bef.Namn} (komplettering från fil)");
                }
            }

            foreach (var (e, bef, id) in ritbordPlan)
            {
                var data = Byt(Raw(e, "data"));
                if (bef is null)
                {
                    db.RitbordBilder.Add(new RitbordBild { Id = id, ProjektId = projektId, Namn = Str(e, "namn"), Data = data,
                        Ordning = ritbord.Count + Int(e, "ordning"), AndradAv = av.Namn });
                    Andringslogg.Logga(db, projektId, av, "Ritbord", id, $"skapade ritbordsbilden {Str(e, "namn")} (komplettering från fil)");
                }
                else if (data != "" && bef.Data != data)
                {
                    bef.Data = data; bef.Version++; bef.Andrad = nu; bef.AndradAv = av.Namn;
                    Andringslogg.Logga(db, projektId, av, "Ritbord", bef.Id, $"uppdaterade ritbordsbilden {bef.Namn} (komplettering från fil)");
                }
            }

            foreach (var (e, bef, id) in kontrollPlan.Where(x => x.Befintlig is null))
                db.Kontroller.Add(new Kontroll { Id = id, ProjektId = projektId, Typ = Str(e, "typ"), Namn = Str(e, "namn"),
                    Beskrivning = Str(e, "beskrivning"), MallNamn = Str(e, "mallNamn"), Ordning = kontroller.Count + Int(e, "ordning"), AndradAv = av.Namn });

            var maxAttGora = attGora.Select(x => x.Ordning).DefaultIfEmpty(0).Max();
            foreach (var (e, bef, id) in attGoraPlan.Where(x => x.Befintlig is null))
                db.AttGora.Add(new AttGoraPost { Id = id, ProjektId = projektId, Text = Str(e, "text"), Klar = Bool(e, "klar"),
                    Pagaende = Bool(e, "pagaende"), Kommentar = Str(e, "kommentar"), Ordning = ++maxAttGora, AndradAv = av.Namn });
            if (attGoraPlan.Any(x => x.Befintlig is null))
                Andringslogg.Logga(db, projektId, av, "AttGora", projektId, $"lade till {attGoraPlan.Count(x => x.Befintlig is null)} punkter i Att göra (komplettering från fil)");

            if (statusPoster.Count > 0)
            {
                var rubriker = await db.StatusRubriker.ToListAsync(ct);
                var finns = await db.StatusUppgifter.Where(x => x.ProjektId == projektId).ToListAsync(ct);
                var saknade = new HashSet<string>();
                foreach (var e in statusPoster)
                {
                    var rubrik = rubriker.FirstOrDefault(r => string.Equals(r.Namn, Str(e, "rubrik"), StringComparison.OrdinalIgnoreCase));
                    if (rubrik is null) { saknade.Add(Str(e, "rubrik")); continue; }
                    if (finns.Any(x => x.RubrikId == rubrik.Id && Nyckel(x.Text) == Nyckel(Str(e, "text")))) continue;
                    db.StatusUppgifter.Add(new StatusUppgift { ProjektId = projektId, RubrikId = rubrik.Id, Text = Str(e, "text"), Klar = Bool(e, "klar"),
                        UtfordAv = Str(e, "utfordAv"), Kommentar = Str(e, "kommentar"), Ordning = Int(e, "ordning"), AndradAv = av.Namn });
                }
                if (saknade.Count > 0) varningar.Add("Statusuppgifter under rubriker som inte finns här hoppades över: " + string.Join(", ", saknade));
            }

            foreach (var (nyckel, text) in texter)
            {
                var t = await db.Texter.FirstOrDefaultAsync(x => x.ProjektId == projektId && x.Nyckel == nyckel, ct);
                if (t is null) db.Texter.Add(new ProjektText { ProjektId = projektId, Nyckel = nyckel, Text = text, Andrad = nu, AndradAv = av.Namn });
                else if (t.Text != text) { t.Text = text; t.Andrad = nu; t.AndradAv = av.Namn; }
                else continue;
                Andringslogg.Logga(db, projektId, av, "Text", projektId, $"uppdaterade texten {nyckel} (komplettering från fil)");
            }

            if (ritningData != "")
            {
                var data = Byt(ritningData);
                var r = await db.Ritningar.FirstOrDefaultAsync(x => x.ProjektId == projektId, ct);
                if (r is null) db.Ritningar.Add(new Ritning { ProjektId = projektId, Data = data, AndradAv = av.Namn });
                else if (r.Data != data)
                {
                    await RitningEndpoints.SparaHistorikAsync(db, r, true);
                    r.Data = data; r.Version++; r.Andrad = nu; r.AndradAv = av.Namn;
                }
                Andringslogg.Logga(db, projektId, av, "Ritning", projektId, "ersatte Placeringsritningar (komplettering från fil)");
            }

            // Projektets egna uppgifter fylls bara i där de saknas.
            if (pEl.ValueKind == JsonValueKind.Object)
            {
                if (projekt.Nummer.Trim() == "" && Str(pEl, "nummer") is { Length: > 0 } nr) projekt.Nummer = nr;
                if (projekt.Kund.Trim() == "" && Str(pEl, "kund") is { Length: > 0 } ku) projekt.Kund = ku;
                if (projekt.Ansvarig.Trim() == "" && Str(pEl, "ansvarig") is { Length: > 0 } an) projekt.Ansvarig = an;
                if (projekt.Anteckningar.Trim() == "" && Str(pEl, "anteckningar") is { Length: > 0 } at) projekt.Anteckningar = at;
            }

            Andringslogg.Logga(db, projektId, av, "Projekt", projektId, $"kompletterade projektet från {Path.GetFileName(filnamn)}");
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new Resultat(rapport, varningar, true);
        }
    }

    private static async Task<bool> LikaInnehallAsync(IFilLagring lagring, ProjektFil fil, ZipArchiveEntry entry, CancellationToken ct)
    {
        await using var befintlig = await lagring.OppnaAsync(fil.BlobNamn, ct);
        if (befintlig is null) return false;
        using var a = new MemoryStream(); await befintlig.CopyToAsync(a, ct);
        using var b = new MemoryStream();
        await using (var inn = entry.Open()) await inn.CopyToAsync(b, ct);
        return a.ToArray().AsSpan().SequenceEqual(b.ToArray());
    }

    private static IResult Fel(string text) => Results.ValidationProblem(new Dictionary<string, string[]> { ["fil"] = [text] });
}
