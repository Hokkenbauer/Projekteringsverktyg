using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.ProjektApi;

public sealed record RitbordBildInfo(Guid Id, string Namn, int Ordning, int Version, DateTimeOffset Andrad, string AndradAv);
public sealed record RitbordBildDto(Guid Id, string Namn, string Data, int Version, DateTimeOffset Andrad, string AndradAv);
public sealed record NyRitbordBild(string Namn);
public sealed record RitbordBildSpara(string Data, int Version);
public sealed record RitbordBildNamn(string Namn);
public sealed record RitbordInstallningDto(string? Data, DateTimeOffset? Andrad, string AndradAv);
public sealed record RitbordInstallningSpara(string Data);

/// <summary>
/// Ritbordet: flera bilder (SCADA-bakgrunder/flödesbilder) per projekt, som sparas automatiskt.
/// Kundstandarder, symboler och mallar är gemensamma för alla och ändras av Admin, Projektledare och System.
/// </summary>
public static class RitbordEndpoints
{
    public const int MaxLangd = 30_000_000;

    private static RitbordBildInfo Info(RitbordBild b) => new(b.Id, b.Namn, b.Ordning, b.Version, b.Andrad, b.AndradAv);

    public static IEndpointRouteBuilder MapRitbordEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- Gemensamma inställningar ----
        app.MapGet("/api/ritbord/installningar", async (PvDbContext db) =>
        {
            var i = await db.RitbordInstallningar.AsNoTracking().FirstOrDefaultAsync(x => x.Id == 1);
            return new RitbordInstallningDto(i?.Data, i?.Andrad, i?.AndradAv ?? "");
        });

        app.MapPut("/api/ritbord/installningar", async (RitbordInstallningSpara spara, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System kan ändra Ritbordets gemensamma inställningar.");
            if (string.IsNullOrWhiteSpace(spara.Data) || spara.Data.Length > MaxLangd)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["data"] = ["Inställningarna är tomma eller för stora."] });
            var av = Anvandare.Fran(user);
            var i = await db.RitbordInstallningar.FirstOrDefaultAsync(x => x.Id == 1);
            if (i is null) { i = new RitbordInstallning(); db.RitbordInstallningar.Add(i); }
            i.Data = spara.Data;
            i.Andrad = DateTimeOffset.UtcNow;
            i.AndradAv = av.Namn;
            await db.SaveChangesAsync();
            return Results.Ok(new RitbordInstallningDto(null, i.Andrad, i.AndradAv));
        });

        // ---- Bilder i ett projekt ----
        var g = app.MapGroup("/api/projekt/{projektId:guid}/ritbord").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
            (await db.RitbordBilder.AsNoTracking().Where(b => b.ProjektId == projektId)
                .OrderBy(b => b.Ordning).ThenBy(b => b.Namn).ToListAsync()).Select(Info));

        g.MapGet("/{id:guid}", async (Guid projektId, Guid id, PvDbContext db) =>
            await db.RitbordBilder.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id && b.ProjektId == projektId) is { } b
                ? Results.Ok(new RitbordBildDto(b.Id, b.Namn, b.Data, b.Version, b.Andrad, b.AndradAv))
                : Results.NotFound());

        g.MapPost("/", async (Guid projektId, NyRitbordBild ny, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var max = await db.RitbordBilder.Where(b => b.ProjektId == projektId).MaxAsync(b => (int?)b.Ordning) ?? 0;
            var namn = (ny.Namn ?? "").Trim();
            var b = new RitbordBild { ProjektId = projektId, Namn = namn == "" ? $"Bild {max + 1}" : namn, Ordning = max + 1, AndradAv = av.Namn };
            db.RitbordBilder.Add(b);
            Andringslogg.Logga(db, projektId, av, "Ritbord", b.Id, $"skapade bilden {b.Namn} i Ritbord");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "skapad", b, av);
            return Results.Ok(Info(b));
        });

        g.MapPut("/{id:guid}", async (Guid projektId, Guid id, RitbordBildSpara spara, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (spara.Data is null || spara.Data.Length > MaxLangd)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["data"] = ["Bilden är för stor."] });
            var b = await db.RitbordBilder.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (b is null) return Results.NotFound();
            if (b.Version != spara.Version)
                return Results.Conflict(new { meddelande = "Bilden har ändrats av någon annan." });
            if (b.Data == spara.Data) return Results.Ok(Info(b));

            var av = Anvandare.Fran(user);
            b.Data = spara.Data;
            b.Version++;
            b.Andrad = DateTimeOffset.UtcNow;
            b.AndradAv = av.Namn;
            // Sparas automatiskt medan man ritar: högst en loggrad per tio minuter och person och bild.
            var senaste = await db.Andringslogg
                .Where(l => l.ProjektId == projektId && l.Entitet == "Ritbord" && l.EntitetId == b.Id && l.AnvandarId == av.Id)
                .OrderByDescending(l => l.Id).Select(l => (DateTimeOffset?)l.Tidpunkt).FirstOrDefaultAsync();
            if (senaste is null || senaste < DateTimeOffset.UtcNow.AddMinutes(-10))
                Andringslogg.Logga(db, projektId, av, "Ritbord", b.Id, $"ändrade bilden {b.Namn} i Ritbord");
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { meddelande = "Bilden har ändrats av någon annan." }); }
            await Skicka(hub, projektId, "andrad", b, av);
            return Results.Ok(Info(b));
        });

        g.MapPatch("/{id:guid}", async (Guid projektId, Guid id, RitbordBildNamn namn, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var b = await db.RitbordBilder.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (b is null) return Results.NotFound();
            var nytt = (namn.Namn ?? "").Trim();
            if (nytt == "" || nytt == b.Namn) return Results.Ok(Info(b));
            var av = Anvandare.Fran(user);
            Andringslogg.Logga(db, projektId, av, "Ritbord", b.Id, $"döpte om bilden {b.Namn} till {nytt}", "namn", b.Namn, nytt);
            b.Namn = nytt;
            b.Andrad = DateTimeOffset.UtcNow;
            b.AndradAv = av.Namn;
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "andrad", b, av);
            return Results.Ok(Info(b));
        });

        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var b = await db.RitbordBilder.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (b is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            db.RitbordBilder.Remove(b);
            Andringslogg.Logga(db, projektId, av, "Ritbord", b.Id, $"tog bort bilden {b.Namn} i Ritbord");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "borttagen", b, av);
            return Results.NoContent();
        });

        return app;
    }

    private static Task Skicka(IHubContext<ProjektHub> hub, Guid projektId, string typ, RitbordBild b, Anvandare av) =>
        hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("ritbord", typ, Info(b), av.Id, av.Namn));
}
