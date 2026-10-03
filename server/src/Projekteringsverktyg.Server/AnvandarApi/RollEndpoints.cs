using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;

namespace Projekteringsverktyg.Server.AnvandarApi;

public sealed record AnvandarDto(string Id, string Namn, string Epost, string Roll, DateTimeOffset SenastInloggad);
public sealed record RollVal(string Roll);
public sealed record MedlemDto(string AnvandarId, string Namn, string Epost, string Roll, DateTimeOffset Tillagd, string TillagdAv);
public sealed record NyMedlem(string AnvandarId);

/// <summary>Användare, roller och projektmedlemmar.</summary>
public static class RollEndpoints
{
    public static IEndpointRouteBuilder MapRollEndpoints(this IEndpointRouteBuilder app)
    {
        // Alla användare som loggat in någon gång. Används för att välja medlemmar och för adminsidan.
        app.MapGet("/api/anvandare", async (ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var lista = await db.Anvandare.OrderBy(a => a.Namn).ToListAsync();
            return Results.Ok(lista.Select(a => new AnvandarDto(a.Id, a.Namn, a.Epost, a.Roll, a.SenastInloggad)));
        });

        app.MapPut("/api/anvandare/{id}/roll", async (string id, RollVal val, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin)) return Results.Forbid();
            if (!Roller.Alla.Contains(val.Roll))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["roll"] = ["Okänd roll."] });
            var a = await db.Anvandare.FindAsync(id);
            if (a is null) return Results.NotFound();
            if (a.Roll == Roller.Admin && val.Roll != Roller.Admin && await db.Anvandare.CountAsync(x => x.Roll == Roller.Admin) <= 1)
                return Results.Conflict(new { meddelande = "Det måste finnas minst en admin." });
            a.Roll = val.Roll;
            await db.SaveChangesAsync();
            return Results.Ok(new AnvandarDto(a.Id, a.Namn, a.Epost, a.Roll, a.SenastInloggad));
        });

        var g = app.MapGroup("/api/projekt/{projektId:guid}/medlemmar").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
            await (from m in db.Medlemmar
                   join a in db.Anvandare on m.AnvandarId equals a.Id
                   where m.ProjektId == projektId
                   orderby a.Namn
                   select new MedlemDto(a.Id, a.Namn, a.Epost, a.Roll, m.Tillagd, m.TillagdAv)).ToListAsync());

        g.MapPost("/", async (Guid projektId, NyMedlem ny, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var a = await db.Anvandare.FindAsync(ny.AnvandarId);
            if (a is null) return Results.NotFound();
            if (await db.Medlemmar.AnyAsync(m => m.ProjektId == projektId && m.AnvandarId == a.Id)) return Results.NoContent();
            var av = await beh.AktuellAsync(user);
            db.Medlemmar.Add(new ProjektMedlem { ProjektId = projektId, AnvandarId = a.Id, TillagdAv = av.Namn });
            Andringslogg.Logga(db, projektId, Anvandare.Fran(user), "Medlem", null, $"lade till {a.Namn} i projektet");
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        g.MapDelete("/{anvandarId}", async (Guid projektId, string anvandarId, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var m = await db.Medlemmar.FirstOrDefaultAsync(x => x.ProjektId == projektId && x.AnvandarId == anvandarId);
            if (m is null) return Results.NoContent();
            var namn = (await db.Anvandare.FindAsync(anvandarId))?.Namn ?? anvandarId;
            db.Medlemmar.Remove(m);
            Andringslogg.Logga(db, projektId, Anvandare.Fran(user), "Medlem", null, $"tog bort {namn} från projektet");
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return app;
    }
}
