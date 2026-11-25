using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.ProjektApi;

public sealed record ProjektDto(
    Guid Id, string Namn, string Nummer, string Kund, string Ansvarig,
    DateTimeOffset Skapad, string SkapadAv, int AntalKomponenter,
    DateTimeOffset? Arkiverad = null, Guid? KategoriId = null, bool KanLeda = false);

public sealed record NyttProjekt(string Namn, string? Nummer, string? Kund, string? Ansvarig);
public sealed record ProjektUppgifter(string Namn, string? Nummer, string? Kund);

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

    private static IResult Fel(string falt, string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [falt] = [text] });

    /// <summary>Sant om ett annat aktivt (ej arkiverat) projekt redan har namnet. Skiftläge spelar ingen roll.</summary>
    private static async Task<bool> NamnUpptaget(PvDbContext db, string namn, Guid? utom)
    {
        var aktiva = await db.Projekt.Where(p => p.Arkiverad == null && p.Id != utom).Select(p => p.Namn).ToListAsync();
        return ProjektNamn.Krockar(namn, aktiva);
    }

    private static Task<ProjektDto?> HamtaDto(PvDbContext db, Guid id) =>
        db.Projekt.Where(p => p.Id == id)
            .Select(p => new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, p.Komponenter.Count, p.Arkiverad, null, false))
            .FirstOrDefaultAsync();

    /// <summary>Skickar projektets nya uppgifter till alla som har projektet öppet (livesynk) och returnerar dem.</summary>
    private static async Task<ProjektDto?> Skicka(PvDbContext db, IHubContext<ProjektHub> hub, Guid id, Anvandare av)
    {
        var dto = await HamtaDto(db, id);
        if (dto is not null)
            await hub.Clients.Group(ProjektHub.Grupp(id)).SendAsync("ListaAndrad", new ListaHandelse("projekt", "andrad", dto, av.Id, av.Namn));
        return dto;
    }

    public static IEndpointRouteBuilder MapProjektEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt").AddEndpointFilter<ProjektAtkomst>();

        // Fas 1: alla inloggade i organisationen ser alla projekt.
        // Behörighet per projekt (medlemmar och roller) läggs till i ett senare steg.
        // Startsidans lista: alla projekt användaren ser, med arkivering, kategori och om användaren får leda projektet
        // (ändra namn, arkivera).
        g.MapGet("/", async (ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            var anv = await beh.AktuellAsync(user);
            var omfang = ProjektKategorier.Omfang(anv);
            var admin = anv.Roll == Roller.Admin;
            return await SynligaProjekt(db, anv)
                .OrderByDescending(p => p.Skapad)
                .Select(p => new ProjektDto(p.Id, p.Namn, p.Nummer, p.Kund, p.Ansvarig, p.Skapad, p.SkapadAv, p.Komponenter.Count,
                    p.Arkiverad,
                    db.KategoriPlatser.Where(k => k.ProjektId == p.Id && k.AgareId == omfang).Select(k => (Guid?)k.KategoriId).FirstOrDefault(),
                    admin || db.Medlemmar.Any(m => m.ProjektId == p.Id && m.AnvandarId == anv.Id && m.Roll == Roller.Projektledare)))
                .ToListAsync();
        });

        g.MapGet("/{id:guid}", async (Guid id, PvDbContext db) =>
            await HamtaDto(db, id) is { } dto ? Results.Ok(dto) : Results.NotFound());

        // Ändra namn, projektnummer och kund. Projektledare (och Admin). Två aktiva projekt får inte heta likadant.
        g.MapPut("/{id:guid}/uppgifter", async (Guid id, ProjektUppgifter ny, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await beh.KanLedaProjekt(user, id)) return Results.Problem(statusCode: 403, title: "Bara projektledaren kan ändra projektets namn.");
            var p = await db.Projekt.FirstOrDefaultAsync(x => x.Id == id);
            if (p is null) return Results.NotFound();
            var namn = (ny.Namn ?? "").Trim();
            if (namn == "") return Fel("namn", "Projektet behöver ett namn.");
            if (namn.Length > ProjektNamn.MaxLangd) return Fel("namn", $"Namnet får vara högst {ProjektNamn.MaxLangd} tecken.");
            var nummer = (ny.Nummer ?? p.Nummer).Trim();
            if (nummer.Length > 50) return Fel("nummer", "Projektnumret får vara högst 50 tecken.");
            var kund = (ny.Kund ?? p.Kund).Trim();
            if (ProjektNamn.Nyckel(namn) != ProjektNamn.Nyckel(p.Namn) && await NamnUpptaget(db, namn, id))
                return Fel("namn", $"Det finns redan ett projekt som heter {namn}. Välj ett annat namn.");

            var av = Anvandare.Fran(user);
            void Andra(string falt, string rubrik, string fore, string efter, Action<string> satt)
            {
                if (fore == efter) return;
                satt(efter);
                Andringslogg.Logga(db, id, av, "Projekt", id, $"ändrade projektets {rubrik}", falt, fore, efter);
            }
            Andra("namn", "namn", p.Namn, namn, v => p.Namn = v);
            Andra("nummer", "projektnummer", p.Nummer, nummer, v => p.Nummer = v);
            Andra("kund", "kund", p.Kund, kund, v => p.Kund = v);
            await db.SaveChangesAsync();
            return Results.Ok(await Skicka(db, hub, id, av));
        });

        // Arkivera: projektet flyttas till Arkiv på startsidan och får " – Arkiverat ÅÅÅÅ-MM-DD" i namnet,
        // så att namnet blir ledigt. Projektet går att öppna och ändra som vanligt och kan återställas.
        g.MapPost("/{id:guid}/arkivera", async (Guid id, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await beh.KanLedaProjekt(user, id)) return Results.Problem(statusCode: 403, title: "Bara projektledaren kan arkivera projektet.");
            var p = await db.Projekt.FirstOrDefaultAsync(x => x.Id == id);
            if (p is null) return Results.NotFound();
            if (p.Arkiverad is not null) return Fel("arkiverad", "Projektet är redan arkiverat.");

            var nu = DateTimeOffset.UtcNow;
            var datum = DateOnly.FromDateTime(nu.ToOffset(Export.Excel.Svensk(nu)).DateTime);
            var upptagna = await db.Projekt.Where(x => x.Id != id).Select(x => x.Namn).ToListAsync();
            var av = Anvandare.Fran(user);
            var fore = p.Namn;
            p.Namn = ProjektNamn.Arkiverat(p.Namn, datum, upptagna);
            p.Arkiverad = nu;
            p.ArkiveradAv = av.Namn;
            Andringslogg.Logga(db, id, av, "Projekt", id, "arkiverade projektet", "namn", fore, p.Namn);
            await db.SaveChangesAsync();
            return Results.Ok(await Skicka(db, hub, id, av));
        });

        // Återställ från Arkiv. Arkivtillägget tas bort ur namnet om det namnet är ledigt bland aktiva projekt.
        g.MapPost("/{id:guid}/aterstall", async (Guid id, ClaimsPrincipal user, Behorighet beh, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await beh.KanLedaProjekt(user, id)) return Results.Problem(statusCode: 403, title: "Bara projektledaren kan återställa projektet.");
            var p = await db.Projekt.FirstOrDefaultAsync(x => x.Id == id);
            if (p is null) return Results.NotFound();
            if (p.Arkiverad is null) return Fel("arkiverad", "Projektet är inte arkiverat.");

            var av = Anvandare.Fran(user);
            var fore = p.Namn;
            var utan = ProjektNamn.UtanArkiv(p.Namn);
            if (utan != "" && !await NamnUpptaget(db, utan, id)) p.Namn = utan;
            p.Arkiverad = null;
            p.ArkiveradAv = "";
            Andringslogg.Logga(db, id, av, "Projekt", id, "återställde projektet från arkivet", "namn", fore, p.Namn);
            await db.SaveChangesAsync();
            return Results.Ok(await Skicka(db, hub, id, av));
        });

        g.MapPost("/", async (NyttProjekt nytt, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            if (!await beh.KanSkapaProjekt(user)) return Results.Forbid();
            if (string.IsNullOrWhiteSpace(nytt.Namn))
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["namn"] = ["Projektet behöver ett namn."] });
            if (await NamnUpptaget(db, nytt.Namn, null))
                return Fel("namn", $"Det finns redan ett projekt som heter {nytt.Namn.Trim()}. Välj ett annat namn.");

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
            db.Medlemmar.Add(new ProjektMedlem { Roll = Roller.Projektledare, ProjektId = p.Id, AnvandarId = (await beh.AktuellAsync(user)).Id, TillagdAv = av.Namn });
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
