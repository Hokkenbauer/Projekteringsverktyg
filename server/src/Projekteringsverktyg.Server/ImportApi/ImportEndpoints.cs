using System.Security.Claims;
using System.Xml;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Auth;
using Projekteringsverktyg.Server.Data;
using Projekteringsverktyg.Server.DokumentApi;
using Projekteringsverktyg.Server.ProjektApi;

namespace Projekteringsverktyg.Server.ImportApi;

/// <summary>Importerar en projektfil (.projxml) från dagens program som ett nytt projekt.</summary>
public static class ImportEndpoints
{
    public const long MaxStorlek = 100L * 1024 * 1024;

    public static IEndpointRouteBuilder MapImportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/projekt/import", async (HttpRequest request, ClaimsPrincipal user, Behorighet beh, PvDbContext db, CancellationToken ct) =>
        {
            if (!await beh.HarRoll(user, Roller.Admin, Roller.Projektledare))
                return Results.Problem(statusCode: 403, title: "Bara Admin och Projektledare kan skapa projekt.");
            if (!request.HasFormContentType) return Fel("Skicka filen som formulär.");
            var form = await request.ReadFormAsync(ct);
            var fil = form.Files.GetFile("fil");
            if (fil is null || fil.Length == 0) return Fel("Ingen fil valdes.");
            if (fil.Length > MaxStorlek) return Fel("Filen är större än 100 MB.");

            XDocument xml;
            try
            {
                await using var s = fil.OpenReadStream();
                xml = await XDocument.LoadAsync(s, LoadOptions.None, ct);
            }
            catch (XmlException) { return Fel("Filen kunde inte läsas. Välj projektfilen (.projxml) från dagens program."); }

            var av = Anvandare.Fran(user);
            var rubriker = await db.StatusRubriker.AsNoTracking().ToDictionaryAsync(r => r.Id, r => r.Namn, ct);
            var tb = await GemensamKatalogEndpoints.HamtaData(db, "tekniskbeskrivning");
            ImportResultat r;
            try { r = GammaltProjekt.Las(xml, av.Namn, rubriker, tb); }
            catch (InvalidDataException e) { return Fel(e.Message); }

            var namn = form["namn"].ToString().Trim();
            if (namn != "") r.Projekt.Namn = namn;

            db.Projekt.Add(r.Projekt);
            db.Medlemmar.Add(new ProjektMedlem { ProjektId = r.Projekt.Id, AnvandarId = (await beh.AktuellAsync(user)).Id, TillagdAv = av.Namn });
            db.Komponenter.AddRange(r.Komponenter);
            db.ListRader.AddRange(r.ListRader);
            db.Texter.AddRange(r.Texter);
            db.AttGora.AddRange(r.AttGora);
            db.Kontroller.AddRange(r.Kontroller);
            db.Skap.AddRange(r.Skap);
            db.Dokument.AddRange(r.Dokument);
            db.StatusUppgifter.AddRange(r.Status);
            db.Andringslogg.AddRange(r.Logg.OrderBy(l => l.Tidpunkt));
            Andringslogg.Logga(db, r.Projekt.Id, av, "Projekt", r.Projekt.Id, $"importerade projektet {r.Projekt.Namn} från dagens program ({fil.FileName})");
            await db.SaveChangesAsync(ct);

            return Results.Ok(new
            {
                projekt = new ProjektDto(r.Projekt.Id, r.Projekt.Namn, r.Projekt.Nummer, r.Projekt.Kund, r.Projekt.Ansvarig, r.Projekt.Skapad, r.Projekt.SkapadAv, r.Komponenter.Count),
                rapport = r.Rapport,
                varningar = r.Varningar,
            });
        }).DisableAntiforgery();
        return app;
    }

    private static IResult Fel(string text) => Results.ValidationProblem(new Dictionary<string, string[]> { ["fil"] = [text] });
}
