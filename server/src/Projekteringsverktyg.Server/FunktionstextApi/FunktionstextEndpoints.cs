using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.AttGoraApi;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.DokumentApi;
using Projekteringsverktyg.Server.FilApi;
using Projekteringsverktyg.Server.ProjektApi;
using Projekteringsverktyg.Server.Synk;

namespace Projekteringsverktyg.Server.FunktionstextApi;

public sealed record ImportRapport(string Fil, string Namn, string? System, int Stycken, int Tabeller, string? Fel);

/// <summary>
/// Import av färdiga funktionstexter/driftkort (Word) till projektets funktionstexter, och Word-export av en text.
/// Originalfilen sparas i Projektfiler › Funktionstexter och används som mall när texten blir Word igen.
/// </summary>
public static partial class FunktionstextEndpoints
{
    public const string Mapp = "Funktionstexter";
    private const long MaxStorlek = 50L * 1024 * 1024;

    public static IEndpointRouteBuilder MapFunktionstextEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/projekt/{projektId:guid}/funktionstexter").AddEndpointFilter<ProjektAtkomst>();

        g.MapPost("/import", async (Guid projektId, HttpRequest request, ClaimsPrincipal user, PvDbContext db, IFilLagring lagring,
            IHubContext<ProjektHub> hub, ILoggerFactory loggar, CancellationToken ct) =>
        {
            var log = loggar.CreateLogger("Funktionstextimport");
            if (!request.HasFormContentType) return Fel("Skicka filerna som formulär.");
            if (!await db.Projekt.AnyAsync(p => p.Id == projektId, ct)) return Results.NotFound();
            var form = await request.ReadFormAsync(ct);
            if (form.Files.Count == 0) return Fel("Ingen fil valdes.");
            var av = Anvandare.Fran(user);
            var rapport = new List<ImportRapport>();
            var skapade = new List<ProjektDokument>();
            var filer = new List<FilDto>();
            var max = await db.Dokument.Where(d => d.ProjektId == projektId && d.Typ == "funktionstext").MaxAsync(d => (int?)d.Ordning, ct) ?? 0;

            foreach (var f in form.Files)
            {
                var filnamn = FilEndpoints.RentNamn(f.FileName);
                if (!filnamn.EndsWith(".docx", StringComparison.OrdinalIgnoreCase))
                { rapport.Add(new(filnamn, "", null, 0, 0, "Bara Word-filer i formatet .docx kan importeras.")); continue; }
                if (f.Length > MaxStorlek) { rapport.Add(new(filnamn, "", null, 0, 0, "Filen är större än 50 MB.")); continue; }
                using var m = new MemoryStream();
                await f.CopyToAsync(m, ct);
                var bytes = m.ToArray();
                WordHtml.Import imp;
                try { imp = WordHtml.TillHtml(bytes); }
                catch (InvalidDataException e) { rapport.Add(new(filnamn, "", null, 0, 0, e.Message)); continue; }
                catch (Exception e)
                {
                    // Oväntad uppbyggnad i Word-filen: rapportera den här filen, de andra importeras ändå.
                    log.LogWarning(e, "Funktionstext {Fil} kunde inte läsas", filnamn);
                    rapport.Add(new(filnamn, "", null, 0, 0, $"Word-filen kunde inte läsas ({e.GetType().Name})."));
                    continue;
                }

                var original = await FilEndpoints.SparaVersionAsync(db, lagring, projektId, Mapp, filnamn, bytes, av, ct);
                filer.Add(original);
                var system = imp.System ?? SystemIFilnamn(filnamn);
                // Texten heter exakt som filen (utan sökväg), så att man känner igen den. Namnet kan ändras efteråt.
                var namn = Path.GetFileName(f.FileName.Replace('\\', '/')).Trim() is { Length: > 0 } exakt ? exakt : filnamn;
                var d = new ProjektDokument
                {
                    ProjektId = projektId, Typ = "funktionstext", Namn = namn, Ordning = ++max, AndradAv = av.Namn,
                    Data = WordHtml.MedMeta(imp.Html, new WordHtml.Meta(original.Id.ToString(), system)),
                };
                db.Dokument.Add(d);
                Andringslogg.Logga(db, projektId, av, "Dokument", d.Id, $"importerade funktionstexten {d.Namn} från {filnamn}");
                skapade.Add(d);
                rapport.Add(new(filnamn, namn, system, imp.Stycken, imp.Tabeller, null));
            }
            await db.SaveChangesAsync(ct);
            foreach (var d in skapade) await DokumentEndpoints.Skicka(hub, projektId, d, "skapad", av);
            foreach (var dto in filer)
                await hub.Clients.Group(ProjektHub.Grupp(projektId)).SendAsync("ListaAndrad", new ListaHandelse("filer", "skapad", dto, av.Id, av.Namn), ct);
            return Results.Ok(new { skapade = skapade.Select(DokumentEndpoints.Dto), rapport });
        }).DisableAntiforgery();

        // Texten som Word-fil, med originalfilen som mall om texten är importerad.
        g.MapGet("/{dokumentId:guid}/word", async (Guid projektId, Guid dokumentId, PvDbContext db, IFilLagring lagring, CancellationToken ct) =>
        {
            var d = await db.Dokument.AsNoTracking().FirstOrDefaultAsync(x => x.Id == dokumentId && x.ProjektId == projektId && x.Typ == "funktionstext", ct);
            if (d is null) return Results.NotFound();
            byte[] word;
            try { word = await TillWordAsync(db, lagring, projektId, d, ct); }
            catch (InvalidDataException e) { return Fel(e.Message); }
            return Results.File(word, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", FilEndpoints.RentNamn(d.Namn.EndsWith(".docx", StringComparison.OrdinalIgnoreCase) ? d.Namn : $"{d.Namn}.docx"));
        });

        return app;
    }

    /// <summary>Bygger Word-filen för en funktionstext (används också av driftkortet).</summary>
    public static async Task<byte[]> TillWordAsync(PvDbContext db, IFilLagring lagring, Guid projektId, ProjektDokument d, CancellationToken ct)
    {
        var (meta, html) = WordHtml.Dela(d.Data);
        byte[]? mall = null;
        if (Guid.TryParse(meta.Kalla, out var filId))
        {
            var fil = await db.Filer.AsNoTracking().FirstOrDefaultAsync(f => f.Id == filId && f.ProjektId == projektId, ct);
            if (fil is not null)
            {
                await using var s = await lagring.OppnaAsync(fil.BlobNamn, ct);
                if (s is not null)
                {
                    using var m = new MemoryStream();
                    await s.CopyToAsync(m, ct);
                    mall = m.ToArray();
                }
            }
        }
        return WordHtml.TillWord(html, mall);
    }

    /// <summary>"VS01 Driftkort.docx" → VS01.</summary>
    public static string? SystemIFilnamn(string filnamn)
    {
        var m = SystemRegex().Match(Path.GetFileNameWithoutExtension(filnamn));
        return m.Success ? m.Value : null;
    }

    [GeneratedRegex(@"(?<![A-ZÅÄÖ0-9])[A-ZÅÄÖ]{2,4}\d{2,3}(?![0-9])")]
    private static partial Regex SystemRegex();

    private static IResult Fel(string text) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { ["funktionstext"] = [text] });
}
