using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using ClosedXML.Excel;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.Export;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.KomponentApi;

public sealed record KomponentMallDto(Guid Id, string Namn, List<Dictionary<string, string>> Rader, DateTimeOffset Andrad, string AndradAv);
public sealed record NyKomponentMall(string Namn, List<Dictionary<string, string>> Rader, bool SkrivOver = false);
public sealed record FranMall(Guid MallId, string? ErsattXx);

/// <summary>
/// Komponentmallar (gemensamma för alla projekt), import från Excel/CSV och export till Excel.
/// Allt som skapar komponenter här loggas och skickas ut i livesynken precis som en vanlig ny rad.
/// </summary>
public static partial class KomponentMallEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public const int MaxRader = 5000;

    /// <summary>Rubriker som känns igen vid import (gemener, utan mellanslag).</summary>
    private static readonly Dictionary<string, string> Rubriker = new()
    {
        ["beteckning"] = "beteckning", ["komponentnamn"] = "beteckning",
        ["system"] = "system",
        ["komponenttyp"] = "komponenttyp", ["typ"] = "komponenttyp",
        ["signaltyp"] = "signaltyp", ["signal"] = "signaltyp",
        ["placering"] = "placering",
        ["beskrivning"] = "beskrivning",
        ["övrigt"] = "ovrigt", ["ovrigt"] = "ovrigt",
        ["anslutstill"] = "anslutsTill", ["ansluts"] = "anslutsTill",
        ["kabeltyp"] = "kabeltyp", ["kabel"] = "kabeltyp",
        ["produkttyp"] = "produkttyp",
        ["produkt"] = "produkt", ["fabrikat"] = "produkt",
        ["monteringsanvisning"] = "monteringsanvisning",
    };

    public static string? Kolumn(string rubrik) =>
        Rubriker.GetValueOrDefault(rubrik.Trim().ToLowerInvariant().Replace(" ", "").Replace("_", ""));

    /// <summary>Byter "xx" (stora eller små bokstäver) mot det angivna numret i alla fält.</summary>
    public static string ErsattXx(string varde, string? med) =>
        string.IsNullOrEmpty(med) ? varde : XxRegex().Replace(varde, med);

    [GeneratedRegex("xx", RegexOptions.IgnoreCase)]
    private static partial Regex XxRegex();

    private static List<Dictionary<string, string>> LasRader(string json)
    {
        try { return JsonSerializer.Deserialize<List<Dictionary<string, string>>>(json, Json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static KomponentMallDto Dto(KomponentMall m) => new(m.Id, m.Namn, LasRader(m.Rader), m.Andrad, m.AndradAv);

    public static IEndpointRouteBuilder MapKomponentMallEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- Mallar (gemensamma) ----
        app.MapGet("/api/komponentmallar", async (PvDbContext db) =>
            (await db.Komponentmallar.OrderBy(m => m.Namn).ToListAsync()).Select(Dto));

        app.MapPost("/api/komponentmallar", async (NyKomponentMall ny, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System kan spara mallar.");
            var namn = (ny.Namn ?? "").Trim();
            if (namn == "" || ny.Rader is null || ny.Rader.Count == 0)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["namn"] = ["Ange ett namn och minst en rad."] });

            var rader = ny.Rader.Take(MaxRader).Select(r => r
                .Where(kv => KomponentFalt.ArTillatet(kv.Key) && !string.IsNullOrWhiteSpace(kv.Value))
                .ToDictionary(kv => kv.Key, kv => kv.Value.Trim())).ToList();
            var av = Anvandare.Fran(user);
            var mall = await db.Komponentmallar.FirstOrDefaultAsync(m => m.Namn == namn);
            if (mall is not null && !ny.SkrivOver)
                return Results.Conflict(new { meddelande = $"Det finns redan en mall som heter \"{namn}\"." });
            if (mall is null) { mall = new KomponentMall { Namn = namn }; db.Komponentmallar.Add(mall); }
            mall.Rader = JsonSerializer.Serialize(rader, Json);
            mall.Andrad = DateTimeOffset.UtcNow;
            mall.AndradAv = av.Namn;
            await db.SaveChangesAsync();
            return Results.Ok(Dto(mall));
        });

        app.MapDelete("/api/komponentmallar/{id:guid}", async (Guid id, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System kan ta bort mallar.");
            var mall = await db.Komponentmallar.FindAsync(id);
            if (mall is null) return Results.NotFound();
            db.Komponentmallar.Remove(mall);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- I ett projekt ----
        var g = app.MapGroup("/api/projekt/{projektId:guid}/komponenter").AddEndpointFilter<ProjektAtkomst>();

        g.MapPost("/fran-mall", async (Guid projektId, FranMall fran, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var mall = await db.Komponentmallar.FindAsync(fran.MallId);
            if (mall is null) return Results.NotFound();
            var rader = LasRader(mall.Rader)
                .Select(r => r.ToDictionary(kv => kv.Key, kv => ErsattXx(kv.Value, fran.ErsattXx?.Trim())))
                .ToList();
            var antal = await Skapa(projektId, rader, $"lade till {rader.Count} komponenter från mallen {mall.Namn}", user, db, hub);
            return antal is null ? Results.NotFound() : Results.Ok(new { antal });
        });

        g.MapPost("/import", async (Guid projektId, HttpRequest request, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) return Fel("Välj en Excel- eller CSV-fil.");
            var form = await request.ReadFormAsync(ct);
            var fil = form.Files.FirstOrDefault();
            if (fil is null) return Fel("Välj en Excel- eller CSV-fil.");

            List<Dictionary<string, string>> rader;
            try
            {
                await using var s = fil.OpenReadStream();
                rader = fil.FileName.EndsWith(".csv", StringComparison.OrdinalIgnoreCase) || fil.FileName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase)
                    ? LasCsv(s)
                    : LasExcel(s);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                return Fel($"Filen kunde inte läsas: {e.Message}");
            }
            if (rader.Count == 0) return Fel("Hittade inga rader. Första raden ska vara rubriker, t.ex. Beteckning, System, Komponenttyp.");
            if (rader.Count > MaxRader) return Fel($"Högst {MaxRader} rader per import.");

            var antal = await Skapa(projektId, rader, $"importerade {rader.Count} komponenter från {Path.GetFileName(fil.FileName)}", user, db, hub);
            return antal is null ? Results.NotFound() : Results.Ok(new { antal });
        }).DisableAntiforgery();

        g.MapGet("/excel", async (Guid projektId, PvDbContext db) =>
        {
            var projekt = await db.Projekt.FirstOrDefaultAsync(p => p.Id == projektId);
            if (projekt is null) return Results.NotFound();
            var lista = await db.Komponenter.Where(k => k.ProjektId == projektId)
                .OrderBy(k => k.System).ThenBy(k => k.Beteckning).ToListAsync();
            string[] falt = ["beteckning", "system", "komponenttyp", "signaltyp", "placering", "beskrivning", "ovrigt", "anslutsTill", "kabeltyp", "produkttyp", "produkt", "monteringsanvisning"];
            string[] rubriker = ["Beteckning", "System", "Komponenttyp", "Signaltyp", "Placering", "Beskrivning", "Övrigt", "Ansluts till", "Kabeltyp", "Produkttyp", "Fabrikat", "Monteringsanvisning"];
            var fil = Excel.Tabell("Komponenter", $"Komponenter – {projekt.Namn} {projekt.Nummer}".Trim(), rubriker,
                lista.Select(k => falt.Select(f => (object?)KomponentFalt.Hamta(k, f)).ToArray()));
            return Results.File(fil, Excel.MimeTyp, Excel.Filnamn($"Komponenter {projekt.Nummer}".Trim()));
        });

        return app;
    }

    /// <summary>Skapar komponenter från rader med fältnamn. Returnerar antal, eller null om projektet saknas.</summary>
    private static async Task<int?> Skapa(Guid projektId, List<Dictionary<string, string>> rader, string logg,
        ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub)
    {
        if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return null;
        var av = Anvandare.Fran(user);
        var nya = new List<Komponent>();
        foreach (var rad in rader)
        {
            var k = new Komponent { ProjektId = projektId, AndradAv = av.Namn };
            foreach (var (falt, varde) in rad)
                if (KomponentFalt.ArTillatet(falt) && !string.IsNullOrWhiteSpace(varde)) KomponentFalt.Satt(k, falt, varde);
            nya.Add(k);
        }
        db.Komponenter.AddRange(nya);
        Andringslogg.Logga(db, projektId, av, "Komponent", null, logg);
        await db.SaveChangesAsync();
        foreach (var k in nya)
            await hub.Clients.Group(ProjektHub.Grupp(projektId))
                .SendAsync("KomponentSkapad", new KomponentHandelse(KomponentDto.Fran(k), null, av.Id, av.Namn));
        return nya.Count;
    }

    public static List<Dictionary<string, string>> LasCsv(Stream s)
    {
        using var r = new StreamReader(s, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var rader = new List<string>();
        while (r.ReadLine() is { } l) rader.Add(l);
        if (rader.Count < 2) return [];
        var sep = rader[0].Count(c => c == ';') >= rader[0].Count(c => c == ',') ? ';' : ',';
        var kolumner = rader[0].Split(sep).Select(Kolumn).ToArray();
        return rader.Skip(1).Where(l => l.Trim() != "").Select(l =>
        {
            var c = l.Split(sep);
            var d = new Dictionary<string, string>();
            for (var i = 0; i < kolumner.Length && i < c.Length; i++)
                if (kolumner[i] is { } f) d[f] = c[i].Trim().Trim('"');
            return d;
        }).Where(d => d.Values.Any(v => v != "")).ToList();
    }

    public static List<Dictionary<string, string>> LasExcel(Stream s)
    {
        using var wb = new XLWorkbook(s);
        var ws = wb.Worksheets.First();
        var anvant = ws.RangeUsed();
        if (anvant is null) return [];
        // Rubrikraden = första raden där minst två kolumner känns igen (exporten har titelrader överst).
        var forsta = anvant.FirstRow().RowNumber();
        var sista = anvant.LastRow().RowNumber();
        var sistaKol = anvant.LastColumn().ColumnNumber();
        int rubrikRad = -1;
        string?[] kolumner = [];
        for (var r = forsta; r <= Math.Min(forsta + 10, sista) && rubrikRad < 0; r++)
        {
            var k = Enumerable.Range(1, sistaKol).Select(c => Kolumn(ws.Cell(r, c).GetString())).ToArray();
            if (k.Count(x => x is not null) >= 2) { rubrikRad = r; kolumner = k; }
        }
        if (rubrikRad < 0) return [];
        var ut = new List<Dictionary<string, string>>();
        for (var r = rubrikRad + 1; r <= sista; r++)
        {
            var d = new Dictionary<string, string>();
            for (var c = 1; c <= kolumner.Length; c++)
                if (kolumner[c - 1] is { } f) d[f] = ws.Cell(r, c).GetFormattedString().Trim();
            if (d.Values.Any(v => v != "")) ut.Add(d);
        }
        return ut;
    }

    private static IResult Fel(string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["fil"] = [text] });
}
