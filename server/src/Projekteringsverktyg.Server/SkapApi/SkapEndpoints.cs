using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.Export;
using Projekteringsverktyg.Server.ListApi;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.SkapApi;

public sealed record SkapDto(Guid Id, string Namn, string Beteckning, string Placering, string Beskrivning, string Data, string Moduler,
    int Ordning, int Version, DateTimeOffset Andrad, string AndradAv)
{
    public static SkapDto Fran(Skap s) => new(s.Id, s.Namn, s.Beteckning, s.Placering, s.Beskrivning, s.Data, s.Moduler, s.Ordning, s.Version, s.Andrad, s.AndradAv);
}
public sealed record NyttSkap(string Namn);
public sealed record SkapSpara(string Namn, string? Beteckning, string? Placering, string? Beskrivning, string? Data, int Version);
public sealed record ModulerSpara(string Moduler, int Version);
public sealed record KorttypDto(Guid Id, string Namn, string Beskrivning, int AntalKanaler, string Farg, double BreddMm, double StromMa, int Ordning);

/// <summary>Modulbeläggningens innehåll (samma form som webbappen sparar).</summary>
public sealed record Modulbelaggning(string? Cpu1, List<ModulKort>? Kort);
public sealed record ModulKort(string? Id, string? Beskrivning, int AntalKanaler, string? Farg, double BreddMm, double StromMa, List<ModulKanal>? Kanaler);
public sealed record ModulKanal(string? KomponentId, string? Information);

/// <summary>
/// Projektets apparatskåp. Samma skåp används i Apparatskåp, Kraftberäkning och Modulbeläggning.
/// Modulbeläggningens kanaler pekar på komponentens Id; beteckning, typ och beskrivning läses från Komponenter.
/// </summary>
public static class SkapEndpoints
{
    public const int MaxLangd = 5_000_000;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static IEndpointRouteBuilder MapSkapEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- Korttyper (gemensamma) ----
        app.MapGet("/api/korttyper", async (PvDbContext db) =>
            (await db.Korttyper.OrderBy(k => k.Ordning).ThenBy(k => k.Namn).ToListAsync())
            .Select(k => new KorttypDto(k.Id, k.Namn, k.Beskrivning, k.AntalKanaler, k.Farg, k.BreddMm, k.StromMa, k.Ordning)));

        app.MapPost("/api/korttyper", async (KorttypDto ny, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin och System kan ändra korttyper.");
            if (string.IsNullOrWhiteSpace(ny.Namn)) return Results.ValidationProblem(new Dictionary<string, string[]> { ["namn"] = ["Ange ett namn."] });
            var k = await db.Korttyper.FindAsync(ny.Id);
            if (k is null) { k = new Korttyp(); db.Korttyper.Add(k); k.Ordning = (await db.Korttyper.MaxAsync(x => (int?)x.Ordning) ?? 0) + 1; }
            k.Namn = ny.Namn.Trim(); k.Beskrivning = ny.Beskrivning ?? ""; k.AntalKanaler = Math.Clamp(ny.AntalKanaler, 0, 64);
            k.Farg = ny.Farg ?? "#FFFFFF"; k.BreddMm = ny.BreddMm; k.StromMa = ny.StromMa;
            await db.SaveChangesAsync();
            return Results.Ok(new KorttypDto(k.Id, k.Namn, k.Beskrivning, k.AntalKanaler, k.Farg, k.BreddMm, k.StromMa, k.Ordning));
        });

        app.MapDelete("/api/korttyper/{id:guid}", async (Guid id, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.System))
                return Results.Problem(statusCode: 403, title: "Bara Admin och System kan ändra korttyper.");
            var k = await db.Korttyper.FindAsync(id);
            if (k is null) return Results.NotFound();
            db.Korttyper.Remove(k);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- Skåp i ett projekt ----
        var g = app.MapGroup("/api/projekt/{projektId:guid}/skap").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
            (await db.Skap.AsNoTracking().Where(s => s.ProjektId == projektId).OrderBy(s => s.Ordning).ThenBy(s => s.Namn).ToListAsync())
            .Select(SkapDto.Fran));

        g.MapPost("/", async (Guid projektId, NyttSkap ny, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId)) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var max = await db.Skap.Where(s => s.ProjektId == projektId).MaxAsync(s => (int?)s.Ordning) ?? 0;
            var namn = (ny.Namn ?? "").Trim();
            var s = new Skap { ProjektId = projektId, Namn = namn == "" ? $"AS{max + 1:00}" : namn, Ordning = max + 1, AndradAv = av.Namn };
            db.Skap.Add(s);
            Andringslogg.Logga(db, projektId, av, "Skap", s.Id, $"skapade apparatskåpet {s.Namn}");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "skapad", s, av);
            return Results.Ok(SkapDto.Fran(s));
        });

        g.MapPut("/{id:guid}", async (Guid projektId, Guid id, SkapSpara spara, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var s = await db.Skap.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (s is null) return Results.NotFound();
            if (s.Version != spara.Version) return Results.Conflict(new { meddelande = "Skåpet har ändrats av någon annan.", skap = SkapDto.Fran(s) });
            if ((spara.Data ?? "").Length > MaxLangd) return Results.ValidationProblem(new Dictionary<string, string[]> { ["data"] = ["För stort."] });
            var av = Anvandare.Fran(user);
            var namn = (spara.Namn ?? "").Trim();
            if (namn != "" && namn != s.Namn) Andringslogg.Logga(db, projektId, av, "Skap", s.Id, $"döpte om apparatskåpet {s.Namn} till {namn}", "namn", s.Namn, namn);
            else await LoggaHogstVar10(db, projektId, av, s, $"ändrade apparatskåpet {s.Namn}");
            if (namn != "") s.Namn = namn;
            s.Beteckning = (spara.Beteckning ?? "").Trim();
            s.Placering = (spara.Placering ?? "").Trim();
            s.Beskrivning = spara.Beskrivning ?? "";
            s.Data = spara.Data ?? "";
            return await Spara(db, hub, projektId, s, av);
        });

        g.MapPut("/{id:guid}/moduler", async (Guid projektId, Guid id, ModulerSpara spara, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var s = await db.Skap.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (s is null) return Results.NotFound();
            if (s.Version != spara.Version) return Results.Conflict(new { meddelande = "Skåpet har ändrats av någon annan.", skap = SkapDto.Fran(s) });
            if ((spara.Moduler ?? "").Length > MaxLangd) return Results.ValidationProblem(new Dictionary<string, string[]> { ["moduler"] = ["För stort."] });
            if (s.Moduler == spara.Moduler) return Results.Ok(SkapDto.Fran(s));
            var av = Anvandare.Fran(user);
            await LoggaHogstVar10(db, projektId, av, s, $"ändrade modulbeläggningen i {s.Namn}");
            s.Moduler = spara.Moduler ?? "";
            return await Spara(db, hub, projektId, s, av);
        });

        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, PvDbContext db, IHubContext<ProjektHub> hub) =>
        {
            var s = await db.Skap.FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (s is null) return Results.NotFound();
            var av = Anvandare.Fran(user);
            var kraft = Listdefinitioner.KraftPrefix + s.Id;
            db.ListRader.RemoveRange(await db.ListRader.Where(r => r.ProjektId == projektId && r.Lista == kraft).ToListAsync());
            db.Skap.Remove(s);
            Andringslogg.Logga(db, projektId, av, "Skap", s.Id, $"tog bort apparatskåpet {s.Namn}");
            await db.SaveChangesAsync();
            await Skicka(hub, projektId, "borttagen", s, av);
            return Results.NoContent();
        });

        g.MapGet("/{id:guid}/moduler/excel", async (Guid projektId, Guid id, PvDbContext db) =>
        {
            var s = await db.Skap.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.ProjektId == projektId);
            if (s is null) return Results.NotFound();
            var projekt = await db.Projekt.AsNoTracking().FirstAsync(p => p.Id == projektId);
            var komp = await db.Komponenter.AsNoTracking().Where(k => k.ProjektId == projektId).ToDictionaryAsync(k => k.Id.ToString());
            var m = LasModuler(s.Moduler);
            var rader = new List<object?[]> { new object?[] { "CPU1", "", "", m.Cpu1 ?? "", "" } };
            var nr = 0;
            foreach (var kort in m.Kort ?? new List<ModulKort>())
            {
                nr++;
                rader.Add([$"M{nr}", "", "", $"{kort.Beskrivning} [{kort.StromMa} mA, {kort.BreddMm} mm]", ""]);
                var i = 0;
                foreach (var kanal in kort.Kanaler ?? new List<ModulKanal>())
                {
                    i++;
                    komp.TryGetValue(kanal.KomponentId ?? "", out var k);
                    rader.Add([$"M{nr}:{i}", k?.Beteckning ?? "", k?.Komponenttyp ?? "", k?.Beskrivning ?? "", kanal.Information ?? ""]);
                }
            }
            var fil = Excel.Tabell("Modulbeläggning", $"Modulbeläggning {s.Namn} – {projekt.Namn} {projekt.Nummer}".Trim(),
                ["Kanal", "Beteckning", "Komponent", "Beskrivning", "Information"], rader);
            return Results.File(fil, Excel.MimeTyp, Excel.Filnamn($"Modulbeläggning {s.Namn}"));
        });

        return app;
    }

    public static Modulbelaggning LasModuler(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return new Modulbelaggning("", []);
        try { return JsonSerializer.Deserialize<Modulbelaggning>(json, Json) ?? new Modulbelaggning("", []); }
        catch (JsonException) { return new Modulbelaggning("", []); }
    }

    private static async Task LoggaHogstVar10(PvDbContext db, Guid projektId, Anvandare av, Skap s, string text)
    {
        var senaste = await db.Andringslogg
            .Where(l => l.ProjektId == projektId && l.Entitet == "Skap" && l.EntitetId == s.Id && l.AnvandarId == av.Id)
            .OrderByDescending(l => l.Id).Select(l => (DateTimeOffset?)l.Tidpunkt).FirstOrDefaultAsync();
        if (senaste is null || senaste < DateTimeOffset.UtcNow.AddMinutes(-10))
            Andringslogg.Logga(db, projektId, av, "Skap", s.Id, text);
    }

    private static async Task<IResult> Spara(PvDbContext db, IHubContext<ProjektHub> hub, Guid projektId, Skap s, Anvandare av)
    {
        s.Version++;
        s.Andrad = DateTimeOffset.UtcNow;
        s.AndradAv = av.Namn;
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateConcurrencyException) { return Results.Conflict(new { meddelande = "Skåpet har ändrats av någon annan." }); }
        await Skicka(hub, projektId, "andrad", s, av);
        return Results.Ok(SkapDto.Fran(s));
    }

    private static Task Skicka(IHubContext<ProjektHub> hub, Guid projektId, string typ, Skap s, Anvandare av) =>
        hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("skap", typ, SkapDto.Fran(s), av.Id, av.Namn));
}
