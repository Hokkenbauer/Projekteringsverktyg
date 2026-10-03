using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.ProjektApi;

/// <summary>Fria textfält per projekt: Projektinformation och Serviceinformation.</summary>
public static class TextEndpoints
{
    public static readonly Dictionary<string, string> Nycklar = new()
    {
        ["projektinformation"] = "Projektinformation",
        ["serviceinformation"] = "Serviceinformation",
    };

    public static IEndpointRouteBuilder MapTextEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/texter/{nyckel}").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, string nyckel, PvDbContext db) =>
        {
            if (!Nycklar.ContainsKey(nyckel)) return Results.NotFound();
            var t = await db.Texter.FirstOrDefaultAsync(x => x.ProjektId == projektId && x.Nyckel == nyckel);
            return Results.Ok(new AnteckningarDto(t?.Text ?? "", t?.Andrad, t?.AndradAv ?? ""));
        });

        g.MapPut("/", async (Guid projektId, string nyckel, AnteckningarSpara spara, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!Nycklar.TryGetValue(nyckel, out var namn)) return Results.NotFound();
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var text = spara.Text ?? "";
            if (text.Length > 200_000) text = text[..200_000];

            var t = await db.Texter.FirstOrDefaultAsync(x => x.ProjektId == projektId && x.Nyckel == nyckel);
            if (t is null)
            {
                t = new ProjektText { ProjektId = projektId, Nyckel = nyckel };
                db.Texter.Add(t);
            }
            else if (t.Text == text)
            {
                return Results.Ok(new AnteckningarDto(t.Text, t.Andrad, t.AndradAv));
            }

            // Sparas medan man skriver, så loggen får högst en rad per tio minuter och person.
            var entitet = "Text:" + nyckel;
            var senaste = await db.Andringslogg
                .Where(l => l.ProjektId == projektId && l.Entitet == entitet && l.AnvandarId == av.Id)
                .OrderByDescending(l => l.Id).Select(l => (DateTimeOffset?)l.Tidpunkt).FirstOrDefaultAsync();
            if (senaste is null || senaste < DateTimeOffset.UtcNow.AddMinutes(-10))
                Andringslogg.Logga(db, projektId, av, entitet, projektId, $"ändrade i {namn}");

            t.Text = text;
            t.Andrad = DateTimeOffset.UtcNow;
            t.AndradAv = av.Namn;
            await db.SaveChangesAsync();
            var dto = new AnteckningarDto(t.Text, t.Andrad, t.AndradAv);
            await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse($"text:{nyckel}", "andrad", dto, av.Id, av.Namn));
            return Results.Ok(dto);
        });

        return app;
    }
}
