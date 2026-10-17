using System.IO.Compression;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.DokumentApi;
using Projekteringsverktyg.Server.FilApi;
using Projekteringsverktyg.Server.KomponentApi;
using Projekteringsverktyg.Server.ListApi;
using Projekteringsverktyg.Server.ProjektApi;

namespace Projekteringsverktyg.Server.Export;

/// <summary>
/// Projektexport: allt viktigt i ett projekt i en ZIP-fil.
///  - Projektdata.xlsx: översikt, komponenter, signallista och alla listor/kontroller som egna blad, att göra, status, ändringslogg
///  - Funktionstexter/*.docx (med projektets sidfot), Texter/*.txt
///  - Projektfiler/&lt;mapp&gt;/… (senaste versionen av varje fil, valfritt)
///  - Ritningar/ (placeringsritning, ritbordets bilder, apparatskåp och modulbeläggning som JSON)
///  - projekt.json: hela projektet maskinläsbart (för arkiv och framtida import)
/// Zip-filen byggs i en temporär fil som tas bort när den skickats.
/// </summary>
public static class ProjektExport
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    public static IEndpointRouteBuilder MapProjektExportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/projekt/{projektId:guid}/export", async (Guid projektId, bool? filer, ClaimsPrincipal user, PvDbContext db,
            IFilLagring lagring, Behorighet beh, ILoggerFactory loggar, CancellationToken ct) =>
        {
            var projekt = await db.Projekt.AsNoTracking().FirstOrDefaultAsync(p => p.Id == projektId, ct);
            if (projekt is null) return Results.NotFound();
            var kansligt = await beh.KanLedaProjekt(user, projektId);
            var tmp = Path.Combine(Path.GetTempPath(), $"pv-export-{Guid.NewGuid():N}.zip");
            try
            {
                await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.ReadWrite, FileShare.None, 81920, useAsync: true))
                using (var zip = new ZipArchive(fs, ZipArchiveMode.Create, leaveOpen: true))
                    await SkrivAsync(zip, db, lagring, projekt, filer ?? true, kansligt, loggar.CreateLogger("Projektexport"), ct);
            }
            catch
            {
                File.Delete(tmp);
                throw;
            }
            var namn = Excel.Filnamn($"Projektexport {projekt.Nummer} {projekt.Namn}".Trim()).Replace(".xlsx", ".zip");
            var ström = new FileStream(tmp, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, FileOptions.DeleteOnClose | FileOptions.Asynchronous);
            return Results.File(ström, "application/zip", namn);
        }).AddEndpointFilter<ProjektAtkomst>();
        return app;
    }

    public static async Task SkrivAsync(ZipArchive zip, PvDbContext db, IFilLagring lagring, Projekt projekt, bool medFiler, bool kansligt,
        ILogger log, CancellationToken ct)
    {
        var id = projekt.Id;
        var komponenter = await db.Komponenter.AsNoTracking().Where(k => k.ProjektId == id).OrderBy(k => k.System).ThenBy(k => k.Beteckning).ToListAsync(ct);
        var listrader = await db.ListRader.AsNoTracking().Where(r => r.ProjektId == id).OrderBy(r => r.Lista).ThenBy(r => r.Ordning).ToListAsync(ct);
        var kontroller = await db.Kontroller.AsNoTracking().Where(k => k.ProjektId == id).OrderBy(k => k.Typ).ThenBy(k => k.Ordning).ToListAsync(ct);
        var skap = await db.Skap.AsNoTracking().Where(s => s.ProjektId == id).OrderBy(s => s.Ordning).ToListAsync(ct);
        var dokument = await db.Dokument.AsNoTracking().Where(d => d.ProjektId == id).OrderBy(d => d.Typ).ThenBy(d => d.Ordning).ToListAsync(ct);
        if (!kansligt) dokument = dokument.Where(d => !DokumentEndpoints.Kansliga.Contains(d.Typ)).ToList();
        var attGora = await db.AttGora.AsNoTracking().Where(a => a.ProjektId == id).OrderBy(a => a.Ordning).ToListAsync(ct);
        var rubriker = await db.StatusRubriker.AsNoTracking().ToDictionaryAsync(r => r.Id, r => r, ct);
        var status = await db.StatusUppgifter.AsNoTracking().Where(s => s.ProjektId == id).ToListAsync(ct);
        var texter = await db.Texter.AsNoTracking().Where(t => t.ProjektId == id).ToListAsync(ct);
        var ritning = await db.Ritningar.AsNoTracking().FirstOrDefaultAsync(r => r.ProjektId == id, ct);
        var ritbord = await db.RitbordBilder.AsNoTracking().Where(b => b.ProjektId == id).OrderBy(b => b.Ordning).ToListAsync(ct);
        var logg = await db.Andringslogg.AsNoTracking().Where(l => l.ProjektId == id).OrderByDescending(l => l.Id).Take(20000).ToListAsync(ct);
        var filer = (await db.Filer.AsNoTracking().Where(f => f.ProjektId == id).ToListAsync(ct))
            .GroupBy(f => (f.Mapp, f.Namn)).Select(g => g.OrderByDescending(f => f.Version).First())
            .OrderBy(f => f.Mapp).ThenBy(f => f.Namn).ToList();

        // ---------- Projektdata.xlsx ----------
        var blad = new List<Excel.Blad>();
        var titel = (string vad) => $"{vad} – {projekt.Namn} {projekt.Nummer}".Trim();
        blad.Add(new Excel.Blad("Översikt", titel("Projektexport"), ["Uppgift", "Värde"], new List<object?[]>
        {
            new object?[] { "Projekt", projekt.Namn }, new object?[] { "Projektnummer", projekt.Nummer },
            new object?[] { "Kund", projekt.Kund }, new object?[] { "Ansvarig", projekt.Ansvarig },
            new object?[] { "Skapat", projekt.Skapad.ToString("yyyy-MM-dd") + " av " + projekt.SkapadAv },
            new object?[] { "Komponenter", komponenter.Count },
            new object?[] { "Signaler (I/O)", komponenter.Sum(k => Signaler.Las(k).Count) },
            new object?[] { "Kontroller", kontroller.Count }, new object?[] { "Apparatskåp", skap.Count },
            new object?[] { "Funktionstexter", dokument.Count(d => d.Typ == "funktionstext") },
            new object?[] { "Projektfiler", filer.Count }, new object?[] { "Att göra (öppna)", attGora.Count(a => !a.Klar) },
        }));
        blad.Add(new Excel.Blad("Komponenter", titel("Komponenter"),
            ["Beteckning", "System", "Komponenttyp", "I/O", "Placering", "Beskrivning", "Övrigt", "Ansluts till", "Kabeltyp", "Produkttyp", "Fabrikat", "Monteringsanvisning"],
            komponenter.Select(k => new object?[] { k.Beteckning, k.System, k.Komponenttyp, k.Signaltyp, k.Placering, k.Beskrivning, k.Ovrigt, k.AnslutsTill, k.Kabeltyp, k.Produkttyp, k.Produkt, k.Monteringsanvisning })));
        blad.Add(new Excel.Blad("Signallista", titel("Signallista (I/O)"), ["Signalnamn", "Typ", "Funktion", "Beskrivning", "Komponent", "Komponenttyp", "Ansluts till"],
            komponenter.SelectMany(k => Signaler.Las(k).Select(s => new object?[]
            {
                string.Join("-", new[] { k.Beteckning.Trim(), s.Funktion.Trim() }.Where(x => x != "")), s.Typ, s.Funktion, s.Beskrivning, k.Beteckning, k.Komponenttyp, k.AnslutsTill,
            })).OrderBy(r => (string?)r[0], StringComparer.Create(new System.Globalization.CultureInfo("sv-SE"), false))));

        // Alla listor: grundlistorna, projektets kontroller och kraftberäkningar per skåp. Tomma listor hoppas över.
        var listId = Listdefinitioner.Alla.Select(d => d.Id)
            .Concat(kontroller.Select(k => Listdefinitioner.KontrollPrefix + k.Id))
            .Concat(skap.Select(s => Listdefinitioner.KraftPrefix + s.Id))
            .Concat(listrader.Select(r => r.Lista)).Distinct().Where(l => l != "signallista");
        foreach (var lista in listId)
        {
            var t = await ListEndpoints.ExportTabellAsync(db, id, lista);
            if (t is not { } tabell || tabell.Rader.Count == 0) continue;
            blad.Add(new Excel.Blad(tabell.Namn, titel(tabell.Namn), tabell.Rubriker, tabell.Rader));
        }
        if (attGora.Count > 0)
            blad.Add(new Excel.Blad("Att göra", titel("Att göra"), ["Att göra", "Pågående", "Åtgärdad", "Kommentar", "Ändrad", "Ändrad av"],
                attGora.Select(a => new object?[] { a.Text, a.Pagaende ? "Ja" : "", a.Klar ? "Ja" : "", a.Kommentar, Tid(a.Andrad), a.AndradAv })));
        if (status.Count > 0)
            blad.Add(new Excel.Blad("Projektstatus", titel("Projektstatus"), ["Rubrik", "Uppgift", "Klar", "Utförd av", "Klar datum", "Kommentar"],
                status.OrderBy(s => rubriker.GetValueOrDefault(s.RubrikId)?.Ordning ?? 999).ThenBy(s => s.Ordning)
                    .Select(s => new object?[] { rubriker.GetValueOrDefault(s.RubrikId)?.Namn ?? "", s.Text, s.Klar ? "Ja" : "", s.UtfordAv, s.KlarDatum is { } d ? Tid(d) : null, s.Kommentar })));
        if (logg.Count > 0)
            blad.Add(new Excel.Blad("Ändringslogg", titel("Ändringslogg"), ["Tid", "Vem", "Vad", "Fält", "Före", "Efter"],
                logg.Select(l => new object?[] { Tid(l.Tidpunkt), l.AnvandarNamn, l.Beskrivning, l.Falt, l.Fore, l.Efter })));
        Lagg(zip, "Projektdata.xlsx", Excel.Arbetsbok(blad));

        // ---------- Funktionstexter (Word) ----------
        var namnIZip = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in dokument.Where(d => d.Typ == "funktionstext"))
        {
            try
            {
                var word = await FunktionstextApi.FunktionstextEndpoints.TillWordAsync(db, lagring, id, d, ct);
                word = await DriftkortApi.DriftkortSidfot.TillampaAsync(db, id, word, ct);
                var filnamn = d.Namn.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) ? d.Namn : d.Namn + ".docx";
                Lagg(zip, Unik(namnIZip, "Funktionstexter/" + FilEndpoints.RentNamn(filnamn)), word);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning(e, "Funktionstext {Namn} kunde inte exporteras", d.Namn);
                Lagg(zip, Unik(namnIZip, "Funktionstexter/" + FilEndpoints.RentNamn(d.Namn) + " (FEL).txt"), Encoding.UTF8.GetBytes($"Texten kunde inte göras om till Word: {e.Message}"));
            }
        }

        // ---------- Texter ----------
        if (!string.IsNullOrWhiteSpace(projekt.Anteckningar)) Lagg(zip, "Texter/Anteckningar.txt", Encoding.UTF8.GetBytes(projekt.Anteckningar));
        foreach (var t in texter.Where(t => !string.IsNullOrWhiteSpace(t.Text)))
        {
            var namn = TextEndpoints.Nycklar.GetValueOrDefault(t.Nyckel, t.Nyckel);
            var arJson = t.Text.TrimStart().StartsWith('{') || t.Text.TrimStart().StartsWith('[');
            Lagg(zip, Unik(namnIZip, $"Texter/{FilEndpoints.RentNamn(namn)}.{(arJson ? "json" : "txt")}"), Encoding.UTF8.GetBytes(t.Text));
        }

        // ---------- Ritningar ----------
        if (ritning is not null && !string.IsNullOrWhiteSpace(ritning.Data))
            Lagg(zip, "Ritningar/Placeringsritning.json", Encoding.UTF8.GetBytes(ritning.Data));
        foreach (var b in ritbord.Where(b => !string.IsNullOrWhiteSpace(b.Data)))
            Lagg(zip, Unik(namnIZip, $"Ritningar/Ritbord/{FilEndpoints.RentNamn(b.Namn == "" ? "Bild" : b.Namn)}.json"), Encoding.UTF8.GetBytes(b.Data));
        foreach (var s in skap)
            Lagg(zip, Unik(namnIZip, $"Ritningar/Apparatskåp/{FilEndpoints.RentNamn(s.Namn == "" ? "Skåp" : s.Namn)}.json"),
                JsonSerializer.SerializeToUtf8Bytes(new { s.Namn, s.Beteckning, s.Placering, s.Beskrivning, Data = Rå(s.Data), Moduler = Rå(s.Moduler) }, Json));

        // ---------- Projektfiler ----------
        var hoppadeOver = new List<string>();
        var sokvagar = new Dictionary<Guid, string>();
        if (medFiler)
            foreach (var f in filer)
            {
                await using var s = await lagring.OppnaAsync(f.BlobNamn, ct);
                if (s is null) { hoppadeOver.Add($"{f.Mapp}/{f.Namn}"); continue; }
                var sokvag = Unik(namnIZip, $"Projektfiler/{FilEndpoints.RentNamn(f.Mapp)}/{FilEndpoints.RentNamn(f.Namn)}");
                sokvagar[f.Id] = sokvag;
                var e = zip.CreateEntry(sokvag,
                    f.Namn.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) || f.Namn.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) || f.Namn.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                        ? CompressionLevel.Fastest : CompressionLevel.Optimal);
                await using var ut = e.Open();
                await s.CopyToAsync(ut, ct);
            }

        // ---------- projekt.json (allt, maskinläsbart) ----------
        var allt = new
        {
            Format = "Projekteringsverktyg projektexport",
            FormatVersion = 1,
            Exporterad = DateTimeOffset.UtcNow,
            Projekt = new { projekt.Id, projekt.Namn, projekt.Nummer, projekt.Kund, projekt.Ansvarig, projekt.Skapad, projekt.SkapadAv, projekt.Anteckningar },
            Komponenter = komponenter.Select(k => new
            {
                k.Id, k.System, k.Beteckning, k.Komponenttyp, k.Signaltyp, k.Beskrivning, k.AnslutsTill, k.Kabeltyp, k.Placering, k.Ovrigt,
                k.Produkttyp, k.Produkt, k.Monteringsanvisning, Signaler = Signaler.Las(k), k.Andrad, k.AndradAv,
            }),
            Listor = listrader.GroupBy(r => r.Lista).ToDictionary(g => g.Key, g => g.Select(r => new { r.Id, r.KomponentId, Data = ListEndpoints.LasData(r.Data), r.Ordning, r.Andrad, r.AndradAv })),
            Kontroller = kontroller.Select(k => new { k.Id, k.Typ, k.Namn, k.Beskrivning, k.MallNamn, k.Ordning }),
            Apparatskap = skap.Select(s => new { s.Id, s.Namn, s.Beteckning, s.Placering, s.Beskrivning, Data = Rå(s.Data), Moduler = Rå(s.Moduler), s.Ordning }),
            Dokument = dokument.Select(d => new { d.Id, d.Typ, d.Namn, d.Data, d.Ordning, d.Andrad, d.AndradAv }),
            AttGora = attGora.Select(a => new { a.Id, a.Text, a.Pagaende, a.Klar, a.Kommentar, a.Ordning, a.Andrad, a.AndradAv }),
            Status = status.Select(s => new { s.Id, Rubrik = rubriker.GetValueOrDefault(s.RubrikId)?.Namn, s.Text, s.Klar, s.UtfordAv, s.KlarDatum, s.Kommentar, s.Ordning }),
            Texter = texter.ToDictionary(t => t.Nyckel, t => t.Text),
            Placeringsritning = Rå(ritning?.Data),
            Ritbord = ritbord.Select(b => new { b.Id, b.Namn, Data = Rå(b.Data), b.Ordning }),
            // Sokvag = filen i zip-filen (saknas när projektfilerna inte togs med). Id behövs vid import:
            // ritningens bakgrunder och importerade funktionstexter pekar på filerna med sitt id.
            Filer = filer.Select(f => new { f.Id, f.Mapp, f.Namn, f.Version, f.Storlek, f.Typ, f.Uppladdad, f.UppladdadAv, Sokvag = sokvagar.GetValueOrDefault(f.Id) }),
        };
        Lagg(zip, "projekt.json", JsonSerializer.SerializeToUtf8Bytes(allt, Json));

        var las = new StringBuilder();
        las.AppendLine($"Projektexport – {projekt.Namn} {projekt.Nummer}".Trim());
        las.AppendLine($"Exporterad {Tid(DateTimeOffset.UtcNow):yyyy-MM-dd HH:mm} från Projekteringsverktyg.");
        las.AppendLine();
        las.AppendLine("Projektdata.xlsx   Översikt, komponenter, signallista, alla listor och kontroller (ett blad var), att göra, projektstatus och ändringslogg.");
        las.AppendLine("Funktionstexter/   Projektets funktionstexter som Word, med projektets sidfot.");
        las.AppendLine("Texter/            Anteckningar, projektinformation, serviceinformation m.m.");
        las.AppendLine("Ritningar/         Placeringsritningen, ritbordets bilder och apparatskåpen (maskinläsbart, JSON).");
        las.AppendLine(medFiler ? "Projektfiler/      Senaste versionen av varje projektfil (PDF-ritningar, driftkort, Word-filer …)." : "Projektfiler       Inte med i den här exporten.");
        las.AppendLine("projekt.json       Hela projektet i ett maskinläsbart format, för arkivering och framtida import.");
        if (!kansligt) las.AppendLine("\nAnslutningsinformation (användarnamn och lösenord) är inte med: bara projektets projektledare och Admin får exportera den.");
        if (hoppadeOver.Count > 0) las.AppendLine("\nFiler som inte kunde läsas: " + string.Join(", ", hoppadeOver));
        Lagg(zip, "LÄS MIG.txt", Encoding.UTF8.GetBytes(las.ToString()));
    }

    private static DateTime Tid(DateTimeOffset t) => (t + Excel.Svensk(t)).UtcDateTime;

    /// <summary>JSON-text som riktigt JSON i projekt.json (inte som en sträng), annars texten som den är.</summary>
    private static object? Rå(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try { return JsonDocument.Parse(json).RootElement.Clone(); } catch (JsonException) { return json; }
    }

    private static void Lagg(ZipArchive zip, string namn, byte[] data)
    {
        using var ut = zip.CreateEntry(namn, CompressionLevel.Optimal).Open();
        ut.Write(data);
    }

    private static string Unik(HashSet<string> anvanda, string namn)
    {
        if (anvanda.Add(namn)) return namn;
        var ext = Path.GetExtension(namn);
        var bas = namn[..^ext.Length];
        for (var i = 2; ; i++) if (anvanda.Add($"{bas} ({i}){ext}")) return $"{bas} ({i}){ext}";
    }
}
