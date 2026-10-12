using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.ProjektApi;

public sealed record RitningDto(string? Data, int Version, DateTimeOffset? Andrad, string AndradAv);
public sealed record RitningSpara(string Data, int Version);
public sealed record RitningHandelse(int Version, string AndradAv);
public sealed record RitningHistorikDto(long Id, int Version, DateTimeOffset Sparad, string SparadAv, int Storlek);

/// <summary>
/// Placeringsritningen sparas som ett dokument per projekt. Version skyddar mot att två personer
/// skriver över varandra; den som sparar på en gammal version får 409 och den aktuella ritningen tillbaka.
/// </summary>
public static class RitningEndpoints
{
    public const int MaxLangd = 30_000_000;

    public static IEndpointRouteBuilder MapRitningEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/ritning").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
        {
            var r = await db.Ritningar.AsNoTracking().FirstOrDefaultAsync(x => x.ProjektId == projektId);
            return r is null ? new RitningDto(null, 0, null, "") : new RitningDto(r.Data, r.Version, r.Andrad, r.AndradAv);
        });

        // Historik: tidigare versioner av ritningen, nyast först.
        g.MapGet("/historik", async (Guid projektId, PvDbContext db) =>
            await db.RitningHistorik.AsNoTracking().Where(h => h.ProjektId == projektId)
                .OrderByDescending(h => h.Sparad)
                .Select(h => new RitningHistorikDto(h.Id, h.Version, h.Sparad, h.SparadAv, h.Data.Length))
                .ToListAsync());

        g.MapGet("/historik/{historikId:long}", async (Guid projektId, long historikId, PvDbContext db) =>
            await db.RitningHistorik.AsNoTracking().FirstOrDefaultAsync(h => h.Id == historikId && h.ProjektId == projektId) is { } h
                ? Results.Ok(new RitningDto(h.Data, h.Version, h.Sparad, h.SparadAv))
                : Results.NotFound());

        // aterstall=true: en tidigare version läggs tillbaka. Den nuvarande sparas då alltid i historiken först.
        g.MapPut("/", async (Guid projektId, RitningSpara spara, bool? aterstall, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (string.IsNullOrWhiteSpace(spara.Data) || spara.Data.Length > MaxLangd)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["data"] = ["Ritningen är tom eller för stor."] });
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();

            var av = Anvandare.Fran(user);
            var r = await db.Ritningar.FirstOrDefaultAsync(x => x.ProjektId == projektId);
            if (r is null)
            {
                if (spara.Version != 0) return Results.Conflict(new { meddelande = "Ritningen har ändrats av någon annan." });
                r = new Ritning { ProjektId = projektId, Data = spara.Data, Version = 1, AndradAv = av.Namn };
                db.Ritningar.Add(r);
            }
            else
            {
                if (r.Version != spara.Version)
                    return Results.Conflict(new { meddelande = "Ritningen har ändrats av någon annan.", ritning = new RitningDto(r.Data, r.Version, r.Andrad, r.AndradAv) });
                if (r.Data == spara.Data) return Results.Ok(new RitningDto(null, r.Version, r.Andrad, r.AndradAv));
                await SparaHistorikAsync(db, r, aterstall == true);
                r.Data = spara.Data;
                r.Version++;
                r.Andrad = DateTimeOffset.UtcNow;
                r.AndradAv = av.Namn;
            }

            // Ritningen sparas automatiskt medan man arbetar, så loggen får högst en rad per tio minuter och person.
            var senaste = await db.Andringslogg
                .Where(l => l.ProjektId == projektId && l.Entitet == "Ritning" && l.AnvandarId == av.Id)
                .OrderByDescending(l => l.Id).Select(l => (DateTimeOffset?)l.Tidpunkt).FirstOrDefaultAsync();
            if (aterstall == true)
                Andringslogg.Logga(db, projektId, av, "Ritning", projektId, "återställde Placeringsritningar till en tidigare version");
            else if (senaste is null || senaste < DateTimeOffset.UtcNow.AddMinutes(-10))
                Andringslogg.Logga(db, projektId, av, "Ritning", projektId, "ändrade i Placeringsritningar");

            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { return Results.Conflict(new { meddelande = "Ritningen har ändrats av någon annan." }); }

            await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad",
                new ListaHandelse("ritning", "andrad", new RitningHandelse(r.Version, r.AndradAv), av.Id, av.Namn));
            // Data skickas inte tillbaka: klienten har den redan.
            return Results.Ok(new RitningDto(null, r.Version, r.Andrad, r.AndradAv));
        });

        return app;
    }

    /// <summary>
    /// Sparar ritningen som den var innan den skrivs över: högst en kopia per tio minuter (alltid vid återställning).
    /// Gallrar samtidigt: allt från de senaste två dygnen behålls, äldre en per dag, inget äldre än 30 dagar.
    /// </summary>
    private static async Task SparaHistorikAsync(PvDbContext db, Ritning r, bool alltid)
    {
        var nu = DateTimeOffset.UtcNow;
        var senast = await db.RitningHistorik.Where(h => h.ProjektId == r.ProjektId)
            .OrderByDescending(h => h.Sparad).Select(h => (DateTimeOffset?)h.Sparad).FirstOrDefaultAsync();
        if (!alltid && senast is not null && senast > nu.AddMinutes(-10)) return;

        db.RitningHistorik.Add(new RitningHistorik { ProjektId = r.ProjektId, Version = r.Version, Data = r.Data, Sparad = nu, SparadAv = r.AndradAv });

        var gamla = await db.RitningHistorik.AsNoTracking()
            .Where(h => h.ProjektId == r.ProjektId && h.Sparad < nu.AddDays(-2))
            .Select(h => new { h.Id, h.Sparad }).ToListAsync();
        var taBort = gamla.Where(h => h.Sparad < nu.AddDays(-30)).Select(h => h.Id).ToList();
        taBort.AddRange(gamla.Where(h => h.Sparad >= nu.AddDays(-30))
            .GroupBy(h => h.Sparad.UtcDateTime.Date)
            .SelectMany(d => d.OrderByDescending(h => h.Sparad).Skip(1)).Select(h => h.Id));
        if (taBort.Count > 0)
            await db.RitningHistorik.Where(h => taBort.Contains(h.Id)).ExecuteDeleteAsync();
    }
}
