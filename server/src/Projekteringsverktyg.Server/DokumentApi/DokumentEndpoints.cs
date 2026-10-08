using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.DokumentApi;

public sealed record DokumentDto(Guid Id, string Typ, string Namn, string Data, int Ordning, int Version, DateTimeOffset Skapad, DateTimeOffset Andrad, string AndradAv);
public sealed record NyttDokument(string Typ, string Namn, string? Data);
public sealed record DokumentSpara(string? Namn, string? Data, int Version);

/// <summary>
/// Namngivna dokument i ett projekt. Typ styr vilken flik de hör till:
/// funktionstext (projektets egna funktionstexter) och servicerapport.
/// </summary>
public static class DokumentEndpoints
{
    public static readonly Dictionary<string, string> Typer = new()
    {
        ["funktionstext"] = "funktionstexten",
        ["servicerapport"] = "servicerapporten",
        ["anslutning"] = "anslutningsinformationen för",
    };

    /// <summary>Känsliga typer (användarnamn och lösenord) som bara Admin, Projektledare och System ser.</summary>
    public static readonly HashSet<string> Kansliga = ["anslutning"];

    private static async Task<IResult?> KollaKanslig(string typ, ClaimsPrincipal user, Behorighet beh) =>
        Kansliga.Contains(typ) && !await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System)
            ? Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System ser anslutningsinformationen.")
            : null;

    public const int MaxLangd = 10_000_000;

    public static DokumentDto Dto(ProjektDokument d) => new(d.Id, d.Typ, d.Namn, d.Data, d.Ordning, d.Version, d.Skapad, d.Andrad, d.AndradAv);

    public static IEndpointRouteBuilder MapDokumentEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/dokument").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, string typ, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (await KollaKanslig(typ, user, beh) is { } nej) return nej;
            return Results.Ok((await db.Dokument.AsNoTracking().Where(d => d.ProjektId == projektId && d.Typ == typ)
                .OrderBy(d => d.Ordning).ThenBy(d => d.Skapad).ToListAsync()).Select(Dto));
        });

        g.MapPost("/", async (Guid projektId, NyttDokument ny, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub, Behorighet beh) =>
        {
            if (!Typer.TryGetValue(ny.Typ ?? "", out var vad)) return Fel("Okänd dokumenttyp.");
            if (await KollaKanslig(ny.Typ!, user, beh) is { } nej) return nej;
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();
            var data = ny.Data ?? "";
            if (data.Length > MaxLangd) return Fel("Dokumentet är för stort.");
            var av = Anvandare.Fran(user);
            var max = await db.Dokument.Where(d => d.ProjektId == projektId && d.Typ == ny.Typ).MaxAsync(d => (int?)d.Ordning) ?? 0;
            var namn = (ny.Namn ?? "").Trim();
            var d = new ProjektDokument
            {
                ProjektId = projektId, Typ = ny.Typ!, Namn = namn == "" ? $"Namnlös {max + 1}" : namn,
                Data = data, Ordning = max + 1, AndradAv = av.Namn,
            };
            db.Dokument.Add(d);
            Andringslogg.Logga(db, projektId, av, "Dokument", d.Id, $"skapade {vad} {d.Namn}");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, d, "skapad", av);
            return Results.Ok(Dto(d));
        });

        g.MapPut("/{id:guid}", async (Guid projektId, Guid id, DokumentSpara spara, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub, Behorighet beh) =>
        {
            var d = await db.Dokument.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (d is null) return Results.NotFound();
            if (await KollaKanslig(d.Typ, user, beh) is { } nej) return nej;
            if (d.Version != spara.Version) return Results.Conflict(new { meddelande = "Dokumentet har ändrats av någon annan." });
            if (spara.Data is { Length: > MaxLangd }) return Fel("Dokumentet är för stort.");
            var av = Anvandare.Fran(user);
            var vad = Typer.GetValueOrDefault(d.Typ, "dokumentet");
            var nyttNamn = spara.Namn?.Trim();
            if (!string.IsNullOrEmpty(nyttNamn) && nyttNamn != d.Namn)
            {
                Andringslogg.Logga(db, projektId, av, "Dokument", d.Id, $"bytte namn på {vad} {d.Namn} till {nyttNamn}");
                d.Namn = nyttNamn;
            }
            if (spara.Data is not null && spara.Data != d.Data)
            {
                // Sparas medan man skriver, så loggen får högst en rad per tio minuter och person och dokument.
                var senaste = await db.Andringslogg
                    .Where(l => l.ProjektId == projektId && l.Entitet == "Dokument" && l.EntitetId == d.Id && l.AnvandarId == av.Id)
                    .OrderByDescending(l => l.Id).Select(l => (DateTimeOffset?)l.Tidpunkt).FirstOrDefaultAsync();
                if (senaste is null || senaste < DateTimeOffset.UtcNow.AddMinutes(-10))
                    Andringslogg.Logga(db, projektId, av, "Dokument", d.Id, $"ändrade {vad} {d.Namn}");
                d.Data = spara.Data;
            }
            d.Version++;
            d.Andrad = DateTimeOffset.UtcNow;
            d.AndradAv = av.Namn;
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateConcurrencyException) { return Results.Conflict(new { meddelande = "Dokumentet har ändrats av någon annan." }); }
            await Skicka(hub, projektId, d, "andrad", av);
            return Results.Ok(Dto(d));
        });

        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub, Behorighet beh) =>
        {
            var d = await db.Dokument.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (d is null) return Results.NotFound();
            if (await KollaKanslig(d.Typ, user, beh) is { } nej) return nej;
            var av = Anvandare.Fran(user);
            db.Dokument.Remove(d);
            Andringslogg.Logga(db, projektId, av, "Dokument", d.Id, $"tog bort {Typer.GetValueOrDefault(d.Typ, "dokumentet")} {d.Namn}");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, d, "borttagen", av);
            return Results.NoContent();
        });

        return app;
    }

    // Känsliga dokument skickas inte ut i livesynken (alla i projektet får den); bara att något ändrats.
    private static Task Skicka(IHubContext<ProjektHub> hub, Guid projektId, ProjektDokument d, string typ, Anvandare av) =>
        hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse($"dokument:{d.Typ}", typ,
            Kansliga.Contains(d.Typ) ? new { d.Id, d.Typ } : Dto(d), av.Id, av.Namn));

    private static IResult Fel(string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["dokument"] = [text] });
}
