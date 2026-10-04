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

        g.MapPut("/", async (Guid projektId, RitningSpara spara, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
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
                r.Data = spara.Data;
                r.Version++;
                r.Andrad = DateTimeOffset.UtcNow;
                r.AndradAv = av.Namn;
            }

            // Ritningen sparas automatiskt medan man arbetar, så loggen får högst en rad per tio minuter och person.
            var senaste = await db.Andringslogg
                .Where(l => l.ProjektId == projektId && l.Entitet == "Ritning" && l.AnvandarId == av.Id)
                .OrderByDescending(l => l.Id).Select(l => (DateTimeOffset?)l.Tidpunkt).FirstOrDefaultAsync();
            if (senaste is null || senaste < DateTimeOffset.UtcNow.AddMinutes(-10))
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
}
