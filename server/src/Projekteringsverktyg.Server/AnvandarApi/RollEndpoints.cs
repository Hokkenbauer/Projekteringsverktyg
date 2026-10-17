using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;

namespace Projekteringsverktyg.Server.AnvandarApi;

public sealed record AnvandarDto(string Id, string Namn, string Epost, string Roll, DateTimeOffset SenastInloggad, bool FarSkapaProjekt, bool FarAndraMallar);
public sealed record RollVal(string? Roll, bool? FarSkapaProjekt, bool? FarAndraMallar);
/// <summary>Roll = projektroll i det här projektet. VerktygsRoll = Admin, Intern eller Extern.</summary>
public sealed record MedlemDto(string AnvandarId, string Namn, string Epost, string Roll, string VerktygsRoll, DateTimeOffset Tillagd, string TillagdAv);
public sealed record NyMedlem(string AnvandarId, string? Roll);
public sealed record ProjektRollVal(string Roll);

/// <summary>
/// Deltagare i verktyget (verktygsroll, bara Admin ändrar) och medlemmar i projekt (projektroll, projektledaren ändrar).
/// </summary>
public static class RollEndpoints
{
    private static AnvandarDto Dto(AnvandarPost a) => new(a.Id, a.Namn, a.Epost, a.Roll, a.SenastInloggad, a.FarSkapaProjekt, a.FarAndraMallar);
    private static IResult Fel(string falt, string text) => Results.ValidationProblem(new Dictionary<string, string[]> { [falt] = [text] });

    public static IEndpointRouteBuilder MapRollEndpoints(this IEndpointRouteBuilder app)
    {
        // Alla deltagare i verktyget. Admin och interna (för att välja medlemmar); externa ser inte listan.
        app.MapGet("/api/anvandare", async (ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Intern)) return Results.Forbid();
            var lista = await db.Anvandare.OrderBy(a => a.Namn).ToListAsync();
            return Results.Ok(lista.Select(Dto));
        });

        // Verktygsroll och tillstånd. Bara Admin.
        app.MapPut("/api/anvandare/{id}/roll", async (string id, RollVal val, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.ArAdmin(user)) return Results.Forbid();
            var a = await db.Anvandare.FindAsync(id);
            if (a is null) return Results.NotFound();
            if (val.Roll is { } roll)
            {
                if (!Roller.Verktyg.Contains(roll)) return Fel("roll", "Välj Admin, Intern eller Extern.");
                if (a.Roll == Roller.Admin && roll != Roller.Admin && await db.Anvandare.CountAsync(x => x.Roll == Roller.Admin) <= 1)
                    return Results.Conflict(new { meddelande = "Det måste finnas minst en admin." });
                a.Roll = roll;
            }
            if (val.FarSkapaProjekt is { } sk) a.FarSkapaProjekt = sk;
            if (val.FarAndraMallar is { } ma) a.FarAndraMallar = ma;
            await db.SaveChangesAsync();
            return Results.Ok(Dto(a));
        });

        var g = app.MapGroup("/api/projekt/{projektId:guid}/medlemmar").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
            await (from m in db.Medlemmar
                   join a in db.Anvandare on m.AnvandarId equals a.Id
                   where m.ProjektId == projektId
                   orderby a.Namn
                   select new MedlemDto(a.Id, a.Namn, a.Epost, m.Roll, a.Roll, m.Tillagd, m.TillagdAv)).ToListAsync());

        // Min roll och mina rättigheter i projektet (webbappen visar eller döljer knappar efter dem).
        app.MapGet("/api/projekt/{projektId:guid}/min-roll", async (Guid projektId, ClaimsPrincipal user, Behorighet beh) =>
            await beh.KanLasa(user, projektId)
                ? Results.Ok(Behorighet.ProjektRattigheter(await beh.ProjektRoll(user, projektId)))
                : Results.Problem(statusCode: 403, title: "Du har inte tillgång till projektet."));

        g.MapPost("/", async (Guid projektId, NyMedlem ny, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.KanLedaProjekt(user, projektId)) return Results.Forbid();
            var roll = string.IsNullOrWhiteSpace(ny.Roll) ? Roller.Tekniker : ny.Roll.Trim();
            if (!Roller.Projekt.Contains(roll)) return Fel("roll", "Välj Projektledare, Tekniker eller Läsare.");
            var a = await db.Anvandare.FindAsync(ny.AnvandarId);
            if (a is null) return Results.NotFound();
            if (await db.Medlemmar.AnyAsync(m => m.ProjektId == projektId && m.AnvandarId == a.Id)) return Results.NoContent();
            var av = await beh.AktuellAsync(user);
            db.Medlemmar.Add(new ProjektMedlem { ProjektId = projektId, AnvandarId = a.Id, Roll = roll, TillagdAv = av.Namn });
            Andringslogg.Logga(db, projektId, Anvandare.Fran(user), "Medlem", null, $"lade till {a.Namn} i projektet som {RollNamn(roll)}");
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // Ändra en medlems projektroll. Gäller bara det här projektet.
        g.MapPut("/{anvandarId}", async (Guid projektId, string anvandarId, ProjektRollVal val, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.KanLedaProjekt(user, projektId)) return Results.Forbid();
            if (!Roller.Projekt.Contains(val.Roll)) return Fel("roll", "Välj Projektledare, Tekniker eller Läsare.");
            var m = await db.Medlemmar.FirstOrDefaultAsync(x => x.ProjektId == projektId && x.AnvandarId == anvandarId);
            if (m is null) return Results.NotFound();
            if (m.Roll == Roller.Projektledare && val.Roll != Roller.Projektledare
                && !await db.Medlemmar.AnyAsync(x => x.ProjektId == projektId && x.AnvandarId != anvandarId && x.Roll == Roller.Projektledare)
                && !await beh.ArAdmin(user))
                return Results.Conflict(new { meddelande = "Projektet måste ha minst en projektledare." });
            if (m.Roll == val.Roll) return Results.NoContent();
            var namn = (await db.Anvandare.FindAsync(anvandarId))?.Namn ?? anvandarId;
            Andringslogg.Logga(db, projektId, Anvandare.Fran(user), "Medlem", null, $"ändrade {namn}s roll i projektet", "roll", RollNamn(m.Roll), RollNamn(val.Roll));
            m.Roll = val.Roll;
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        g.MapDelete("/{anvandarId}", async (Guid projektId, string anvandarId, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.KanLedaProjekt(user, projektId)) return Results.Forbid();
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

    public static string RollNamn(string roll) => roll == Roller.Lasare ? "Läsare" : roll;
}
