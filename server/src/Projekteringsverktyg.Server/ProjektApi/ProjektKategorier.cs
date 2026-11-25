using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.ProjektApi;

public sealed record KategoriDto(Guid Id, Guid? ForalderId, string Namn, int Ordning);
public sealed record NyKategori(string Namn, Guid? ForalderId);
public sealed record AndraKategori(string? Namn, Guid? ForalderId, bool FlyttaTillToppen = false, int? Ordning = null);
public sealed record KategoriPlacering(Guid ProjektId, Guid? KategoriId);

/// <summary>
/// Kategorier (mappar) på startsidan, med underkategorier. Strukturen är gemensam för alla och sköts
/// av den som får skapa projekt. Var och en ser bara de projekt den har tillgång till.
/// </summary>
public static class ProjektKategorier
{
    public const int MaxDjup = 6;

    /// <summary>
    /// Vems kategoristruktur användaren arbetar i. "" = den gemensamma.
    /// <para>Ska kategorierna bli per användare: returnera <c>a.Id</c> här. Tabellerna har redan AgareId,
    /// och KanOrdna nedan släpper då in alla eftersom var och en bara ändrar sin egen struktur.</para>
    /// </summary>
    public static string Omfang(AnvandarPost a) => "";

    /// <summary>Får skapa, ändra och ta bort kategorier och flytta projekt mellan dem.</summary>
    public static bool KanOrdna(AnvandarPost a) => Omfang(a) != "" || Behorighet.FarSkapaProjekt(a);

    /// <summary>Kategorins väg uppåt (sig själv först). Stannar vid en trasig länk eller en slinga.</summary>
    public static List<Guid> VagUppat(Guid id, IReadOnlyDictionary<Guid, Guid?> foraldrar)
    {
        var vag = new List<Guid>();
        Guid? n = id;
        while (n is { } x && !vag.Contains(x))
        {
            vag.Add(x);
            n = foraldrar.TryGetValue(x, out var f) ? f : null;
        }
        return vag;
    }

    /// <summary>Sant om kategorin <paramref name="id"/> kan läggas under <paramref name="nyForalder"/> utan slinga.</summary>
    public static bool KanFlyttas(Guid id, Guid? nyForalder, IReadOnlyDictionary<Guid, Guid?> foraldrar) =>
        nyForalder is not { } f || !VagUppat(f, foraldrar).Contains(id);

    /// <summary>Hur många nivåer under kategorin finns (0 = inga underkategorier).</summary>
    public static int DjupUnder(Guid id, IReadOnlyDictionary<Guid, Guid?> foraldrar)
    {
        var barn = foraldrar.Where(kv => kv.Value == id).Select(kv => kv.Key).ToList();
        return barn.Count == 0 ? 0 : 1 + barn.Max(b => DjupUnder(b, foraldrar));
    }

    private static IResult Fel(string falt, string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [falt] = [text] });

    private static IResult EjBehorig() =>
        Results.Problem(statusCode: 403, title: "Du får inte ändra kategorierna på startsidan.");

    public static IEndpointRouteBuilder MapProjektKategoriEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projektkategorier");

        g.MapGet("/", async (ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            var omfang = Omfang(await beh.AktuellAsync(user));
            return await db.ProjektKategorier.AsNoTracking().Where(k => k.AgareId == omfang)
                .OrderBy(k => k.Ordning).ThenBy(k => k.Namn)
                .Select(k => new KategoriDto(k.Id, k.ForalderId, k.Namn, k.Ordning))
                .ToListAsync();
        });

        g.MapPost("/", async (NyKategori ny, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            var anv = await beh.AktuellAsync(user);
            if (!KanOrdna(anv)) return EjBehorig();
            var namn = (ny.Namn ?? "").Trim();
            if (namn == "") return Fel("namn", "Kategorin behöver ett namn.");
            if (namn.Length > 100) return Fel("namn", "Namnet får vara högst 100 tecken.");
            var omfang = Omfang(anv);
            var alla = await db.ProjektKategorier.Where(k => k.AgareId == omfang).ToListAsync();
            if (ny.ForalderId is { } f)
            {
                var foraldrar = alla.ToDictionary(k => k.Id, k => k.ForalderId);
                if (!foraldrar.ContainsKey(f)) return Fel("foralderId", "Den överordnade kategorin finns inte längre.");
                if (VagUppat(f, foraldrar).Count >= MaxDjup) return Fel("foralderId", $"Kategorierna kan vara högst {MaxDjup} nivåer djupa.");
            }
            if (alla.Any(k => k.ForalderId == ny.ForalderId && ProjektNamn.Nyckel(k.Namn) == ProjektNamn.Nyckel(namn)))
                return Fel("namn", $"Det finns redan en kategori som heter {namn} på samma ställe.");

            var kat = new ProjektKategori
            {
                ForalderId = ny.ForalderId, AgareId = omfang, Namn = namn, SkapadAv = anv.Namn,
                Ordning = alla.Where(k => k.ForalderId == ny.ForalderId).Select(k => k.Ordning + 1).DefaultIfEmpty(0).Max(),
            };
            db.ProjektKategorier.Add(kat);
            await db.SaveChangesAsync();
            return Results.Ok(new KategoriDto(kat.Id, kat.ForalderId, kat.Namn, kat.Ordning));
        });

        // Byt namn och/eller flytta kategorin (med allt innehåll) till en annan kategori eller till översta nivån.
        g.MapPut("/{id:guid}", async (Guid id, AndraKategori andra, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            var anv = await beh.AktuellAsync(user);
            if (!KanOrdna(anv)) return EjBehorig();
            var omfang = Omfang(anv);
            var alla = await db.ProjektKategorier.Where(k => k.AgareId == omfang).ToListAsync();
            var kat = alla.FirstOrDefault(k => k.Id == id);
            if (kat is null) return Results.NotFound();
            var foraldrar = alla.ToDictionary(k => k.Id, k => k.ForalderId);

            var nyForalder = andra.FlyttaTillToppen ? null : andra.ForalderId ?? kat.ForalderId;
            if (nyForalder != kat.ForalderId)
            {
                if (nyForalder is { } f && !foraldrar.ContainsKey(f)) return Fel("foralderId", "Kategorin du flyttar till finns inte längre.");
                if (!KanFlyttas(id, nyForalder, foraldrar)) return Fel("foralderId", "En kategori kan inte läggas inuti sig själv eller sina underkategorier.");
                var nivaer = (nyForalder is { } nf ? VagUppat(nf, foraldrar).Count : 0) + 1 + DjupUnder(id, foraldrar);
                if (nivaer > MaxDjup) return Fel("foralderId", $"Kategorierna kan vara högst {MaxDjup} nivåer djupa.");
            }
            var namn = andra.Namn is null ? kat.Namn : andra.Namn.Trim();
            if (namn == "") return Fel("namn", "Kategorin behöver ett namn.");
            if (namn.Length > 100) return Fel("namn", "Namnet får vara högst 100 tecken.");
            if (alla.Any(k => k.Id != id && k.ForalderId == nyForalder && ProjektNamn.Nyckel(k.Namn) == ProjektNamn.Nyckel(namn)))
                return Fel("namn", $"Det finns redan en kategori som heter {namn} på samma ställe.");

            if (nyForalder != kat.ForalderId && andra.Ordning is null)
                kat.Ordning = alla.Where(k => k.ForalderId == nyForalder).Select(k => k.Ordning + 1).DefaultIfEmpty(0).Max();
            if (andra.Ordning is { } o) kat.Ordning = o;
            kat.ForalderId = nyForalder;
            kat.Namn = namn;
            await db.SaveChangesAsync();
            return Results.Ok(new KategoriDto(kat.Id, kat.ForalderId, kat.Namn, kat.Ordning));
        });

        // Tar bort kategorin. Underkategorier och projekt flyttas upp en nivå – inga projekt tas bort.
        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            var anv = await beh.AktuellAsync(user);
            if (!KanOrdna(anv)) return EjBehorig();
            var omfang = Omfang(anv);
            var kat = await db.ProjektKategorier.FirstOrDefaultAsync(k => k.Id == id && k.AgareId == omfang);
            if (kat is null) return Results.NotFound();

            await using var tx = await db.Database.BeginTransactionAsync();
            foreach (var barn in await db.ProjektKategorier.Where(k => k.ForalderId == id).ToListAsync())
                barn.ForalderId = kat.ForalderId;
            var platser = await db.KategoriPlatser.Where(p => p.KategoriId == id).ToListAsync();
            db.KategoriPlatser.RemoveRange(platser);
            await db.SaveChangesAsync();
            if (kat.ForalderId is { } upp)
                db.KategoriPlatser.AddRange(platser.Select(p => new ProjektKategoriPlats { ProjektId = p.ProjektId, AgareId = p.AgareId, KategoriId = upp }));
            db.ProjektKategorier.Remove(kat);
            await db.SaveChangesAsync();
            await tx.CommitAsync();
            return Results.NoContent();
        });

        // Lägger ett projekt i en kategori (KategoriId = null: Utan kategori).
        g.MapPut("/placering", async (KategoriPlacering pl, ClaimsPrincipal user, Behorighet beh, PvDbContext db) =>
        {
            var anv = await beh.AktuellAsync(user);
            if (!KanOrdna(anv)) return EjBehorig();
            if (!await beh.KanLasa(user, pl.ProjektId)) return Results.Problem(statusCode: 403, title: "Du har inte tillgång till projektet.");
            var omfang = Omfang(anv);
            if (pl.KategoriId is { } k && !await db.ProjektKategorier.AnyAsync(x => x.Id == k && x.AgareId == omfang))
                return Fel("kategoriId", "Kategorin finns inte längre.");

            var plats = await db.KategoriPlatser.FirstOrDefaultAsync(p => p.ProjektId == pl.ProjektId && p.AgareId == omfang);
            if (pl.KategoriId is null) { if (plats is not null) db.KategoriPlatser.Remove(plats); }
            else if (plats is null) db.KategoriPlatser.Add(new ProjektKategoriPlats { ProjektId = pl.ProjektId, AgareId = omfang, KategoriId = pl.KategoriId.Value });
            else if (plats.KategoriId != pl.KategoriId)
            {
                // Nyckeln är (ProjektId, AgareId), så KategoriId kan ändras direkt.
                plats.KategoriId = pl.KategoriId.Value;
            }
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        return app;
    }
}
