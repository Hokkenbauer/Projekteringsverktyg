using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.FilApi;

public sealed record FilDto(Guid Id, string Mapp, string Namn, int Version, int AntalVersioner, long Storlek, string Typ, DateTimeOffset Uppladdad, string UppladdadAv);

/// <summary>
/// Projektfiler i fasta mappar. Laddar man upp en fil med samma namn i samma mapp blir den en ny version;
/// äldre versioner finns kvar och kan hämtas.
/// </summary>
public static class FilEndpoints
{
    public const long MaxStorlek = 200L * 1024 * 1024;

    public static readonly string[] Mappar =
    [
        "Handlingar/Ritningar", "Handlingar/Beskrivningar", "Driftkort", "Leveranser", "Foton", "Signerade dokument", "Övrigt",
    ];

    private static readonly FileExtensionContentTypeProvider Typer = new();

    public static string RentNamn(string namn)
    {
        var bara = Path.GetFileName(namn.Replace('\\', '/')).Trim();
        var ogiltiga = Path.GetInvalidFileNameChars();
        bara = new string(bara.Select(c => ogiltiga.Contains(c) || char.IsControl(c) ? '_' : c).ToArray());
        if (bara.Length > 200) bara = bara[..200];
        return bara is "" or "." or ".." ? "fil" : bara;
    }

    public static IEndpointRouteBuilder MapFilEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/filer").AddEndpointFilter<ProjektAtkomst>();

        g.MapGet("/", async (Guid projektId, PvDbContext db) =>
        {
            var alla = await db.Filer.Where(f => f.ProjektId == projektId).ToListAsync();
            var filer = alla.GroupBy(f => (f.Mapp, f.Namn))
                .Select(grp =>
                {
                    var senaste = grp.OrderByDescending(f => f.Version).First();
                    return Dto(senaste, grp.Count());
                })
                .OrderBy(f => f.Mapp).ThenBy(f => f.Namn, StringComparer.CurrentCultureIgnoreCase);
            return new { mappar = Mappar, filer };
        });

        g.MapGet("/{id:guid}/versioner", async (Guid projektId, Guid id, PvDbContext db) =>
        {
            var fil = await db.Filer.FirstOrDefaultAsync(f => f.Id == id && f.ProjektId == projektId);
            if (fil is null) return Results.NotFound();
            var versioner = await db.Filer.Where(f => f.ProjektId == projektId && f.Mapp == fil.Mapp && f.Namn == fil.Namn)
                .OrderByDescending(f => f.Version).ToListAsync();
            return Results.Ok(versioner.Select(f => Dto(f, versioner.Count)));
        });

        g.MapPost("/", async (Guid projektId, HttpRequest request, ClaimsPrincipal user, PvDbContext db, IFilLagring lagring, IHubContext<ProjektHub> hub, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) return Fel("Skicka filerna som formulär.");
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId, ct)) return Results.NotFound();
            var form = await request.ReadFormAsync(ct);
            var mapp = form["mapp"].ToString();
            if (!Mappar.Contains(mapp)) return Fel("Okänd mapp.");
            if (form.Files.Count == 0) return Fel("Ingen fil valdes.");

            var av = Anvandare.Fran(user);
            var sparade = new List<FilDto>();
            foreach (var f in form.Files)
            {
                if (f.Length > MaxStorlek) return Fel($"{f.FileName} är större än 200 MB.");
                var namn = RentNamn(f.FileName);
                var tidigare = await db.Filer.Where(x => x.ProjektId == projektId && x.Mapp == mapp && x.Namn == namn)
                    .MaxAsync(x => (int?)x.Version, ct) ?? 0;
                var typ = Typer.TryGetContentType(namn, out var t) ? t : "application/octet-stream";
                var post = new ProjektFil
                {
                    ProjektId = projektId, Mapp = mapp, Namn = namn, Version = tidigare + 1,
                    Storlek = f.Length, Typ = typ, UppladdadAv = av.Namn,
                };
                post.BlobNamn = $"{projektId}/{post.Id}";
                await using (var s = f.OpenReadStream())
                    await lagring.SparaAsync(post.BlobNamn, s, typ, ct);
                db.Filer.Add(post);
                Andringslogg.Logga(db, projektId, av, "Fil", post.Id,
                    tidigare == 0 ? $"laddade upp {namn} i {mapp}" : $"laddade upp version {post.Version} av {namn} i {mapp}");
                sparade.Add(Dto(post, post.Version));
            }
            await db.SaveChangesAsync(ct);
            foreach (var dto in sparade)
                await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("filer", "skapad", dto, av.Id, av.Namn), ct);
            return Results.Ok(sparade);
        }).DisableAntiforgery();

        g.MapGet("/{id:guid}/innehall", async (Guid projektId, Guid id, bool? visa, PvDbContext db, IFilLagring lagring, CancellationToken ct) =>
        {
            var fil = await db.Filer.FirstOrDefaultAsync(f => f.Id == id && f.ProjektId == projektId, ct);
            if (fil is null) return Results.NotFound();
            var strom = await lagring.OppnaAsync(fil.BlobNamn, ct);
            if (strom is null) return Results.NotFound();
            return visa == true
                ? Results.Stream(strom, fil.Typ)
                : Results.File(strom, fil.Typ, fil.Namn);
        });

        // Tar bort filen med alla dess versioner.
        g.MapDelete("/{id:guid}", async (Guid projektId, Guid id, ClaimsPrincipal user, PvDbContext db, IFilLagring lagring, IHubContext<ProjektHub> hub, CancellationToken ct) =>
        {
            var fil = await db.Filer.FirstOrDefaultAsync(f => f.Id == id && f.ProjektId == projektId, ct);
            if (fil is null) return Results.NotFound();
            var alla = await db.Filer.Where(f => f.ProjektId == projektId && f.Mapp == fil.Mapp && f.Namn == fil.Namn).ToListAsync(ct);
            var av = Anvandare.Fran(user);
            db.Filer.RemoveRange(alla);
            Andringslogg.Logga(db, projektId, av, "Fil", fil.Id, $"tog bort {fil.Namn} från {fil.Mapp}");
            await db.SaveChangesAsync(ct);
            foreach (var f in alla) await lagring.TaBortAsync(f.BlobNamn, ct);
            await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("filer", "borttagen", Dto(fil, alla.Count), av.Id, av.Namn), ct);
            return Results.NoContent();
        });

        return app;
    }

    /// <summary>Sparar en fil som en ny version i mappen (ändringslogg ingår, men inte SaveChanges eller livesynk).</summary>
    public static async Task<FilDto> SparaVersionAsync(PvDbContext db, IFilLagring lagring, Guid projektId, string mapp, string filnamn,
        byte[] data, Anvandare av, CancellationToken ct)
    {
        var namn = RentNamn(filnamn);
        var tidigare = await db.Filer.Where(x => x.ProjektId == projektId && x.Mapp == mapp && x.Namn == namn)
            .MaxAsync(x => (int?)x.Version, ct) ?? 0;
        var typ = Typer.TryGetContentType(namn, out var t) ? t : "application/octet-stream";
        var post = new ProjektFil
        {
            ProjektId = projektId, Mapp = mapp, Namn = namn, Version = tidigare + 1,
            Storlek = data.LongLength, Typ = typ, UppladdadAv = av.Namn,
        };
        post.BlobNamn = $"{projektId}/{post.Id}";
        using (var s = new MemoryStream(data, writable: false))
            await lagring.SparaAsync(post.BlobNamn, s, typ, ct);
        db.Filer.Add(post);
        Andringslogg.Logga(db, projektId, av, "Fil", post.Id,
            tidigare == 0 ? $"skapade {namn} i {mapp}" : $"skapade version {post.Version} av {namn} i {mapp}");
        return Dto(post, post.Version);
    }

    private static FilDto Dto(ProjektFil f, int antal) => new(f.Id, f.Mapp, f.Namn, f.Version, antal, f.Storlek, f.Typ, f.Uppladdad, f.UppladdadAv);

    private static IResult Fel(string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["fil"] = [text] });
}
