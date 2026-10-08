using System.Security.Claims;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.FilApi;

namespace Projekteringsverktyg.Server.DokumentApi;

public sealed record VerktygDto(Guid Id, string Namn, long Storlek, DateTimeOffset Uppladdad, string UppladdadAv);
public sealed record SupportFilDto(Guid Id, string Namn, string Kategori, long Storlek, DateTimeOffset Uppladdad, string UppladdadAv);
public sealed record SupportFilAndra(string? Namn, string? Kategori);

/// <summary>
/// HTML-verktyg och supportbiblioteket (PDF-manualer). Gemensamma för alla; alla inloggade kan använda dem,
/// Admin, Projektledare och System kan ladda upp och ta bort.
/// </summary>
public static class VerktygEndpoints
{
    public const long MaxVerktyg = 20L * 1024 * 1024;
    public const long MaxSupport = 300L * 1024 * 1024;

    private static async Task<IResult?> FarAndra(ClaimsPrincipal user, Behorighet beh) =>
        await beh.HarRoll(user, Roller.Admin, Roller.Projektledare, Roller.System)
            ? null
            : Results.Problem(statusCode: 403, title: "Bara Admin, Projektledare och System kan ladda upp och ta bort.");

    private static IResult Fel(string text) => Results.ValidationProblem(new Dictionary<string, string[]> { ["fil"] = [text] });

    public static IEndpointRouteBuilder MapVerktygEndpoints(this IEndpointRouteBuilder app)
    {
        // ---- HTML-verktyg ----
        app.MapGet("/api/verktyg", async (PvDbContext db) =>
            (await db.Verktyg.AsNoTracking().OrderBy(v => v.Namn).ToListAsync())
                .Select(v => new VerktygDto(v.Id, v.Namn, v.Storlek, v.Uppladdad, v.UppladdadAv)));

        app.MapGet("/api/verktyg/{id:guid}", async (Guid id, PvDbContext db) =>
            await db.Verktyg.AsNoTracking().FirstOrDefaultAsync(v => v.Id == id) is { } v
                ? Results.Text(v.Html, "text/plain; charset=utf-8")
                : Results.NotFound());

        app.MapPost("/api/verktyg", async (HttpRequest request, ClaimsPrincipal user, PvDbContext db, Behorighet beh, CancellationToken ct) =>
        {
            if (await FarAndra(user, beh) is { } nej) return nej;
            if (!request.HasFormContentType) return Fel("Skicka filen som formulär.");
            var form = await request.ReadFormAsync(ct);
            var f = form.Files.GetFile("fil");
            if (f is null || f.Length == 0) return Fel("Ingen fil valdes.");
            if (f.Length > MaxVerktyg) return Fel("Filen är större än 20 MB.");
            if (!f.FileName.EndsWith(".html", StringComparison.OrdinalIgnoreCase) && !f.FileName.EndsWith(".htm", StringComparison.OrdinalIgnoreCase))
                return Fel("Bara HTML-filer (.html) kan läggas till som verktyg.");
            using var r = new StreamReader(f.OpenReadStream(), Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
            var html = await r.ReadToEndAsync(ct);
            var namn = form["namn"].ToString().Trim();
            if (namn == "") namn = Path.GetFileNameWithoutExtension(FilEndpoints.RentNamn(f.FileName)).Replace('_', ' ');
            var v = new Verktyg { Namn = namn, Html = html, Storlek = f.Length, UppladdadAv = Anvandare.Fran(user).Namn };
            db.Verktyg.Add(v);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new VerktygDto(v.Id, v.Namn, v.Storlek, v.Uppladdad, v.UppladdadAv));
        }).DisableAntiforgery();

        app.MapDelete("/api/verktyg/{id:guid}", async (Guid id, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (await FarAndra(user, beh) is { } nej) return nej;
            var v = await db.Verktyg.FirstOrDefaultAsync(x => x.Id == id);
            if (v is null) return Results.NotFound();
            db.Verktyg.Remove(v);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

        // ---- Supportbiblioteket ----
        app.MapGet("/api/support", async (PvDbContext db) =>
            (await db.SupportFiler.AsNoTracking().OrderBy(f => f.Kategori).ThenBy(f => f.Namn).ToListAsync())
                .Select(f => new SupportFilDto(f.Id, f.Namn, f.Kategori, f.Storlek, f.Uppladdad, f.UppladdadAv)));

        app.MapPost("/api/support", async (HttpRequest request, ClaimsPrincipal user, PvDbContext db, Behorighet beh, IFilLagring lagring, CancellationToken ct) =>
        {
            if (await FarAndra(user, beh) is { } nej) return nej;
            if (!request.HasFormContentType) return Fel("Skicka filerna som formulär.");
            var form = await request.ReadFormAsync(ct);
            if (form.Files.Count == 0) return Fel("Ingen fil valdes.");
            var kategori = form["kategori"].ToString().Trim();
            var av = Anvandare.Fran(user).Namn;
            var sparade = new List<SupportFilDto>();
            foreach (var f in form.Files)
            {
                if (f.Length > MaxSupport) return Fel($"{f.FileName} är större än 300 MB.");
                if (!f.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) return Fel($"{f.FileName} är inte en PDF.");
                var post = new SupportFil
                {
                    Namn = Path.GetFileNameWithoutExtension(FilEndpoints.RentNamn(f.FileName)),
                    Kategori = kategori == "" ? Kategori(f.FileName) : kategori,
                    Storlek = f.Length, UppladdadAv = av,
                };
                post.BlobNamn = $"support/{post.Id}";
                await using (var s = f.OpenReadStream())
                    await lagring.SparaAsync(post.BlobNamn, s, post.Typ, ct);
                db.SupportFiler.Add(post);
                sparade.Add(new SupportFilDto(post.Id, post.Namn, post.Kategori, post.Storlek, post.Uppladdad, post.UppladdadAv));
            }
            await db.SaveChangesAsync(ct);
            return Results.Ok(sparade);
        }).DisableAntiforgery();

        app.MapPatch("/api/support/{id:guid}", async (Guid id, SupportFilAndra andra, ClaimsPrincipal user, PvDbContext db, Behorighet beh) =>
        {
            if (await FarAndra(user, beh) is { } nej) return nej;
            var f = await db.SupportFiler.FirstOrDefaultAsync(x => x.Id == id);
            if (f is null) return Results.NotFound();
            if (!string.IsNullOrWhiteSpace(andra.Namn)) f.Namn = andra.Namn.Trim();
            if (andra.Kategori is not null) f.Kategori = andra.Kategori.Trim();
            await db.SaveChangesAsync();
            return Results.Ok(new SupportFilDto(f.Id, f.Namn, f.Kategori, f.Storlek, f.Uppladdad, f.UppladdadAv));
        });

        app.MapGet("/api/support/{id:guid}/innehall", async (Guid id, bool? visa, PvDbContext db, IFilLagring lagring, CancellationToken ct) =>
        {
            var f = await db.SupportFiler.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id, ct);
            if (f is null) return Results.NotFound();
            var s = await lagring.OppnaAsync(f.BlobNamn, ct);
            if (s is null) return Results.NotFound();
            return visa == true ? Results.Stream(s, f.Typ) : Results.File(s, f.Typ, f.Namn + ".pdf");
        });

        app.MapDelete("/api/support/{id:guid}", async (Guid id, ClaimsPrincipal user, PvDbContext db, Behorighet beh, IFilLagring lagring, CancellationToken ct) =>
        {
            if (await FarAndra(user, beh) is { } nej) return nej;
            var f = await db.SupportFiler.FirstOrDefaultAsync(x => x.Id == id, ct);
            if (f is null) return Results.NotFound();
            db.SupportFiler.Remove(f);
            await db.SaveChangesAsync(ct);
            await lagring.TaBortAsync(f.BlobNamn, ct);
            return Results.NoContent();
        });

        return app;
    }

    /// <summary>Gissar kategori (fabrikat) från filnamnet: "Beckhoff_cx9020_hwen.pdf" → Beckhoff.</summary>
    public static string Kategori(string filnamn)
    {
        var namn = Path.GetFileNameWithoutExtension(filnamn).Trim();
        var forsta = namn.Split(['_', ' ', '-'], 2, StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? "";
        return forsta.Length >= 2 && forsta.Any(char.IsLetter) ? char.ToUpper(forsta[0]) + forsta[1..] : "Övrigt";
    }
}
