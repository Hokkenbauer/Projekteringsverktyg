using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.ProjektApi;

public sealed record ProjektDto(
    Guid Id, string Namn, string Nummer, string Kund, string Ansvarig,
    DateTimeOffset Skapad, string SkapadAv, int AntalKomponenter);

public sealed record NyttProjekt(string Namn, string? Nummer, string? Kund, string? Ansvarig);

public sealed record AndringsloggDto(
    long Id, DateTimeOffset Tidpunkt, string AnvandarNamn, string Entitet, Guid? EntitetId,
    string Beskrivning, string? Falt, string? Fore, string? Efter);

public static class ProjektEndpoints
{
    public static IEndpointRouteBuilder MapProjektEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt");

        // Fas 1: alla inloggade i organisationen ser alla projekt.
        // Behörighet per projekt (medlemmar och roller) läggs till i ett senare steg.
        g.MapGet("/", async (PvDbContext db) =>
            await db.Projekt
                .OrderByDescending(p => p.Skapad)
                .Select(p => new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, p.Komponenter.Count))
                .ToListAsync());

        g.MapGet("/{id:guid}", async (Guid id, PvDbContext db) =>
            await db.Projekt
                .Where(p => p.Id == id)
                .Select(p => new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, p.Komponenter.Count))
                .FirstOrDefaultAsync() is { } dto ? Results.Ok(dto) : Results.NotFound());

        g.MapPost("/", async (NyttProjekt nytt, ClaimsPrincipal user, PvDbContext db) =>
        {
            if (string.IsNullOrWhiteSpace(nytt.Namn))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["namn"] = ["Projektet behöver ett namn."] });

            var av = Anvandare.Fran(user);
            var p = new Data.Projekt
            {
                Namn = nytt.Namn.Trim(),
                Nummer = nytt.Nummer?.Trim() ?? "",
                Kund = nytt.Kund?.Trim() ?? "",
                Ansvarig = string.IsNullOrWhiteSpace(nytt.Ansvarig) ? av.Namn : nytt.Ansvarig.Trim(),
                SkapadAv = av.Namn,
            };
            db.Projekt.Add(p);
            Andringslogg.Logga(db, p.Id, av, "Projekt", p.Id, $"skapade projektet {p.Namn}");
            await db.SaveChangesAsync();
            return Results.Created($"/api/projekt/{p.Id}",
                new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, 0));
        });

        g.MapGet("/{id:guid}/andringslogg", async (Guid id, int? antal, PvDbContext db) =>
        {
            var n = Math.Clamp(antal ?? 50, 1, 500);
            return await db.Andringslogg
                .Where(a => a.ProjektId == id)
                .OrderByDescending(a => a.Id)
                .Take(n)
                .Select(a => new AndringsloggDto(a.Id, a.Tidpunkt, a.AnvandarNamn, a.Entitet, a.EntitetId, a.Beskrivning, a.Falt, a.Fore, a.Efter))
                .ToListAsync();
        });

        return app;
    }
}
