using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.KomponentApi;

public sealed record KomponentDto(
    Guid Id, Guid ProjektId, string System, string Beteckning, string Komponenttyp, string Signaltyp,
    string Beskrivning, string AnslutsTill, string Kabeltyp, string Placering, string Ovrigt,
    int Version, DateTimeOffset Andrad, string AndradAv)
{
    public static KomponentDto Fran(Komponent k) => new(
        k.Id, k.ProjektId, k.System, k.Beteckning, k.Komponenttyp, k.Signaltyp,
        k.Beskrivning, k.AnslutsTill, k.Kabeltyp, k.Placering, k.Ovrigt,
        k.Version, k.Andrad, k.AndradAv);
}

/// <summary>Ny komponent. Alla fält är frivilliga; tomma fält fylls i efterhand i tabellen.</summary>
public sealed record NyKomponent(
    string? System, string? Beteckning, string? Komponenttyp, string? Signaltyp,
    string? Beskrivning, string? AnslutsTill, string? Kabeltyp, string? Placering, string? Ovrigt);

/// <summary>Ändring av ett fält. Version = den version klienten utgick från.</summary>
public sealed record FaltAndring(string Falt, string? Varde, int Version);

public sealed record KomponentHandelse(KomponentDto Komponent, string? Falt, string AvId, string AvNamn);

public static class KomponentEndpoints
{
    public static IEndpointRouteBuilder MapKomponentEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/komponenter");

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
        {
            var lista = await db.Komponenter
                .Where(k => k.ProjektId == projektId)
                .OrderBy(k => k.System).ThenBy(k => k.Beteckning)
                .ToListAsync();
            return lista.Select(KomponentDto.Fran);
        });

        g.MapPost("/", async (Guid projektId, NyKomponent ny, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var k = new Komponent { ProjektId = projektId, AndradAv = av.Namn };
            Fyll(k, "system", ny.System);
            Fyll(k, "beteckning", ny.Beteckning);
            Fyll(k, "komponenttyp", ny.Komponenttyp);
            Fyll(k, "signaltyp", ny.Signaltyp);
            Fyll(k, "beskrivning", ny.Beskrivning);
            Fyll(k, "anslutsTill", ny.AnslutsTill);
            Fyll(k, "kabeltyp", ny.Kabeltyp);
            Fyll(k, "placering", ny.Placering);
            Fyll(k, "ovrigt", ny.Ovrigt);

            db.Komponenter.Add(k);
            Andringslogg.Logga(db, projektId, av, "Komponent", k.Id,
                string.IsNullOrEmpty(k.Beteckning) ? "lade till en komponent" : $"lade till {k.Beteckning}");
            await db.SaveChangesAsync();

            var dto = KomponentDto.Fran(k);
            await hub.Clients.Group(ProjektHub.Grupp(projektId))
                .SendAsync("KomponentSkapad", new KomponentHandelse(dto, null, av.Id, av.Namn));
            return Results.Created($"/api/projekt/{projektId}/komponenter/{k.Id}", dto);
        });

        g.MapPatch("/{id:guid}", async (Guid projektId, Guid id, FaltAndring andring, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!KomponentFalt.ArTillatet(andring.Falt))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["falt"] = [$"Fältet '{andring.Falt}' kan inte ändras."] });

            var k = await db.Komponenter.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (k is null) return Results.NotFound();

            // Någon annan hann ändra komponenten efter att klienten läste den.
            if (k.Version != andring.Version)
                return Results.Conflict(new { meddelande = "Komponenten har ändrats av någon annan.", komponent = KomponentDto.Fran(k) });

            var fore = KomponentFalt.Hamta(k, andring.Falt);
            KomponentFalt.Satt(k, andring.Falt, andring.Varde ?? "");
            var efter = KomponentFalt.Hamta(k, andring.Falt);
            if (fore == efter) return Results.Ok(KomponentDto.Fran(k));

            var av = Anvandare.Fran(user);
            k.Version++;
            k.Andrad = DateTimeOffset.UtcNow;
            k.AndradAv = av.Namn;
            var namn = string.IsNullOrEmpty(k.Beteckning) ? "en komponent" : k.Beteckning;
            Andringslogg.Logga(db, projektId, av, "Komponent", k.Id, $"ändrade {andring.Falt} på {namn}", andring.Falt, fore, efter);

            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateConcurrencyException)
            {
                var aktuell = await db.Komponenter.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
                return aktuell is null
                    ? Results.NotFound()
                    : Results.Conflict(new { meddelande = "Komponenten har ändrats av någon annan.", komponent = KomponentDto.Fran(aktuell) });
            }

            var dto = KomponentDto.Fran(k);
            await hub.Clients.Group(ProjektHub.Grupp(projektId))
                .SendAsync("KomponentAndrad", new KomponentHandelse(dto, andring.Falt, av.Id, av.Namn));
            return Results.Ok(dto);
        });

        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var k = await db.Komponenter.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (k is null) return Results.NotFound();

            var av = Anvandare.Fran(user);
            var dto = KomponentDto.Fran(k);
            db.Komponenter.Remove(k);
            Andringslogg.Logga(db, projektId, av, "Komponent", k.Id,
                string.IsNullOrEmpty(k.Beteckning) ? "tog bort en komponent" : $"tog bort {k.Beteckning}");
            await db.SaveChangesAsync();

            await hub.Clients.Group(ProjektHub.Grupp(projektId))
                .SendAsync("KomponentBorttagen", new KomponentHandelse(dto, null, av.Id, av.Namn));
            return Results.NoContent();
        });

        return app;
    }

    private static void Fyll(Komponent k, string falt, string? varde)
    {
        if (!string.IsNullOrWhiteSpace(varde)) KomponentFalt.Satt(k, falt, varde);
    }
}
