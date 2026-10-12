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
    private static IQueryable<AndringsloggPost> Filtrera(PvDbContext db, Guid projektId, Guid? entitetId, string? sok)
    {
        var q = db.Andringslogg.Where(a => a.ProjektId == projektId);
        if (entitetId is { } e) q = q.Where(a => a.EntitetId == e);
        if (!string.IsNullOrWhiteSpace(sok))
        {
            var monster = $"%{sok.Trim()}%";
            q = q.Where(a => EF.Functions.ILike(a.Beskrivning, monster)
                          || EF.Functions.ILike(a.AnvandarNamn, monster)
                          || (a.Fore != null && EF.Functions.ILike(a.Fore, monster))
                          || (a.Efter != null && EF.Functions.ILike(a.Efter, monster)));
        }
        return q;
    }

    private static IQueryable<Data.Projekt> SynligaProjekt(PvDbContext db, AnvandarPost anv) =>
        Roller.SerAllaProjekt(anv.Roll)
            ? db.Projekt
            : db.Projekt.Where(p => db.Medlemmar.Any(m => m.ProjektId == p.Id && m.AnvandarId == anv.Id));

    public static IEndpointRouteBuilder MapProjektEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt").AddEndpointFilter<ProjektAtkomst>();

        // Fas 1: alla inloggade i organisationen ser alla projekt.
        // Behörighet per projekt (medlemmar och roller) läggs till i ett senare steg.
        g.MapGet("/", async (ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
            await SynligaProjekt(db, await beh.AktuellAsync(user))
                .OrderByDescending(p => p.Skapad)
                .Select(p => new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, p.Komponenter.Count))
                .ToListAsync());

        g.MapGet("/{id:guid}", async (Guid id, PvDbContext db) =>
            await db.Projekt
                .Where(p => p.Id == id)
                .Select(p => new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, p.Komponenter.Count))
                .FirstOrDefaultAsync() is { } dto ? Results.Ok(dto) : Results.NotFound());

        g.MapPost("/", async (NyttProjekt nytt, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare)) return Results.Forbid();
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
            // Den som skapar projektet blir medlem, så att det syns även om rollen ändras senare.
            db.Medlemmar.Add(new ProjektMedlem { ProjektId = p.Id, AnvandarId = (await beh.AktuellAsync(user)).Id, TillagdAv = av.Namn });
            Andringslogg.Logga(db, p.Id, av, "Projekt", p.Id, $"skapade projektet {p.Namn}");
            await db.SaveChangesAsync();
            return Results.Created($"/api/projekt/{p.Id}",
                new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, 0));
        });

        // Tar bort projektet i sin helhet: allt innehåll, ändringsloggen och projektfilerna. Bara Admin.
        // Projektets namn måste skickas med som bekräftelse.
        g.MapDelete("/{id:guid}", async (Guid id, string? bekrafta, ClaimsPrincipal user, Behorighet beh, PvDbContext db,
            FilApi.IFilLagring lagring, ILoggerFactory loggar, CancellationToken ct) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin))
                return Results.Problem(statusCode: 403, title: "Bara Admin kan ta bort projekt.");
            var p = await db.Projekt.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (p is null) return Results.NotFound();
            if (!string.Equals((bekrafta ?? "").Trim(), p.Namn.Trim(), StringComparison.CurrentCultureIgnoreCase))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["bekrafta"] = ["Skriv projektets namn exakt för att bekräfta."] });

            var blobbar = await db.Filer.Where(f => f.ProjektId == id).Select(f => f.BlobNamn).ToListAsync(ct);
            await using (var tx = await db.Database.BeginTransactionAsync(ct))
            {
                await db.Andringslogg.Where(a => a.ProjektId == id).ExecuteDeleteAsync(ct);
                // Övriga tabeller (komponenter, listor, filer, skåp, dokument …) tas bort av databasen (ON DELETE CASCADE).
                await db.Projekt.Where(x => x.Id == id).ExecuteDeleteAsync(ct);
                await tx.CommitAsync(ct);
            }
            var logg = loggar.CreateLogger("Projekt");
            logg.LogWarning("Projektet {Namn} ({Id}) togs bort av {Anvandare}", p.Namn, id, Anvandare.Fran(user).Namn);
            foreach (var b in blobbar)
            {
                try { await lagring.TaBortAsync(b, ct); }
                catch (Exception e) { logg.LogWarning(e, "Filen {Blob} kunde inte tas bort", b); }
            }
            return Results.NoContent();
        });

        g.MapGet("/{id:guid}/andringslogg", async (Guid id, int? antal, Guid? entitetId, string? sok, PvDbContext db) =>
        {
            var n = Math.Clamp(antal ?? 100, 1, 2000);
            return await Filtrera(db, id, entitetId, sok)
                .OrderByDescending(a => a.Id)
                .Take(n)
                .Select(a => new AndringsloggDto(a.Id, a.Tidpunkt, a.AnvandarNamn, a.Entitet, a.EntitetId, a.Beskrivning, a.Falt, a.Fore, a.Efter))
                .ToListAsync();
        });

        g.MapGet("/{id:guid}/andringslogg/excel", async (Guid id, Guid? entitetId, string? sok, PvDbContext db) =>
        {
            var projekt = await db.Projekt.FirstOrDefaultAsync(p => p.Id == id);
            if (projekt is null) return Results.NotFound();
            var rader = await Filtrera(db, id, entitetId, sok).OrderByDescending(a => a.Id).Take(20000).ToListAsync();

            var kolumner = new[] { "Tidpunkt", "Användare", "Händelse", "Fält", "Före", "Efter" };
            var data = rader.Select(r => new object?[]
            {
                r.Tidpunkt.ToOffset(Export.Excel.Svensk(r.Tidpunkt)).DateTime, r.AnvandarNamn, r.Beskrivning, r.Falt, r.Fore, r.Efter,
            });
            var fil = Export.Excel.Tabell("Ändringslogg", $"Ändringslogg – {projekt.Namn}", kolumner, data);
            return Results.File(fil, Export.Excel.MimeTyp, Export.Excel.Filnamn($"Ändringslogg {projekt.Nummer} {projekt.Namn}"));
        });

        return app;
    }
}
