using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.StatusApi;

public sealed record RubrikDto(Guid Id, string Namn, int Ordning);
public sealed record UppgiftDto(Guid Id, Guid RubrikId, string Text, int Ordning, bool Klar, string Kommentar, string UtfordAv, DateTimeOffset? KlarDatum, int Version)
{
    public static UppgiftDto Fran(StatusUppgift u) => new(u.Id, u.RubrikId, u.Text, u.Ordning, u.Klar, u.Kommentar, u.UtfordAv, u.KlarDatum, u.Version);
}
public sealed record ProjektStatusDto(IReadOnlyList<RubrikDto> Rubriker, IReadOnlyList<UppgiftDto> Uppgifter);
public sealed record NyRubrik(string Namn);
public sealed record AndraRubrik(string Namn, int Ordning);
public sealed record NyUppgift(Guid RubrikId, string Text);
public sealed record UppgiftAndring(string Falt, string? Varde, int Version);

/// <summary>
/// Projekt Status: fasta rubriker (företagets arbetsmetod, bara admin ändrar) och
/// underrubriker per projekt (läggs till av projektledare så att de passar projektet).
/// </summary>
public static class StatusEndpoints
{
    public static IEndpointRouteBuilder MapStatusEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- Fasta rubriker (admin) ----
        app.MapGet("/api/statusrubriker", async (PvDbContext db) =>
            await db.StatusRubriker.OrderBy(r => r.Ordning).Select(r => new RubrikDto(r.Id, r.Namn, r.Ordning)).ToListAsync());

        app.MapPost("/api/statusrubriker", async (NyRubrik ny, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(ny.Namn)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["namn"] = ["Rubriken behöver ett namn."] });
            var max = await db.StatusRubriker.MaxAsync(r => (int?)r.Ordning) ?? 0;
            var r = new StatusRubrik { Namn = ny.Namn.Trim(), Ordning = max + 1 };
            db.StatusRubriker.Add(r);
            await db.SaveChangesAsync();
            return Results.Ok(new RubrikDto(r.Id, r.Namn, r.Ordning));
        });

        app.MapPut("/api/statusrubriker/{id:guid}", async (Guid id, AndraRubrik andra, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin)) return Results.Forbid();
            var r = await db.StatusRubriker.FindAsync(id);
            if (r is null) return Results.NotFound();
            if (!string.IsNullOrWhiteSpace(andra.Namn)) r.Namn = andra.Namn.Trim();
            r.Ordning = andra.Ordning;
            await db.SaveChangesAsync();
            return Results.Ok(new RubrikDto(r.Id, r.Namn, r.Ordning));
        });

        app.MapDelete("/api/statusrubriker/{id:guid}", async (Guid id, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin)) return Results.Forbid();
            var r = await db.StatusRubriker.FindAsync(id);
            if (r is null) return Results.NoContent();
            var antal = await db.StatusUppgifter.CountAsync(u => u.RubrikId == id);
            if (antal > 0)
                return Results.Conflict(new { meddelande = $"Rubriken används av {antal} underrubriker i projekt och kan inte tas bort." });
            db.StatusRubriker.Remove(r);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- Per projekt ----
        var g = app.MapGroup("/api/projekt/{projektId:guid}/status").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
        {
            var rubriker = await db.StatusRubriker.OrderBy(r => r.Ordning).Select(r => new RubrikDto(r.Id, r.Namn, r.Ordning)).ToListAsync();
            var uppgifter = await db.StatusUppgifter.Where(u => u.ProjektId == projektId).OrderBy(u => u.Ordning).ToListAsync();
            return new ProjektStatusDto(rubriker, uppgifter.Select(UppgiftDto.Fran).ToList());
        });

        g.MapPost("/", async (Guid projektId, NyUppgift ny, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            if (!await db.StatusRubriker.AnyAsync(r => r.Id == ny.RubrikId)) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var max = await db.StatusUppgifter.Where(u => u.ProjektId == projektId && u.RubrikId == ny.RubrikId).MaxAsync(u => (int?)u.Ordning) ?? 0;
            var u = new StatusUppgift { ProjektId = projektId, RubrikId = ny.RubrikId, Text = (ny.Text ?? "").Trim(), Ordning = max + 1, AndradAv = av.Namn };
            db.StatusUppgifter.Add(u);
            Andringslogg.Logga(db, projektId, av, "Status", u.Id, $"lade till \"{u.Text}\" i Projekt Status");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "skapad", u, av);
            return Results.Ok(UppgiftDto.Fran(u));
        });

        g.MapPatch("/{id:guid}", async (Guid projektId, Guid id, UppgiftAndring andring, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var u = await db.StatusUppgifter.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (u is null) return Results.NotFound();
            if (u.Version != andring.Version)
                return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan.", rad = UppgiftDto.Fran(u) });

            var av = Anvandare.Fran(user);
            string fore, efter, beskrivning;
            switch (andring.Falt)
            {
                case "klar":
                    fore = u.Klar ? "Klar" : "Ej klar";
                    u.Klar = string.Equals(andring.Varde, "true", StringComparison.OrdinalIgnoreCase);
                    u.UtfordAv = u.Klar ? av.Namn : "";
                    u.KlarDatum = u.Klar ? DateTimeOffset.UtcNow : null;
                    efter = u.Klar ? "Klar" : "Ej klar";
                    beskrivning = u.Klar ? $"bockade av \"{u.Text}\" i Projekt Status" : $"öppnade \"{u.Text}\" igen i Projekt Status";
                    break;
                case "kommentar":
                    fore = u.Kommentar;
                    u.Kommentar = (andring.Varde ?? "").Trim();
                    efter = u.Kommentar;
                    beskrivning = $"ändrade kommentaren för \"{u.Text}\" i Projekt Status";
                    break;
                case "utfordAv":
                    fore = u.UtfordAv;
                    u.UtfordAv = (andring.Varde ?? "").Trim();
                    efter = u.UtfordAv;
                    beskrivning = $"ändrade utförd av för \"{u.Text}\" i Projekt Status";
                    break;
                case "text":
                    if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
                    fore = u.Text;
                    u.Text = (andring.Varde ?? "").Trim();
                    efter = u.Text;
                    beskrivning = "döpte om en underrubrik i Projekt Status";
                    break;
                default:
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["falt"] = [$"Fältet '{andring.Falt}' kan inte ändras."] });
            }
            if (fore == efter) return Results.Ok(UppgiftDto.Fran(u));

            u.Version++;
            u.Andrad = DateTimeOffset.UtcNow;
            u.AndradAv = av.Namn;
            Andringslogg.Logga(db, projektId, av, "Status", u.Id, beskrivning, andring.Falt, fore, efter);
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan." }); }
            await Skicka(hub, projektId, "andrad", u, av);
            return Results.Ok(UppgiftDto.Fran(u));
        });

        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
            var u = await db.StatusUppgifter.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (u is null) return Results.NoContent();
            var av = Anvandare.Fran(user);
            db.StatusUppgifter.Remove(u);
            Andringslogg.Logga(db, projektId, av, "Status", u.Id, $"tog bort \"{u.Text}\" från Projekt Status");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "borttagen", u, av);
            return Results.NoContent();
        });

        return app;
    }

    private static Task Skicka(IHubContext<ProjektHub> hub, Guid projektId, string typ, StatusUppgift u, Anvandare av) =>
        hub.Clients.Group(ProjektHub.Grupp(projektId))
            .SendAsync("ListaAndrad", new ListaHandelse("projektStatus", typ, UppgiftDto.Fran(u), av.Id, av.Namn));
}
