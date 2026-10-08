using System.Reflection;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.DokumentApi;

public sealed record KatalogDto(string Namn, string Data, int Version, DateTimeOffset? Andrad, string AndradAv);
public sealed record KatalogSpara(string Data, int Version);

/// <summary>
/// Gemensamma kataloger som redigeras i appen: funktionstexter, projekteringsstöd, frågor till teknisk
/// beskrivning och byggvarudatabasen. Alla kan läsa; Admin, Projektledare och System kan ändra.
/// Tills någon sparat används grundkatalogen från dagens program.
/// </summary>
public static class GemensamKatalogEndpoints
{
    public static readonly Dictionary<string, string> Namn = new()
    {
        ["funktionstexter"] = "Funktionstexter",
        ["projekteringsstod"] = "Projekteringsstöd",
        ["tekniskbeskrivning"] = "Frågor till teknisk beskrivning",
        ["byggvaror"] = "Byggvarudatabasen",
        // Resursplaneringen (gemensam för alla projekt). Tom tills någon sparat; verktyget har då sin inbäddade planering.
        ["resursplanering"] = "Resursplaneringen",
    };

    public const int MaxLangd = 20_000_000;

    /// <summary>Grundkatalogen som följer med servern (från dagens program).</summary>
    public static string Grund(string namn)
    {
        var asm = Assembly.GetExecutingAssembly();
        var resurs = asm.GetManifestResourceNames().FirstOrDefault(n => n.EndsWith($".Kataloger.{namn}.json", StringComparison.Ordinal));
        if (resurs is null) return "";
        using var s = asm.GetManifestResourceStream(resurs)!;
        using var r = new StreamReader(s);
        return r.ReadToEnd();
    }

    public static async Task<string> HamtaData(PvDbContext db, string namn)
    {
        var k = await db.Kataloger.AsNoTracking().FirstOrDefaultAsync(x => x.Namn == namn);
        return k?.Data is { Length: > 0 } d ? d : Grund(namn);
    }

    public static IEndpointRouteBuilder MapGemensamKatalogEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/katalog/{namn}", async (string namn, PvDbContext db) =>
        {
            if (!Namn.ContainsKey(namn)) return Results.NotFound();
            var k = await db.Kataloger.AsNoTracking().FirstOrDefaultAsync(x => x.Namn == namn);
            return Results.Ok(k is null
                ? new KatalogDto(namn, Grund(namn), 0, null, "")
                : new KatalogDto(namn, k.Data, k.Version, k.Andrad, k.AndradAv));
        });

        app.MapPut("/api/katalog/{namn}", async (string namn, KatalogSpara spara, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (!Namn.TryGetValue(namn, out var rubrik)) return Results.NotFound();
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System))
                return Results.Problem(statusCode: 403, title: $"Bara Admin, Projektledare och System kan ändra {rubrik.ToLowerInvariant()}.");
            if (string.IsNullOrWhiteSpace(spara.Data) || spara.Data.Length > MaxLangd)
                return Results.ValidationProblem(new Dictionary<string, string[]> { ["data"] = ["Katalogen är tom eller för stor."] });
            try { System.Text.Json.JsonDocument.Parse(spara.Data).Dispose(); }
            catch (System.Text.Json.JsonException) { return Results.ValidationProblem(new Dictionary<string, string[]> { ["data"] = ["Katalogen kunde inte läsas."] }); }

            var av = Anvandare.Fran(user);
            var k = await db.Kataloger.FirstOrDefaultAsync(x => x.Namn == namn);
            if (k is null)
            {
                if (spara.Version != 0) return Results.Conflict(new { meddelande = "Katalogen har ändrats av någon annan." });
                k = new Katalog { Namn = namn };
                db.Kataloger.Add(k);
            }
            else
            {
                if (k.Version != spara.Version) return Results.Conflict(new { meddelande = "Katalogen har ändrats av någon annan." });
                k.Version++;
            }
            k.Data = spara.Data;
            k.Andrad = DateTimeOffset.UtcNow;
            k.AndradAv = av.Namn;
            try { await db.SaveChangesAsync(); }
            catch (DbUpdateException) { return Results.Conflict(new { meddelande = "Katalogen har ändrats av någon annan." }); }
            return Results.Ok(new KatalogDto(namn, k.Data, k.Version, k.Andrad, k.AndradAv));
        });

        return app;
    }
}
