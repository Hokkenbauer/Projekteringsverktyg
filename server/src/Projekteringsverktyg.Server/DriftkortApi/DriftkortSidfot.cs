using System.IO.Compression;
using System.Text.Json;
using System.Xml.Linq;
using Microsoft.EntityFrameworkCore;
using Projekteringsverktyg.Server.Data;

namespace Projekteringsverktyg.Server.DriftkortApi;

/// <summary>
/// Projektets gemensamma sidfot för driftkort (status, datum, projektnummer m.m.). Värdena är en röd tråd genom
/// projektet och skrivs in i Word-filens sidfot när ett driftkort skapas eller en funktionstext exporteras.
/// Sparas som projektdokument av typen "driftkortsidfot" (JSON), så att ändringslogg och livesynk gäller som vanligt.
/// Tomt värde = behåll texten som står i Word-filen.
/// </summary>
public sealed record Sidfot(
    string? Status, string? Datum, string? Projektnummer, string? Konstruktor, string? Kontrollansvarig,
    string? Rad1, string? Rad2, string? Rad3, string?[]? Loggor = null)
{
    public bool ArTom => new[] { Status, Datum, Projektnummer, Konstruktor, Kontrollansvarig, Rad1, Rad2, Rad3 }.All(string.IsNullOrWhiteSpace)
        && (Loggor ?? []).All(string.IsNullOrWhiteSpace);
}

/// <summary>En logga i det gemensamma loggbiblioteket (katalogen "loggor"). Data är bilden i base64.</summary>
public sealed record Logga(string Id, string Namn, string Typ, int B, int H, string Data);

public static class DriftkortSidfot
{
    public const string Typ = "driftkortsidfot";

    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly XNamespace A = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private static readonly XNamespace Wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace Ct = "http://schemas.openxmlformats.org/package/2006/content-types";
    private static readonly XNamespace Mc = "http://schemas.openxmlformats.org/markup-compatibility/2006";
    private static readonly XNamespace V = "urn:schemas-microsoft-com:vml";
    private const string BildTyp = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
    public const string LoggKatalog = "loggor";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /// <summary>Handlingsstatus som känns igen i sidfoten och byts mot projektets status.</summary>
    public static readonly string[] Statusar =
        ["ARBETSKOPIA", "GRANSKNINGSHANDLING", "BYGGHANDLING", "RELATIONSHANDLING", "FÖRFRÅGNINGSUNDERLAG", "SYSTEMHANDLING", "PRELIMINÄR", "UTKAST"];

    public static Sidfot? Las(string? data)
    {
        if (string.IsNullOrWhiteSpace(data)) return null;
        try { return JsonSerializer.Deserialize<Sidfot>(data, Json); } catch (JsonException) { return null; }
    }

    public static async Task<Sidfot?> HamtaAsync(PvDbContext db, Guid projektId, CancellationToken ct)
    {
        var data = await db.Dokument.AsNoTracking().Where(d => d.ProjektId == projektId && d.Typ == Typ)
            .OrderBy(d => d.Skapad).Select(d => d.Data).FirstOrDefaultAsync(ct);
        return Las(data);
    }

    public static List<Logga> LasLoggor(string? data)
    {
        if (string.IsNullOrWhiteSpace(data)) return [];
        try { return JsonSerializer.Deserialize<List<Logga>>(data, Json) ?? []; } catch (JsonException) { return []; }
    }

    /// <summary>Projektets sidfot och loggbiblioteket, inskrivna i Word-filen.</summary>
    public static async Task<byte[]> TillampaAsync(PvDbContext db, Guid projektId, byte[] docx, CancellationToken ct)
    {
        var s = await HamtaAsync(db, projektId, ct);
        if (s is null || s.ArTom) return docx;
        var loggor = (s.Loggor ?? []).Any(x => !string.IsNullOrWhiteSpace(x))
            ? LasLoggor(await DokumentApi.GemensamKatalogEndpoints.HamtaData(db, LoggKatalog)) : [];
        return Tillampa(docx, s, loggor);
    }

    /// <summary>Skriver in sidfotens värden i alla sidfötter och sidhuvuden i Word-filen. Oförändrad fil om inget finns att göra.</summary>
    public static byte[] Tillampa(byte[] docx, Sidfot? s, IReadOnlyList<Logga>? bibliotek = null)
    {
        if (s is null || s.ArTom) return docx;
        using var minne = new MemoryStream();
        minne.Write(docx);
        minne.Position = 0;
        var nagot = false;
        try
        {
            using var zip = new ZipArchive(minne, ZipArchiveMode.Update, leaveOpen: true);
            var delar = zip.Entries.Select(e => e.FullName)
                .Where(n => n.StartsWith("word/footer", StringComparison.Ordinal) || n.StartsWith("word/header", StringComparison.Ordinal))
                .Where(n => n.EndsWith(".xml", StringComparison.Ordinal)).ToList();
            foreach (var namn in delar)
            {
                XDocument dok;
                using (var st = zip.GetEntry(namn)!.Open()) dok = XDocument.Load(st, LoadOptions.PreserveWhitespace);
                var textAndrad = Andra(dok.Root!, s);
                var bildAndrad = BytLoggor(zip, namn, dok.Root!, s, bibliotek);
                if (!textAndrad && !bildAndrad) continue;
                nagot = true;
                zip.GetEntry(namn)!.Delete();
                using var ut = zip.CreateEntry(namn, CompressionLevel.Optimal).Open();
                dok.Save(ut, SaveOptions.DisableFormatting);
            }
        }
        catch (InvalidDataException) { return docx; }
        // Zip-filen skrivs om även utan ändringar, så den ursprungliga returneras om inget ändrades.
        return nagot ? minne.ToArray() : docx;
    }

    /// <summary>Ändrar en sidfot. Returnerar true om något ändrades.</summary>
    public static bool Andra(XElement rot, Sidfot s)
    {
        var andrat = false;
        var status = s.Status?.Trim();

        // Status: ett stycke som bara innehåller en känd handlingsstatus.
        if (!string.IsNullOrEmpty(status))
            foreach (var p in rot.Descendants(W + "p"))
                if (Statusar.Contains(Text(p).Trim().ToUpperInvariant()) && Text(p).Trim() != status) { SattText(p, status); andrat = true; }

        foreach (var tr in rot.Descendants(W + "tr"))
        {
            var celler = tr.Elements(W + "tc").ToList();
            var texter = celler.Select(c => Text(c).Trim().TrimEnd(':').Trim()).ToList();
            // Revisionstabellens rubrikrad (Rev | Ändring avser | Datum | Sign) har inga värden bredvid de rubrikerna,
            // men kan dela rad med t.ex. Konstruktör.
            var revisionsrad = texter.Any(t => t.Equals("Rev", StringComparison.OrdinalIgnoreCase) || t.StartsWith("Ändring avser", StringComparison.OrdinalIgnoreCase));
            for (var i = 0; i < celler.Count; i++)
            {
                // Projektraderna står i cellen före statusen (första raden: nummer och namn, sedan adress).
                if (i > 0 && Statusar.Contains(texter[i].ToUpperInvariant()) || (!string.IsNullOrEmpty(status) && i > 0 && texter[i] == status))
                {
                    var stycken = celler[i - 1].Elements(W + "p").ToList();
                    var rader = new[] { s.Rad1, s.Rad2, s.Rad3 };
                    for (var r = 0; r < rader.Length && r < stycken.Count; r++)
                        if (!string.IsNullOrWhiteSpace(rader[r]) && Text(stycken[r]) != rader[r]!.Trim()) { SattText(stycken[r], rader[r]!.Trim()); andrat = true; }
                }
                if (i + 1 >= celler.Count) continue;
                if (revisionsrad && texter[i].ToLowerInvariant() is "datum" or "sign" or "rev") continue;
                var varde = texter[i].ToLowerInvariant() switch
                {
                    "projektnummer" or "projektnr" or "proj.nr" => s.Projektnummer,
                    "konstruktör" or "konstruktion" or "projektör" => s.Konstruktor,
                    "kontrollansvarig" or "granskad" or "granskad av" => s.Kontrollansvarig,
                    "datum" => s.Datum,
                    _ => null,
                };
                if (string.IsNullOrWhiteSpace(varde) || texter[i + 1] == varde.Trim()) continue;
                SattCell(celler[i + 1], varde.Trim());
                andrat = true;
            }
        }
        return andrat;
    }

    /// <summary>
    /// Byter bilderna i en sidfot mot valda loggor (i ordning: första bilden = Logga 1). Den nya bilden läggs i en egen
    /// fil och anpassas in i den gamla bildens ruta, så att sidfotens layout inte ändras.
    /// </summary>
    private static bool BytLoggor(ZipArchive zip, string delNamn, XElement rot, Sidfot s, IReadOnlyList<Logga>? bibliotek)
    {
        if (bibliotek is null || bibliotek.Count == 0 || s.Loggor is not { Length: > 0 } val) return false;
        var bilder = rot.Descendants(A + "blip").Where(b => b.Attribute(R + "embed") is not null).ToList();
        if (bilder.Count == 0) return false;

        var relNamn = delNamn.Replace("word/", "word/_rels/") + ".rels";
        var rels = LasXml(zip, relNamn) ?? new XDocument(new XElement(Rel + "Relationships"));
        var typer = LasXml(zip, "[Content_Types].xml");
        var andrat = false;
        for (var i = 0; i < bilder.Count && i < val.Length; i++)
        {
            var logga = bibliotek.FirstOrDefault(l => l.Id == val[i]);
            if (logga is null || logga.B <= 0 || logga.H <= 0) continue;
            byte[] data;
            try { data = Convert.FromBase64String(logga.Data); } catch (FormatException) { continue; }
            var andelse = logga.Typ.Contains("jpeg") || logga.Typ.Contains("jpg") ? "jpeg" : "png";
            var fil = $"media/pvlogga_{RentId(logga.Id)}.{andelse}";
            if (zip.GetEntry("word/" + fil) is null)
                using (var ut = zip.CreateEntry("word/" + fil, CompressionLevel.Optimal).Open()) ut.Write(data);
            var relId = $"rIdPvLogga{RentId(logga.Id)}";
            if (!rels.Root!.Elements(Rel + "Relationship").Any(r => (string?)r.Attribute("Id") == relId))
                rels.Root.Add(new XElement(Rel + "Relationship", new XAttribute("Id", relId), new XAttribute("Type", BildTyp), new XAttribute("Target", fil)));
            if (typer?.Root is { } ct && !ct.Elements(Ct + "Default").Any(d => string.Equals((string?)d.Attribute("Extension"), andelse, StringComparison.OrdinalIgnoreCase)))
                ct.AddFirst(new XElement(Ct + "Default", new XAttribute("Extension", andelse), new XAttribute("ContentType", andelse == "png" ? "image/png" : "image/jpeg")));

            var blip = bilder[i];
            if ((string?)blip.Attribute(R + "embed") == relId) continue;
            blip.SetAttributeValue(R + "embed", relId);
            blip.Element(A + "extLst")?.Remove();          // t.ex. en SVG-version av den gamla loggan
            // Samma bild i VML-reserven (äldre Word) om den finns.
            var alt = blip.Ancestors(Mc + "AlternateContent").FirstOrDefault();
            foreach (var vml in alt?.Descendants(V + "imagedata") ?? []) vml.SetAttributeValue(R + "id", relId);
            // Anpassa in i den gamla rutan med loggans proportioner.
            var ram = blip.Ancestors().FirstOrDefault(a => a.Name == Wp + "inline" || a.Name == Wp + "anchor");
            var extent = ram?.Element(Wp + "extent");
            if (extent is not null && long.TryParse((string?)extent.Attribute("cx"), out var cx0) && long.TryParse((string?)extent.Attribute("cy"), out var cy0) && cx0 > 0 && cy0 > 0)
            {
                var k = Math.Min((double)cx0 / logga.B, (double)cy0 / logga.H);
                var cx = (long)Math.Round(logga.B * k); var cy = (long)Math.Round(logga.H * k);
                extent.SetAttributeValue("cx", cx); extent.SetAttributeValue("cy", cy);
                foreach (var ext in ram!.Descendants(A + "xfrm").Elements(A + "ext")) { ext.SetAttributeValue("cx", cx); ext.SetAttributeValue("cy", cy); }
            }
            andrat = true;
        }
        if (!andrat) return false;
        SkrivXml(zip, relNamn, rels);
        if (typer is not null) SkrivXml(zip, "[Content_Types].xml", typer);
        return true;
    }

    private static string RentId(string id) => new(id.Where(char.IsLetterOrDigit).Take(24).ToArray());

    private static XDocument? LasXml(ZipArchive zip, string namn)
    {
        var e = zip.GetEntry(namn);
        if (e is null) return null;
        using var st = e.Open();
        return XDocument.Load(st, LoadOptions.PreserveWhitespace);
    }

    private static void SkrivXml(ZipArchive zip, string namn, XDocument dok)
    {
        zip.GetEntry(namn)?.Delete();
        using var ut = zip.CreateEntry(namn, CompressionLevel.Optimal).Open();
        dok.Save(ut, SaveOptions.DisableFormatting);
    }

    private static string Text(XElement e) => string.Concat(e.Descendants(W + "t").Select(t => t.Value));

    private static void SattCell(XElement tc, string text)
    {
        var stycken = tc.Elements(W + "p").ToList();
        if (stycken.Count == 0) { stycken.Add(new XElement(W + "p")); tc.Add(stycken[0]); }
        SattText(stycken[0], text);
        foreach (var p in stycken.Skip(1)) p.Descendants(W + "t").Remove();
    }

    /// <summary>Byter texten i ett stycke men behåller formatet (typsnitt, storlek) från den första textkörningen.</summary>
    private static void SattText(XElement p, string text)
    {
        var korningar = p.Descendants(W + "r").Where(r => r.Element(W + "t") is not null).ToList();
        if (korningar.Count == 0)
        {
            var markering = p.Element(W + "pPr")?.Element(W + "rPr");
            p.Add(new XElement(W + "r",
                markering is null ? null : new XElement(W + "rPr", markering.Elements().Where(e => e.Name.LocalName is not ("ins" or "del" or "moveFrom" or "moveTo"))),
                new XElement(W + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), text)));
            return;
        }
        var forsta = korningar[0];
        forsta.Elements(W + "t").Skip(1).Remove();
        var t = forsta.Element(W + "t")!;
        t.Value = text;
        t.SetAttributeValue(XNamespace.Xml + "space", "preserve");
        foreach (var r in korningar.Skip(1)) r.Elements(W + "t").Remove();
    }
}
