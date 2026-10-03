using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.AttGoraApi;

public sealed record AttGoraDto(Guid Id, Guid ProjektId, string Text, bool Klar, int Ordning, int Version, DateTimeOffset Andrad, string AndradAv)
{
    public static AttGoraDto Fran(AttGoraPost a) => new(a.Id, a.ProjektId, a.Text, a.Klar, a.Ordning, a.Version, a.Andrad, a.AndradAv);
}

public sealed record NyAttGora(string? Text);
public sealed record AttGoraAndring(string Falt, string? Varde, int Version);

public sealed record AnteckningarDto(string Text, DateTimeOffset? Andrad, string AndradAv);
public sealed record AnteckningarSpara(string Text);

/// <summary>Livesynk-händelse för listor utöver Komponenter. Typ = skapad, andrad eller borttagen.</summary>
public sealed record ListaHandelse(string Lista, string Typ, object Rad, string AvId, string AvNamn);

public static class AttGoraEndpoints
{
    public static IEndpointRouteBuilder MapAttGoraEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/att-gora").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
            (await db.AttGora.Where(a => a.ProjektId == projektId)
                .OrderBy(a => a.Ordning).ThenBy(a => a.Andrad).ToListAsync())
            .Select(AttGoraDto.Fran));

        g.MapPost("/", async (Guid projektId, NyAttGora ny, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var max = await db.AttGora.Where(a => a.ProjektId == projektId).MaxAsync(a => (int?)a.Ordning) ?? 0;
            var post = new AttGoraPost { ProjektId = projektId, Text = (ny.Text ?? "").Trim(), Ordning = max + 1, AndradAv = av.Namn };
            db.AttGora.Add(post);
            Andringslogg.Logga(db, projektId, av, "AttGora", post.Id, "lade till en rad i Att göra");
            await db.SaveChangesAsync();
            var dto = AttGoraDto.Fran(post);
            await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("attGora", "skapad", dto, av.Id, av.Namn));
            return Results.Created($"/api/projekt/{projektId}/att-gora/{post.Id}", dto);
        });

        g.MapPatch("/{id:guid}", async (Guid projektId, Guid id, AttGoraAndring andring, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var post = await db.AttGora.FirstOrDefaultAsync(a => a.Id == id && a.ProjektId == projektId);
            if (post is null) return Results.NotFound();
            if (post.Version != andring.Version)
                return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan.", rad = AttGoraDto.Fran(post) });

            var av = Anvandare.Fran(user);
            string fore, efter, beskrivning;
            switch (andring.Falt)
            {
                case "text":
                    fore = post.Text;
                    post.Text = (andring.Varde ?? "").Trim();
                    efter = post.Text;
                    beskrivning = "ändrade en rad i Att göra";
                    break;
                case "klar":
                    fore = post.Klar ? "Klar" : "Ej klar";
                    post.Klar = string.Equals(andring.Varde, "true", StringComparison.OrdinalIgnoreCase);
                    efter = post.Klar ? "Klar" : "Ej klar";
                    beskrivning = post.Klar ? $"bockade av \"{Kort(post.Text)}\" i Att göra" : $"öppnade \"{Kort(post.Text)}\" igen i Att göra";
                    break;
                default:
                    return Results.ValidationProblem(new Dictionary<string, string[]> { ["falt"] = [$"Fältet '{andring.Falt}' kan inte ändras."] });
            }
            if (fore == efter) return Results.Ok(AttGoraDto.Fran(post));

            post.Version++;
            post.Andrad = DateTimeOffset.UtcNow;
            post.AndradAv = av.Namn;
            Andringslogg.Logga(db, projektId, av, "AttGora", post.Id, beskrivning, andring.Falt, fore, efter);
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { meddelande = "Raden har ändrats av någon annan." }); }

            var dto = AttGoraDto.Fran(post);
            await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("attGora", "andrad", dto, av.Id, av.Namn));
            return Results.Ok(dto);
        });

        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var post = await db.AttGora.FirstOrDefaultAsync(a => a.Id == id && a.ProjektId == projektId);
            if (post is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var dto = AttGoraDto.Fran(post);
            db.AttGora.Remove(post);
            Andringslogg.Logga(db, projektId, av, "AttGora", post.Id, $"tog bort \"{Kort(post.Text)}\" från Att göra");
            await db.SaveChangesAsync();
            await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("attGora", "borttagen", dto, av.Id, av.Namn));
            return Results.NoContent();
        });

        // ---- Anteckningar: ett fritt textfält per projekt ----
        var ant = app.MapGroup("/api/projekt/{projektId:guid}/anteckningar").AddEndpointFilter<ProjektAtkomst>();

        ant.MapGet("/", async (Guid projektId, PvDbContext db) =>
            await db.Projekt.Where(p => p.Id == projektId)
                .Select(p => new AnteckningarDto(p.Anteckningar, p.AnteckningarAndrad, p.AnteckningarAndradAv))
                .FirstOrDefaultAsync() is { } dto ? Results.Ok(dto) : Results.NotFound());

        ant.MapPut("/", async (Guid projektId, AnteckningarSpara spara, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var p = await db.Projekt.FirstOrDefaultAsync(x => x.Id == projektId);
            if (p is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var text = spara.Text ?? "";
            if (text.Length > 200_000) text = text[..200_000];
            if (text == p.Anteckningar) return Results.Ok(new AnteckningarDto(p.Anteckningar, p.AnteckningarAndrad, p.AnteckningarAndradAv));

            // Texten sparas medan man skriver. För att inte fylla loggen loggas det högst en gång per tio minuter och person.
            var senaste = await db.Andringslogg
                .Where(l => l.ProjektId == projektId && l.Entitet == "Anteckningar" && l.AnvandarId == av.Id)
                .OrderByDescending(l => l.Id).Select(l => (DateTimeOffset?)l.Tidpunkt).FirstOrDefaultAsync();
            if (senaste is null || senaste < DateTimeOffset.UtcNow.AddMinutes(-10))
                Andringslogg.Logga(db, projektId, av, "Anteckningar", projektId, "ändrade i Anteckningar");

            p.Anteckningar = text;
            p.AnteckningarAndrad = DateTimeOffset.UtcNow;
            p.AnteckningarAndradAv = av.Namn;
            await db.SaveChangesAsync();
            var dto = new AnteckningarDto(p.Anteckningar, p.AnteckningarAndrad, p.AnteckningarAndradAv);
            await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("anteckningar", "andrad", dto, av.Id, av.Namn));
            return Results.Ok(dto);
        });

        return app;
    }

    private static string Kort(string text) => text.Length <= 40 ? text : text[..40] + "…";
}
