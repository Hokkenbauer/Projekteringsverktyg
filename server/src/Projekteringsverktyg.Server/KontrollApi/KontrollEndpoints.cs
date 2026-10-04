using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ListApi;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.KontrollApi;

public sealed record KontrollMallDto(Guid Id, string Typ, string Namn, string Beskrivning, List<string> Punkter, DateTimeOffset Andrad, string AndradAv);
public sealed record NyKontrollMall(string Typ, string Namn, string? Beskrivning, List<string> Punkter, bool SkrivOver = false);
public sealed record KontrollDto(Guid Id, string Typ, string Namn, string Beskrivning, string MallNamn, int Ordning, int Antal, int Klara, DateTimeOffset Andrad, string AndradAv);
public sealed record NyKontroll(string Typ, string? Namn, Guid? MallId);
public sealed record KontrollAndring(string? Namn, string? Beskrivning);
public sealed record SomMall(string Namn, bool SkrivOver = false);

/// <summary>
/// Kontroller med kontrollpunkter: Projektspecifika kontroller (typ projekt), Projekteringsegenkontroll
/// (projektering) och Kontroller under Service (service). Mallarna är gemensamma för alla projekt.
/// Kontrollpunkterna hanteras av listmotorn (lista "kontroll-{Id}").
/// </summary>
public static class KontrollEndpoints
{
    public static readonly string[] Typer = ["projekt", "projektering", "service"];
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private static List<string> Punkter(string json)
    {
        try { return JsonSerializer.Deserialize<List<string>>(json, Json) ?? []; }
        catch (JsonException) { return []; }
    }

    private static KontrollMallDto Dto(KontrollMall m) => new(m.Id, m.Typ, m.Namn, m.Beskrivning, Punkter(m.Punkter), m.Andrad, m.AndradAv);

    public static IEndpointRouteBuilder MapKontrollEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- Mallar ----
        app.MapGet("/api/kontrollmallar", async (string? typ, PvDbContext db) =>
            (await db.Kontrollmallar.Where(m => typ == null || m.Typ == typ).OrderBy(m => m.Namn).ToListAsync()).Select(Dto));

        app.MapPost("/api/kontrollmallar", async (NyKontrollMall ny, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System kan spara mallar.");
            var fel = await SparaMall(db, Anvandare.Fran(user), ny.Typ, ny.Namn, ny.Beskrivning ?? "", ny.Punkter, ny.SkrivOver);
            return fel ?? Results.Ok();
        });

        app.MapDelete("/api/kontrollmallar/{id:guid}", async (Guid id, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System kan ta bort mallar.");
            var m = await db.Kontrollmallar.FindAsync(id);
            if (m is null) return Results.NotFound();
            db.Kontrollmallar.Remove(m);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- Kontroller i ett projekt ----
        var g = app.MapGroup("/api/projekt/{projektId:guid}/kontroller").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, string? typ, PvDbContext db) =>
        {
            var kontroller = await db.Kontroller.Where(k => k.ProjektId == projektId && (typ == null || k.Typ == typ))
                .OrderBy(k => k.Ordning).ThenBy(k => k.Andrad).ToListAsync();
            var listnamn = kontroller.Select(k => Listdefinitioner.KontrollPrefix + k.Id).ToList();
            var rader = await db.ListRader.Where(r => r.ProjektId == projektId && listnamn.Contains(r.Lista))
                .Select(r => new { r.Lista, r.Data }).ToListAsync();
            return kontroller.Select(k =>
            {
                var egna = rader.Where(r => r.Lista == Listdefinitioner.KontrollPrefix + k.Id).ToList();
                var klara = egna.Count(r => ListEndpoints.LasData(r.Data).GetValueOrDefault("kontrollerad") == "true");
                return new KontrollDto(k.Id, k.Typ, k.Namn, k.Beskrivning, k.MallNamn, k.Ordning, egna.Count, klara, k.Andrad, k.AndradAv);
            });
        });

        g.MapPost("/", async (Guid projektId, NyKontroll ny, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!Typer.Contains(ny.Typ)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["typ"] = ["Okänd typ."] });
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();
            KontrollMall? mall = null;
            if (ny.MallId is { } mid)
            {
                mall = await db.Kontrollmallar.FindAsync(mid);
                if (mall is null) return Results.NotFound();
            }
            var av = Anvandare.Fran(user);
            var max = await db.Kontroller.Where(k => k.ProjektId == projektId && k.Typ == ny.Typ).MaxAsync(k => (int?)k.Ordning) ?? 0;
            var namn = (ny.Namn ?? "").Trim();
            var kontroll = new Kontroll
            {
                ProjektId = projektId, Typ = ny.Typ, Ordning = max + 1, AndradAv = av.Namn,
                Namn = namn != "" ? namn : mall?.Namn ?? "Ny kontroll",
                Beskrivning = mall?.Beskrivning ?? "", MallNamn = mall?.Namn ?? "",
            };
            db.Kontroller.Add(kontroll);
            var nr = 0;
            foreach (var punkt in mall is null ? new List<string>() : Punkter(mall.Punkter))
            {
                db.ListRader.Add(new ListRad
                {
                    ProjektId = projektId, Lista = Listdefinitioner.KontrollPrefix + kontroll.Id, Ordning = ++nr, AndradAv = av.Namn,
                    Data = JsonSerializer.Serialize(new Dictionary<string, string> { ["kontrollpunkt"] = punkt }, Json),
                });
            }
            Andringslogg.Logga(db, projektId, av, "Kontroll", kontroll.Id,
                mall is null ? $"skapade kontrollen {kontroll.Namn}" : $"skapade kontrollen {kontroll.Namn} från mall ({nr} punkter)");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "skapad", kontroll, av);
            return Results.Ok(new KontrollDto(kontroll.Id, kontroll.Typ, kontroll.Namn, kontroll.Beskrivning, kontroll.MallNamn, kontroll.Ordning, nr, 0, kontroll.Andrad, kontroll.AndradAv));
        });

        g.MapPatch("/{id:guid}", async (Guid projektId, Guid id, KontrollAndring andring, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var k = await db.Kontroller.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (k is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            if (andring.Namn is { } n && n.Trim() != "" && n.Trim() != k.Namn)
            {
                Andringslogg.Logga(db, projektId, av, "Kontroll", k.Id, $"döpte om kontrollen {k.Namn}", "namn", k.Namn, n.Trim());
                k.Namn = n.Trim();
            }
            if (andring.Beskrivning is { } b && b != k.Beskrivning)
            {
                Andringslogg.Logga(db, projektId, av, "Kontroll", k.Id, $"ändrade beskrivningen för {k.Namn}", "beskrivning", k.Beskrivning, b);
                k.Beskrivning = b;
            }
            k.Andrad = DateTimeOffset.UtcNow;
            k.AndradAv = av.Namn;
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "andrad", k, av);
            return Results.Ok();
        });

        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var k = await db.Kontroller.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (k is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var lista = Listdefinitioner.KontrollPrefix + k.Id;
            db.ListRader.RemoveRange(await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista).ToListAsync());
            db.Kontroller.Remove(k);
            Andringslogg.Logga(db, projektId, av, "Kontroll", k.Id, $"tog bort kontrollen {k.Namn}");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "borttagen", k, av);
            return Results.NoContent();
        });

        // Spara kontrollens punkter som en ny mall (eller skriv över en befintlig).
        g.MapPost("/{id:guid}/som-mall", async (Guid projektId, Guid id, SomMall som, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System kan spara mallar.");
            var k = await db.Kontroller.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (k is null) return Results.NotFound();
            var lista = Listdefinitioner.KontrollPrefix + k.Id;
            var punkter = (await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == lista).OrderBy(r => r.Ordning).ToListAsync())
                .Select(r => ListEndpoints.LasData(r.Data).GetValueOrDefault("kontrollpunkt", "").Trim())
                .Where(p => p != "").ToList();
            var fel = await SparaMall(db, Anvandare.Fran(user), k.Typ, som.Namn, k.Beskrivning, punkter, som.SkrivOver);
            return fel ?? Results.Ok(new { antal = punkter.Count });
        });

        return app;
    }

    private static async Task<IResult?> SparaMall(PvDbContext db, Anvandare av, string typ, string namn, string beskrivning, List<string> punkter, bool skrivOver)
    {
        namn = (namn ?? "").Trim();
        if (!Typer.Contains(typ) || namn == "" || punkter is null || punkter.Count == 0)
            return Results.ValidationProblem(new Dictionary<string, string[]> { ["namn"] = ["Ange ett namn och minst en kontrollpunkt."] });
        var m = await db.Kontrollmallar.FirstOrDefaultAsync(x => x.Typ == typ && x.Namn == namn);
        if (m is not null && !skrivOver) return Results.Conflict(new { meddelande = $"Det finns redan en mall som heter \"{namn}\"." });
        if (m is null) { m = new KontrollMall { Typ = typ, Namn = namn }; db.Kontrollmallar.Add(m); }
        m.Beskrivning = beskrivning;
        m.Punkter = JsonSerializer.Serialize(punkter.Select(p => p.Trim()).Where(p => p != "").ToList(), Json);
        m.Andrad = DateTimeOffset.UtcNow;
        m.AndradAv = av.Namn;
        await db.SaveChangesAsync();
        return null;
    }

    private static Task Skicka(IHubContext<ProjektHub> hub, Guid projektId, string typ, Kontroll k, Anvandare av) =>
        hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad",
            new ListaHandelse("kontroller", typ, new { k.Id, k.Typ, k.Namn }, av.Id, av.Namn));
}
