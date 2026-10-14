using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.FilApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.DriftkortApi;

/// <summary>
/// Skapar driftkort: flödesbilden från Ritbordet (sida 1) + funktionstexten i Word (sida 2 och framåt).
/// Resultatet, funktionstexten och SCADA-bilden sparas i Projektfiler under mappen Driftkort.
/// </summary>
public static class DriftkortEndpoints
{
    public const string Mapp = "Driftkort";
    private const long MaxStorlek = 100L * 1024 * 1024;

    public static IEndpointRouteBuilder MapDriftkortEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/driftkort").AddEndpointFilter<ProjektAtkomst>();

        // Formulär: namn, png (flödesbilden med I/O), svg (samma som vektor, valfri), scada (SVG utan I/O, valfri),
        // och antingen funktionstext (en .docx) eller filId (en .docx som redan finns i Projektfiler).
        g.MapPost("/", async (Guid projektId, HttpRequest request, ClaimsPrincipal user, PvDbContext db, IFilLagring lagring,
            IHubContext<ProjektHub> hub, CancellationToken ct) =>
        {
            if (!request.HasFormContentType) return Fel("Skicka underlaget som formulär.");
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId, ct)) return Results.NotFound();
            var form = await request.ReadFormAsync(ct);
            var namn = FilEndpoints.RentNamn(form["namn"].ToString().Trim() is { Length: > 0 } n ? n : "Driftkort");

            var png = await Las(form.Files.GetFile("png"), ct);
            if (png is null) return Fel("Flödesbilden saknas.");
            var svg = await Las(form.Files.GetFile("svg"), ct);
            var scada = await Las(form.Files.GetFile("scada"), ct);

            byte[]? text;
            string textNamn;
            var uppladdad = form.Files.GetFile("funktionstext");
            if (uppladdad is not null)
            {
                if (uppladdad.Length > MaxStorlek) return Fel("Funktionstexten är för stor.");
                text = await Las(uppladdad, ct);
                textNamn = uppladdad.FileName;
            }
            else if (Guid.TryParse(form["filId"], out var filId))
            {
                var fil = await db.Filer.AsNoTracking().FirstOrDefaultAsync(f => f.Id == filId && f.ProjektId == projektId, ct);
                if (fil is null) return Fel("Funktionstexten finns inte bland projektfilerna.");
                await using var s = await lagring.OppnaAsync(fil.BlobNamn, ct);
                if (s is null) return Fel("Funktionstexten kunde inte läsas.");
                using var m = new MemoryStream();
                await s.CopyToAsync(m, ct);
                text = m.ToArray();
                textNamn = fil.Namn;
            }
            else if (Guid.TryParse(form["dokumentId"], out var dokumentId))
            {
                // Projektets funktionstext (t.ex. importerad och bearbetad i verktyget) blir Word först.
                var dok = await db.Dokument.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dokumentId && d.ProjektId == projektId && d.Typ == "funktionstext", ct);
                if (dok is null) return Fel("Funktionstexten finns inte i projektet.");
                try { text = await FunktionstextApi.FunktionstextEndpoints.TillWordAsync(db, lagring, projektId, dok, ct); }
                catch (InvalidDataException e) { return Fel(e.Message); }
                textNamn = dok.Namn.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) ? dok.Namn : $"{dok.Namn}.docx";
            }
            else return Fel("Välj funktionstexten.");
            if (text is null || !textNamn.EndsWith(".docx", StringComparison.OrdinalIgnoreCase))
                return Fel("Funktionstexten måste vara en Word-fil i formatet .docx.");

            byte[] driftkort;
            try { driftkort = DriftkortWord.Bygg(text, png, svg); }
            catch (InvalidDataException e) { return Fel(e.Message); }
            // Projektets sidfot (status, datum, projektnummer …) skrivs in.
            driftkort = await DriftkortSidfot.TillampaAsync(db, projektId, driftkort, ct);

            var av = Anvandare.Fran(user);
            var sparade = new List<FilDto>
            {
                await FilEndpoints.SparaVersionAsync(db, lagring, projektId, Mapp, $"{namn}.docx", driftkort, av, ct),
            };
            if (uppladdad is not null)
                sparade.Add(await FilEndpoints.SparaVersionAsync(db, lagring, projektId, Mapp, textNamn, text, av, ct));
            if (scada is not null)
                sparade.Add(await FilEndpoints.SparaVersionAsync(db, lagring, projektId, Mapp, $"{namn}_SCADA.svg", scada, av, ct));
            await db.SaveChangesAsync(ct);
            foreach (var dto in sparade)
                await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("filer", "skapad", dto, av.Id, av.Namn), ct);
            return Results.Ok(new { driftkort = sparade[0], filer = sparade });
        }).DisableAntiforgery();

        // Skriver in projektets sidfot i alla Word-filer i mappen Driftkort (senaste versionen blir en ny version).
        g.MapPost("/sidfot/uppdatera", async (Guid projektId, ClaimsPrincipal user, PvDbContext db, IFilLagring lagring,
            IHubContext<ProjektHub> hub, CancellationToken ct) =>
        {
            var sidfot = await DriftkortSidfot.HamtaAsync(db, projektId, ct);
            if (sidfot is null || sidfot.ArTom) return Fel("Fyll i sidfoten först.");
            var loggor = DriftkortSidfot.LasLoggor(await DokumentApi.GemensamKatalogEndpoints.HamtaData(db, DriftkortSidfot.LoggKatalog));
            var filer = (await db.Filer.AsNoTracking().Where(f => f.ProjektId == projektId && f.Mapp == Mapp).ToListAsync(ct))
                .Where(f => f.Namn.EndsWith(".docx", StringComparison.OrdinalIgnoreCase))
                .GroupBy(f => f.Namn).Select(g => g.OrderByDescending(f => f.Version).First()).ToList();
            var av = Anvandare.Fran(user);
            var sparade = new List<FilDto>();
            var oforandrade = 0;
            foreach (var fil in filer)
            {
                byte[] fore;
                await using (var s = await lagring.OppnaAsync(fil.BlobNamn, ct))
                {
                    if (s is null) continue;
                    using var m = new MemoryStream();
                    await s.CopyToAsync(m, ct);
                    fore = m.ToArray();
                }
                var efter = DriftkortSidfot.Tillampa(fore, sidfot, loggor);
                if (ReferenceEquals(efter, fore) || efter.AsSpan().SequenceEqual(fore)) { oforandrade++; continue; }
                sparade.Add(await FilEndpoints.SparaVersionAsync(db, lagring, projektId, Mapp, fil.Namn, efter, av, ct));
            }
            await db.SaveChangesAsync(ct);
            foreach (var dto in sparade)
                await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("filer", "skapad", dto, av.Id, av.Namn), ct);
            return Results.Ok(new { uppdaterade = sparade.Count, oforandrade, filer = sparade });
        });

        return app;
    }

    private static async Task<byte[]?> Las(IFormFile? f, CancellationToken ct)
    {
        if (f is null || f.Length == 0 || f.Length > MaxStorlek) return null;
        using var m = new MemoryStream();
        await f.CopyToAsync(m, ct);
        return m.ToArray();
    }

    private static IResult Fel(string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["driftkort"] = [text] });
}
