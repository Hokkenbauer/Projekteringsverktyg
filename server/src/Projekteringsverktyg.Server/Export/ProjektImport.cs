using System.IO.Compression;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.FilApi;
using Projekteringsverktyg.Server.KomponentApi;
using Projekteringsverktyg.Server.ProjektApi;

namespace Projekteringsverktyg.Server.Export;

/// <summary>
/// Läser in en projektexport (ZIP med projekt.json) som ett NYTT projekt. Det exporterade projektet rörs aldrig.
/// Allt får nya id: varje gammalt id byts mot sitt nya överallt där det förekommer (listor, ritning, modulbeläggning,
/// kontroller, kopplingar, funktionstexternas originalfiler, ritningens PDF-bakgrunder), så att alla kopplingar behålls.
/// </summary>
public static partial class ProjektImport
{
    public const int FormatVersion = 1;

    public sealed record Resultat(Projekt Projekt, int Komponenter, List<string> Rapport, List<string> Varningar);

    public static IEndpointRouteBuilder MapProjektImportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/projekt/import-export", async (HttpRequest request, ClaimsPrincipal user, Behorighet beh, PvDbContext db,
            IFilLagring lagring, CancellationToken ct) =>
        {
            if (!await beh.KanSkapaProjekt(user))
                return Results.Problem(statusCode: 403, title: "Bara Admin och Projektledare kan skapa projekt.");
            if (!request.HasFormContentType) return Fel("Skicka filen som formulär.");
            var form = await request.ReadFormAsync(ct);
            var fil = form.Files.GetFile("fil");
            if (fil is null || fil.Length == 0) return Fel("Ingen fil valdes.");

            await using var s = fil.OpenReadStream();
            ZipArchive zip;
            try { zip = new ZipArchive(s, ZipArchiveMode.Read); }
            catch (InvalidDataException) { return Fel("Filen är ingen projektexport (ZIP). Välj zip-filen från Exportera projektet."); }
            using (zip)
            {
                var av = Anvandare.Fran(user);
                var medlemId = (await beh.AktuellAsync(user)).Id;
                try
                {
                    var r = await LasInAsync(zip, form["namn"].ToString().Trim(), av, medlemId, fil.FileName, db, lagring, ct);
                    return Results.Ok(new
                    {
                        projekt = new ProjektDto(r.Projekt.Id, r.Projekt.Namn, r.Projekt.Nummer, r.Projekt.Kund, r.Projekt.Ansvarig, r.Projekt.Skapad, r.Projekt.SkapadAv, r.Komponenter),
                        rapport = r.Rapport,
                        varningar = r.Varningar,
                    });
                }
                catch (InvalidDataException e) { return Fel(e.Message); }
            }
        }).DisableAntiforgery();
        return app;
    }

    public static async Task<Resultat> LasInAsync(ZipArchive zip, string nyttNamn, Anvandare av, string medlemId, string filnamn,
        PvDbContext db, IFilLagring lagring, CancellationToken ct)
    {
        var post = zip.GetEntry("projekt.json") ?? throw new InvalidDataException("Zip-filen saknar projekt.json. Välj en fil från Exportera projektet.");
        JsonDocument dok;
        try { await using var st = post.Open(); dok = await JsonDocument.ParseAsync(st, cancellationToken: ct); }
        catch (JsonException) { throw new InvalidDataException("projekt.json kunde inte läsas."); }
        using (dok)
        {
            var rot = dok.RootElement;
            if (Str(rot, "format") != "Projekteringsverktyg projektexport")
                throw new InvalidDataException("Filen är ingen projektexport från Projekteringsverktyg.");
            if (rot.TryGetProperty("formatVersion", out var fv) && fv.TryGetInt32(out var v) && v > FormatVersion)
                throw new InvalidDataException("Exporten kommer från en nyare version av verktyget. Uppdatera först.");

            var rapport = new List<string>();
            var varningar = new List<string>();

            // ---- Nya id för alla gamla ----
            var karta = new Dictionary<Guid, Guid>();
            Guid Nytt(JsonElement e, string falt)
            {
                if (!e.TryGetProperty(falt, out var x) || !Guid.TryParse(x.GetString(), out var gammal)) return Guid.NewGuid();
                if (!karta.TryGetValue(gammal, out var ny)) karta[gammal] = ny = Guid.NewGuid();
                return ny;
            }
            var p = rot.GetProperty("projekt");
            var projektId = Nytt(p, "id");
            // Id registreras i förväg, så att alla hänvisningar (även framåt i filen) kan bytas.
            foreach (var lista in new[] { "komponenter", "kontroller", "apparatskap", "dokument", "attGora", "status", "ritbord", "filer" })
                foreach (var e in Arr(rot, lista)) Nytt(e, "id");
            if (rot.TryGetProperty("listor", out var listorEl) && listorEl.ValueKind == JsonValueKind.Object)
                foreach (var l in listorEl.EnumerateObject()) foreach (var e in l.Value.EnumerateArray()) Nytt(e, "id");
            string Byt(string? text) => string.IsNullOrEmpty(text) ? "" : GuidRegex().Replace(text, m =>
                Guid.TryParse(m.Value, out var g) && karta.TryGetValue(g, out var ny) ? ny.ToString() : m.Value);
            Guid? BytId(JsonElement e, string falt) =>
                e.TryGetProperty(falt, out var x) && Guid.TryParse(x.GetString(), out var g) ? karta.GetValueOrDefault(g, g) : null;

            // ---- Projektet ----
            var projekt = new Projekt
            {
                Id = projektId,
                Namn = nyttNamn != "" ? nyttNamn : (Str(p, "namn") is { Length: > 0 } n ? n : "Importerat projekt"),
                Nummer = Str(p, "nummer"), Kund = Str(p, "kund"), Ansvarig = Str(p, "ansvarig"),
                Anteckningar = Str(p, "anteckningar"), SkapadAv = av.Namn,
            };
            await using var tx = await db.Database.BeginTransactionAsync(ct);
            db.Projekt.Add(projekt);
            db.Medlemmar.Add(new ProjektMedlem { Roll = Roller.Projektledare, ProjektId = projektId, AnvandarId = medlemId, TillagdAv = av.Namn });
            await db.SaveChangesAsync(ct);

            // ---- Komponenter med I/O ----
            var komponenter = new List<Komponent>();
            foreach (var e in Arr(rot, "komponenter"))
            {
                var k = new Komponent
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, AndradAv = av.Namn,
                    System = Str(e, "system"), Beteckning = Str(e, "beteckning"), Komponenttyp = Str(e, "komponenttyp"),
                    Signaltyp = Str(e, "signaltyp"), Beskrivning = Str(e, "beskrivning"), AnslutsTill = Str(e, "anslutsTill"),
                    Kabeltyp = Str(e, "kabeltyp"), Placering = Str(e, "placering"), Ovrigt = Str(e, "ovrigt"),
                    Produkttyp = Str(e, "produkttyp"), Produkt = Str(e, "produkt"), Monteringsanvisning = Str(e, "monteringsanvisning"),
                };
                if (e.TryGetProperty("signaler", out var sig) && sig.ValueKind == JsonValueKind.Array && sig.GetArrayLength() > 0)
                    Signaler.Satt(k, Signaler.LasJson(sig.GetRawText()));
                komponenter.Add(k);
            }
            db.Komponenter.AddRange(komponenter);
            rapport.Add($"{komponenter.Count} komponenter ({komponenter.Sum(k => Signaler.Las(k).Count)} I/O-punkter)");

            // ---- Listor (egenkontroll, skyltlista, kontroller, kraftberäkningar …) ----
            var antalRader = 0;
            if (listorEl.ValueKind == JsonValueKind.Object)
                foreach (var l in listorEl.EnumerateObject())
                    foreach (var e in l.Value.EnumerateArray())
                    {
                        var data = new Dictionary<string, string>();
                        if (e.TryGetProperty("data", out var d) && d.ValueKind == JsonValueKind.Object)
                            foreach (var f in d.EnumerateObject()) data[f.Name] = Byt(f.Value.ValueKind == JsonValueKind.String ? f.Value.GetString() : f.Value.GetRawText());
                        db.ListRader.Add(new ListRad
                        {
                            Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, Lista = Byt(l.Name), KomponentId = BytId(e, "komponentId"),
                            Data = JsonSerializer.Serialize(data), Ordning = Int(e, "ordning"), AndradAv = Str(e, "andradAv") is { Length: > 0 } a ? a : av.Namn,
                        });
                        antalRader++;
                    }
            rapport.Add($"{antalRader} listrader");

            // ---- Kontroller, apparatskåp, dokument, att göra ----
            foreach (var e in Arr(rot, "kontroller"))
                db.Kontroller.Add(new Kontroll
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, Typ = Str(e, "typ"), Namn = Str(e, "namn"),
                    Beskrivning = Str(e, "beskrivning"), MallNamn = Str(e, "mallNamn"), Ordning = Int(e, "ordning"), AndradAv = av.Namn,
                });
            var antalSkap = 0;
            foreach (var e in Arr(rot, "apparatskap"))
            {
                db.Skap.Add(new Skap
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, Namn = Str(e, "namn"), Beteckning = Str(e, "beteckning"),
                    Placering = Str(e, "placering"), Beskrivning = Str(e, "beskrivning"),
                    Data = Byt(Raw(e, "data")), Moduler = Byt(Raw(e, "moduler")), Ordning = Int(e, "ordning"),
                });
                antalSkap++;
            }
            var antalDok = 0;
            foreach (var e in Arr(rot, "dokument"))
            {
                db.Dokument.Add(new ProjektDokument
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, Typ = Str(e, "typ"), Namn = Str(e, "namn"),
                    Data = Byt(Str(e, "data")), Ordning = Int(e, "ordning"), AndradAv = av.Namn,
                });
                antalDok++;
            }
            foreach (var e in Arr(rot, "attGora"))
                db.AttGora.Add(new AttGoraPost
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, Text = Str(e, "text"), Klar = Bool(e, "klar"),
                    Pagaende = Bool(e, "pagaende"), Kommentar = Str(e, "kommentar"), Ordning = Int(e, "ordning"), AndradAv = av.Namn,
                });

            // ---- Projektstatus (rubrikerna är gemensamma och hittas på namn) ----
            var rubriker = await db.StatusRubriker.ToListAsync(ct);
            var saknadeRubriker = new HashSet<string>();
            foreach (var e in Arr(rot, "status"))
            {
                var rubrik = rubriker.FirstOrDefault(r => string.Equals(r.Namn, Str(e, "rubrik"), StringComparison.OrdinalIgnoreCase));
                if (rubrik is null) { saknadeRubriker.Add(Str(e, "rubrik")); continue; }
                db.StatusUppgifter.Add(new StatusUppgift
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, RubrikId = rubrik.Id, Text = Str(e, "text"), Klar = Bool(e, "klar"),
                    UtfordAv = Str(e, "utfordAv"), Kommentar = Str(e, "kommentar"), Ordning = Int(e, "ordning"), AndradAv = av.Namn,
                    KlarDatum = e.TryGetProperty("klarDatum", out var kd) && kd.ValueKind == JsonValueKind.String && DateTimeOffset.TryParse(kd.GetString(), out var t) ? t : null,
                });
            }
            if (saknadeRubriker.Count > 0) varningar.Add("Statusuppgifter under rubriker som inte finns här hoppades över: " + string.Join(", ", saknadeRubriker));

            // ---- Texter, ritningar ----
            if (rot.TryGetProperty("texter", out var texter) && texter.ValueKind == JsonValueKind.Object)
                foreach (var t in texter.EnumerateObject())
                    db.Texter.Add(new ProjektText { ProjektId = projektId, Nyckel = t.Name, Text = Byt(t.Value.GetString()), Andrad = DateTimeOffset.UtcNow, AndradAv = av.Namn });
            var ritning = Raw(rot, "placeringsritning");
            if (ritning != "") db.Ritningar.Add(new Ritning { ProjektId = projektId, Data = Byt(ritning), AndradAv = av.Namn });
            var antalRitbord = 0;
            foreach (var e in Arr(rot, "ritbord"))
            {
                db.RitbordBilder.Add(new RitbordBild
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, Namn = Str(e, "namn"), Data = Byt(Raw(e, "data")),
                    Ordning = Int(e, "ordning"), AndradAv = av.Namn,
                });
                antalRitbord++;
            }

            // ---- Projektfiler (bara de som finns i zip-filen) ----
            var antalFiler = 0; var utanFil = 0;
            foreach (var e in Arr(rot, "filer"))
            {
                var sokvag = Str(e, "sokvag");
                var entry = sokvag == "" ? null : zip.GetEntry(sokvag);
                if (entry is null) { utanFil++; continue; }
                var fil = new ProjektFil
                {
                    Id = BytId(e, "id") ?? Guid.NewGuid(), ProjektId = projektId, Mapp = Str(e, "mapp"), Namn = Str(e, "namn"), Version = 1,
                    Storlek = entry.Length, Typ = Str(e, "typ") is { Length: > 0 } ty ? ty : "application/octet-stream", UppladdadAv = Str(e, "uppladdadAv") is { Length: > 0 } u ? u : av.Namn,
                };
                fil.BlobNamn = $"{projektId}/{fil.Id}";
                await using (var inn = entry.Open())
                using (var buffert = new MemoryStream())
                {
                    await inn.CopyToAsync(buffert, ct);
                    buffert.Position = 0;
                    await lagring.SparaAsync(fil.BlobNamn, buffert, fil.Typ, ct);
                }
                db.Filer.Add(fil);
                antalFiler++;
            }
            if (utanFil > 0) varningar.Add($"{utanFil} projektfiler fanns inte i exporten (den gjordes utan projektfiler). PDF-bakgrunder i ritningen och Word-original till funktionstexter kan då saknas.");

            rapport.Add($"{antalDok} dokument (funktionstexter m.m.), {antalSkap} apparatskåp, {antalRitbord} ritbordsbilder");
            rapport.Add($"{antalFiler} projektfiler");
            if (ritning != "") rapport.Add("Placeringsritningen");
            Andringslogg.Logga(db, projektId, av, "Projekt", projektId, $"importerade projektet {projekt.Namn} från en projektexport ({Path.GetFileName(filnamn)})");
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return new Resultat(projekt, komponenter.Count, rapport, varningar);
        }
    }

    private static IEnumerable<JsonElement> Arr(JsonElement e, string falt) =>
        e.TryGetProperty(falt, out var x) && x.ValueKind == JsonValueKind.Array ? x.EnumerateArray() : [];
    private static string Str(JsonElement e, string falt) =>
        e.TryGetProperty(falt, out var x) && x.ValueKind == JsonValueKind.String ? x.GetString() ?? "" : "";
    private static int Int(JsonElement e, string falt) => e.TryGetProperty(falt, out var x) && x.TryGetInt32(out var i) ? i : 0;
    private static bool Bool(JsonElement e, string falt) => e.TryGetProperty(falt, out var x) && x.ValueKind == JsonValueKind.True;
    /// <summary>JSON-värdet som text (objekt/listor som JSON, strängar som de är). Saknas = tom text.</summary>
    private static string Raw(JsonElement e, string falt) =>
        !e.TryGetProperty(falt, out var x) || x.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? ""
        : x.ValueKind == JsonValueKind.String ? x.GetString() ?? "" : x.GetRawText();

    [GeneratedRegex(@"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")]
    private static partial Regex GuidRegex();

    private static IResult Fel(string text) => Results.ValidationProblem(new Dictionary<string, string[]> { ["fil"] = [text] });
}
