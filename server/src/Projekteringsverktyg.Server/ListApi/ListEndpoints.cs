using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.Export;
using Projekteringsverktyg.Server.KomponentApi;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.ListApi;

public sealed record ListRadDto(Guid Id, Guid? KomponentId, Dictionary<string, string> Data, int Ordning, int Version, DateTimeOffset Andrad, string AndradAv);
public sealed record ListFaltAndring(string Falt, string? Varde, int Version);

/// <summary>
/// Gemensam motor för alla enkla listor. Vilka listor och kolumner som finns står i Listdefinitioner.
/// Komponentkopplade listor sparar bara sina egna fält; komponentens uppgifter läses alltid från Komponenter.
/// </summary>
public static class ListEndpoints
{
    public const int MaxLangd = 4000;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static Dictionary<string, string> LasData(string json)
    {
        try { return JsonSerializer.Deserialize<Dictionary<string, string>>(json, Json) ?? new(); }
        catch (JsonException) { return new(); }
    }

/// <summary>Fasta löpnummer (typ nummer): nästa nummer efter det högsta som finns i listan.</summary>
    public static void SattNummer(ListDef def, Dictionary<string, string> data, IEnumerable<ListRad> befintliga, int extra = 0)
    {
        foreach (var k in def.Kolumner.Where(k => k.Typ == "nummer"))
        {
            var hogsta = befintliga.Select(r => LasData(r.Data).GetValueOrDefault(k.Nyckel, ""))
                .Select(v => System.Text.RegularExpressions.Regex.Match(v, @"\d+")).Where(m => m.Success)
                .Select(m => int.TryParse(m.Value, out var n) ? n : 0).DefaultIfEmpty(0).Max();
            data[k.Nyckel] = string.Format(System.Globalization.CultureInfo.InvariantCulture, k.Standard ?? "{0}", hogsta + 1 + extra);
        }
    }

    public static ListRadDto Dto(ListRad r) => new(r.Id, r.KomponentId, LasData(r.Data), r.Ordning, r.Version, r.Andrad, r.AndradAv);

    /// <summary>Signatur av ett namn: "Erik Engström" blir "EE".</summary>
    public static string Initialer(string namn)
    {
        var delar = namn.Split([' ', '.', '-'], StringSplitOptions.RemoveEmptyEntries);
        if (delar.Length == 0) return "";
        if (delar.Length == 1) return delar[0].Length <= 3 ? delar[0].ToUpperInvariant() : delar[0][..3].ToUpperInvariant();
        return string.Concat(delar.Take(3).Select(d => char.ToUpperInvariant(d[0])));
    }

    /// <summary>
    /// Sätter ett fält i radens data. Bockas en kryssruta i som har datum/signatur kopplat fylls de i,
    /// bockas den ur töms de. Returnerar (före, efter) för loggen.
    /// </summary>
    public static (string Fore, string Efter) Satt(KolumnDef kol, Dictionary<string, string> data, string? varde, string avNamn, DateOnly idag)
    {
        var fore = data.GetValueOrDefault(kol.Nyckel, kol.Standard ?? "");
        var nytt = (varde ?? "").Trim();
        if (nytt.Length > MaxLangd) nytt = nytt[..MaxLangd];

        if (kol.Typ == "kryss")
        {
            var pa = string.Equals(nytt, "true", StringComparison.OrdinalIgnoreCase);
            nytt = pa ? "true" : "";
            if (kol.SatterDatum is not null) data[kol.SatterDatum] = pa ? idag.ToString("yyyy-MM-dd") : "";
            if (kol.SatterSign is not null) data[kol.SatterSign] = pa ? Initialer(avNamn) : "";
            if (pa && kol.Utesluter is not null) foreach (var x in kol.Utesluter) data[x] = "";
        }
        // Valkolumner tillåter även egna värden, precis som i dagens program.
        data[kol.Nyckel] = nytt;
        return (fore, nytt);
    }

    public static IEndpointRouteBuilder MapListEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/listdefinitioner", () => Listdefinitioner.Alla.Append(Listdefinitioner.Kontroll).Append(Listdefinitioner.Kraft).Select(d => new
        {
            d.Id, d.Namn, d.Grupp, d.Ingress, d.Kopplad, d.KomponenttypInnehaller, d.Bindestreck, d.Hamtar,
            kolumner = d.Kolumner.Select(k => new { k.Nyckel, k.Rubrik, k.Typ, k.Val, k.KomponentFalt, k.Standard, k.Mono, k.Bredd, k.Redigerbar, k.Fyll, k.Faktorer, k.Forslag, k.KopplingSignaltyp }),
        }));

        var g = app.MapGroup("/api/projekt/{projektId:guid}/listor/{lista}").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, string lista, PvDbContext db) =>
        {
            if (Listdefinitioner.Hitta(lista) is null) return Results.NotFound();
            var rader = await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista)
                .OrderBy(r => r.Ordning).ThenBy(r => r.Andrad).ToListAsync();
            return Results.Ok(rader.Where(r => !AutoRader.ArDold(r)).Select(Dto));
        });

        // Listor som hämtar rader från Komponenter (Kraftberäkning, Mätplan): lägg till det som saknas.
        g.MapPost("/hamta-komponenter", async (Guid projektId, string lista, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var def = Listdefinitioner.Hitta(lista);
            if (def is null || def.Hamtar is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var nya = await AutoRader.LaggTillSaknadeAsync(db, projektId, def, lista, av);
            if (nya.Count == 0) return Results.Ok(Array.Empty<ListRadDto>());
            // Två som öppnar listan samtidigt: den andra får krock på unika indexet och gör inget.
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { return Results.Ok(Array.Empty<ListRadDto>()); }
            foreach (var rad in nya) await Skicka(hub, projektId, lista, "skapad", Dto(rad), av);
            return Results.Ok(nya.Select(Dto));
        });

        // Ny rad i en fri lista.
        g.MapPost("/", async (Guid projektId, string lista, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var def = Listdefinitioner.Hitta(lista);
            if (def is null) return Results.NotFound();
            if (def.Kopplad) return Fel("lista", "Raderna i den här listan skapas från Komponenter.");
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();

            var av = Anvandare.Fran(user);
            var max = await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista).MaxAsync(r => (int?)r.Ordning) ?? 0;
            var data = def.Kolumner.Where(k => k.Standard is not null && k.Typ != "nummer").ToDictionary(k => k.Nyckel, k => k.Standard!);
            if (def.Kolumner.Any(k => k.Typ == "nummer"))
                SattNummer(def, data, await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista).ToListAsync());
            var rad = new ListRad { ProjektId = projektId, Lista = lista, Ordning = max + 1, Data = JsonSerializer.Serialize(data, Json), AndradAv = av.Namn };
            db.ListRader.Add(rad);
            Andringslogg.Logga(db, projektId, av, "Lista", rad.Id, $"lade till en rad i {def.Namn}");
            await db.SaveChangesAsync();
            var dto = Dto(rad);
            await Skicka(hub, projektId, lista, "skapad", dto, av);
            return Results.Created($"/api/projekt/{projektId}/listor/{lista}/{rad.Id}", dto);
        });

        // Flera nya rader på en gång i en fri lista (t.ex. "Lägg till vanliga risker").
        g.MapPost("/flera", async (Guid projektId, string lista, List<Dictionary<string, string>> nya, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var def = Listdefinitioner.Hitta(lista);
            if (def is null) return Results.NotFound();
            if (def.Kopplad) return Fel("lista", "Raderna i den här listan skapas från Komponenter.");
            if (nya.Count is 0 or > 500) return Fel("rader", "Mellan 1 och 500 rader per gång.");
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();

            var av = Anvandare.Fran(user);
            var max = await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista).MaxAsync(r => (int?)r.Ordning) ?? 0;
            var skapade = new List<ListRad>();
            var harNummer = def.Kolumner.Any(k => k.Typ == "nummer");
            List<ListRad> befintligaRader = harNummer
                ? await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista).ToListAsync() : new List<ListRad>();
            foreach (var n in nya)
            {
                var data = def.Kolumner.Where(k => k.Standard is not null && k.Typ != "nummer").ToDictionary(k => k.Nyckel, k => k.Standard!);
                if (harNummer) SattNummer(def, data, befintligaRader, skapade.Count);
                foreach (var (falt, varde) in n)
                    if (def.Kolumn(falt) is { Redigerbar: true } && !string.IsNullOrWhiteSpace(varde))
                        data[falt] = varde.Length > MaxLangd ? varde[..MaxLangd] : varde.Trim();
                var rad = new ListRad { ProjektId = projektId, Lista = lista, Ordning = ++max, Data = JsonSerializer.Serialize(data, Json), AndradAv = av.Namn };
                db.ListRader.Add(rad);
                skapade.Add(rad);
            }
            Andringslogg.Logga(db, projektId, av, "Lista", null, $"lade till {skapade.Count} rader i {def.Namn}");
            await db.SaveChangesAsync();
            foreach (var rad in skapade) await Skicka(hub, projektId, lista, "skapad", Dto(rad), av);
            return Results.Ok(skapade.Select(Dto));
        });

        // Ändra ett fält på en befintlig rad.
        g.MapPatch("/{radId:guid}", async (Guid projektId, string lista, Guid radId, ListFaltAndring andring, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var def = Listdefinitioner.Hitta(lista);
            if (def is null) return Results.NotFound();
            var kol = def.Kolumn(andring.Falt);
            if (kol is null || !kol.Redigerbar) return Fel("falt", $"Fältet '{andring.Falt}' kan inte ändras här.");

            var rad = await db.ListRader.FirstOrDefaultAsync(r => r.Id == radId && r.ProjektId == projektId && r.Lista == lista);
            if (rad is null) return Results.NotFound();
            if (rad.Version != andring.Version)
                return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan.", rad = Dto(rad) });

            return await Spara(db, hub, user, def, kol, rad, andring.Varde, ny: false);
        });

        // Ändra ett fält i en komponentkopplad lista. Raden skapas första gången något fylls i.
        g.MapPatch("/komponent/{komponentId:guid}", async (Guid projektId, string lista, Guid komponentId, ListFaltAndring andring, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var def = Listdefinitioner.Hitta(lista);
            if (def is null || !def.Kopplad) return Results.NotFound();
            var kol = def.Kolumn(andring.Falt);
            if (kol is null || !kol.Redigerbar) return Fel("falt", $"Fältet '{andring.Falt}' kan inte ändras här. Ändra det i Komponenter.");
            if (!await db.Komponenter.AnyAsync(k => k.Id == komponentId && k.ProjektId == projektId)) return Results.NotFound();

            var rad = await db.ListRader.FirstOrDefaultAsync(r => r.ProjektId == projektId && r.Lista == lista && r.KomponentId == komponentId);
            var ny = rad is null;
            if (rad is null)
            {
                if (andring.Version != 0)
                    return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan." });
                var data = def.Kolumner.Where(k => k.Standard is not null).ToDictionary(k => k.Nyckel, k => k.Standard!);
                rad = new ListRad { ProjektId = projektId, Lista = lista, KomponentId = komponentId, Data = JsonSerializer.Serialize(data, Json), Version = 0 };
                db.ListRader.Add(rad);
            }
            else if (rad.Version != andring.Version)
            {
                return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan.", rad = Dto(rad) });
            }

            return await Spara(db, hub, user, def, kol, rad, andring.Varde, ny);
        });

        g.MapDelete("/{radId:guid}", async (Guid projektId, string lista, Guid radId, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var def = Listdefinitioner.Hitta(lista);
            if (def is null) return Results.NotFound();
            if (def.Kopplad) return Fel("lista", "Raderna i den här listan följer Komponenter. Ta bort komponenten där i stället.");
            var rad = await db.ListRader.FirstOrDefaultAsync(r => r.Id == radId && r.ProjektId == projektId && r.Lista == lista);
            if (rad is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var dto = Dto(rad);
            if (def.Hamtar is not null && rad.KomponentId is not null)
            {
                // Hämtad från Komponenter: döljs, annars läggs den till igen nästa gång listan öppnas.
                var data = LasData(rad.Data);
                data[AutoRader.Dold] = "true";
                rad.Data = JsonSerializer.Serialize(data, Json);
                rad.Version++;
                rad.Andrad = DateTimeOffset.UtcNow;
                rad.AndradAv = av.Namn;
            }
            else db.ListRader.Remove(rad);
            Andringslogg.Logga(db, projektId, av, "Lista", rad.Id, $"tog bort en rad i {def.Namn}");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, lista, "borttagen", dto, av);
            return Results.NoContent();
        });

        g.MapGet("/excel", async (Guid projektId, string lista, PvDbContext db) =>
        {
            var projekt = await db.Projekt.FirstOrDefaultAsync(p => p.Id == projektId);
            if (projekt is null) return Results.NotFound();
            var tabell = await ExportTabellAsync(db, projektId, lista);
            if (tabell is null) return Results.NotFound();
            var (namn, rubriker, rader) = tabell.Value;
            var fil = Excel.Tabell(namn, $"{namn} – {projekt.Namn} {projekt.Nummer}".Trim(), rubriker, rader);
            return Results.File(fil, Excel.MimeTyp, Excel.Filnamn($"{namn} {projekt.Nummer}".Trim()));
        });

        return app;
    }

    /// <summary>En lista som rubriker och rader för export (Excel-fil eller blad i projektexporten). Null = okänd lista.</summary>
    public static async Task<(string Namn, List<string> Rubriker, List<object?[]> Rader)?> ExportTabellAsync(PvDbContext db, Guid projektId, string lista)
    {
        var def = Listdefinitioner.Hitta(lista);
        if (def is null) return null;

        var kolumner = def.ExportKolumner is { } ek
            ? def.Kolumner.Where(k => ek.Contains(k.Nyckel)).ToList()
            : def.Kolumner.ToList();
        var sparade = (await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista)
            .OrderBy(r => r.Ordning).ThenBy(r => r.Andrad).ToListAsync()).Where(r => !AutoRader.ArDold(r)).ToList();

        var rader = new List<object?[]>();
        if (def.Kopplad)
        {
            var perKomponent = sparade.Where(r => r.KomponentId is not null).GroupBy(r => r.KomponentId!.Value).ToDictionary(g => g.Key, g => g.First());
            var komponenter = await db.Komponenter.Where(k => k.ProjektId == projektId)
                .OrderBy(k => k.System).ThenBy(k => k.Beteckning).ToListAsync();
            var nr = 0;
            foreach (var k in komponenter.Where(k => Listdefinitioner.Omfattar(def, k.Komponenttyp)))
            {
                var data = perKomponent.TryGetValue(k.Id, out var r) ? LasData(r.Data) : new();
                nr++;
                rader.Add(kolumner.Select(c => (object?)Cell(c, data, k, nr, def.Bindestreck)).ToArray());
            }
        }
        else
        {
            var nr = 0;
            List<Komponent>? allaKomponenter = def.Kolumner.Any(k => k.Typ is "antal" or "fran" or "koppling")
                ? await db.Komponenter.AsNoTracking().Where(k => k.ProjektId == projektId).ToListAsync() : null;
            foreach (var r in sparade)
            {
                nr++;
                var data = LasData(r.Data);
                KolumnDef.BeraknaAlla(def.Kolumner, data, allaKomponenter);
                foreach (var kk in def.Kolumner.Where(x => x.Typ == "koppling"))
                    if (KolumnDef.HittaKoppling(data.GetValueOrDefault(kk.Nyckel, ""), allaKomponenter) is { } kp) data[kk.Nyckel] = kp.Beteckning;
                rader.Add(kolumner.Select(c => (object?)Cell(c, data, null, nr, false)).ToArray());
            }
        }

        var namn = def.Namn;
        if (lista.StartsWith(Listdefinitioner.KontrollPrefix) && Guid.TryParse(lista[Listdefinitioner.KontrollPrefix.Length..], out var kid))
            namn = await db.Kontroller.Where(k => k.Id == kid && k.ProjektId == projektId).Select(k => k.Namn).FirstOrDefaultAsync() ?? namn;
        if (lista.StartsWith(Listdefinitioner.KraftPrefix) && Guid.TryParse(lista[Listdefinitioner.KraftPrefix.Length..], out var sid))
            namn = "Kraftberäkning " + (await db.Skap.Where(k => k.Id == sid && k.ProjektId == projektId).Select(k => k.Namn).FirstOrDefaultAsync() ?? "");
        return (namn, kolumner.Select(c => c.Rubrik).ToList(), rader);
    }

    private static string Cell(KolumnDef c, Dictionary<string, string> data, Komponent? k, int nr, bool bindestreck) => c.Typ switch
    {
        "komponent" when k is not null && c.KomponentFalt is not null =>
            bindestreck ? KomponentFalt.Hamta(k, c.KomponentFalt).Replace('_', '-') : KomponentFalt.Hamta(k, c.KomponentFalt),
        "lopnr" => nr.ToString(),
        "produkt" => c.Berakna(data),
        "antal" or "differens" or "fran" or "koppling" => data.GetValueOrDefault(c.Nyckel, ""),
        "kryss" => data.GetValueOrDefault(c.Nyckel) == "true" ? "Ja" : "",
        "datum" => Datum(data.GetValueOrDefault(c.Nyckel, "")),
        "nummer" => data.GetValueOrDefault(c.Nyckel, ""),
        _ => data.GetValueOrDefault(c.Nyckel, c.Standard ?? ""),
    };

    /// <summary>
    /// Datum i export och utskrift: bara ett riktigt valt datum visas. Inget valt (eller ett "nolldatum" som 0001-01-01)
    /// blir helt tomt, så att teknikern kan fylla i rutan för hand på papper.
    /// </summary>
    public static string Datum(string v)
    {
        v = (v ?? "").Trim();
        if (v == "") return "";
        return DateOnly.TryParse(v.Length >= 10 ? v[..10] : v, System.Globalization.CultureInfo.InvariantCulture, out var d)
            ? (d.Year < 1900 ? "" : d.ToString("yyyy-MM-dd")) : v;
    }

    private static async Task<IResult> Spara(PvDbContext db, IHubContext<ProjektHub> hub, ClaimsPrincipal user, ListDef def, KolumnDef kol, ListRad rad, string? varde, bool ny)
    {
        var av = Anvandare.Fran(user);
        var data = LasData(rad.Data);
        var (fore, efter) = Satt(kol, data, varde, av.Namn, DateOnly.FromDateTime(DateTime.UtcNow + Excel.Svensk(DateTimeOffset.UtcNow)));
        if (fore == efter && !ny) return Results.Ok(Dto(rad));

        rad.Data = JsonSerializer.Serialize(data, Json);
        rad.Version++;
        rad.Andrad = DateTimeOffset.UtcNow;
        rad.AndradAv = av.Namn;

        var vem = "";
        if (rad.KomponentId is { } kid)
            vem = await db.Komponenter.Where(k => k.Id == kid).Select(k => k.Beteckning).FirstOrDefaultAsync() ?? "";
        var beskrivning = kol.Typ == "kryss"
            ? $"{(efter == "true" ? "bockade i" : "bockade ur")} {kol.Rubrik} i {def.Namn}{(vem != "" ? $" för {vem}" : "")}"
            : $"ändrade {kol.Rubrik} i {def.Namn}{(vem != "" ? $" för {vem}" : "")}";
        Andringslogg.Logga(db, rad.ProjektId, av, "Lista", rad.KomponentId ?? rad.Id, beskrivning, kol.Nyckel, fore, efter);

        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan." }); }
        catch (DbUpdateException) when (ny) { return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan." }); }

        var dto = Dto(rad);
        await Skicka(hub, rad.ProjektId, def.Id, ny ? "skapad" : "andrad", dto, av);
        return Results.Ok(dto);
    }

    private static Task Skicka(IHubContext<ProjektHub> hub, Guid projektId, string lista, string typ, ListRadDto dto, Anvandare av) =>
        hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse($"lista:{lista}", typ, dto, av.Id, av.Namn));

    private static IResult Fel(string falt, string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [falt] = [text] });
}
