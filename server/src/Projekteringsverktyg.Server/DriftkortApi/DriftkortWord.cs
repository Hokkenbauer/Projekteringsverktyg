using System.IO.Compression;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace Projekteringsverktyg.Server.DriftkortApi;

/// <summary>
/// Slår ihop flödesbilden och funktionstexten (Word) till ett driftkort.
/// Flödesbilden blir sida 1 i ett eget avsnitt med samma sidfot, kantlinjer och sidstorlek som
/// funktionstexten, men en spalt. Bilden ligger bakom texten och täcker hela sidan från hörnet,
/// så I/O-raderna hamnar på exakt samma plats som i ritbordet. Funktionstexten följer från sida 2.
/// </summary>
public static class DriftkortWord
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private static readonly XNamespace Wp = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace Ct = "http://schemas.openxmlformats.org/package/2006/content-types";
    private const string BildTyp = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

    // A4 liggande i twips (1/20 pt). 1 twip = 635 EMU.
    private const int SidaB = 16838, SidaH = 11906;

    public static byte[] Bygg(byte[] funktionstext, byte[] png, byte[]? svg)
    {
        using var minne = new MemoryStream();
        minne.Write(funktionstext);
        ZipArchive zip;
        try { zip = new ZipArchive(minne, ZipArchiveMode.Update, leaveOpen: true); }
        catch (InvalidDataException) { throw Ogiltig(); }

        using (zip)
        {
            var dokument = Las(zip, "word/document.xml") ?? throw Ogiltig();
            var relNamn = "word/_rels/document.xml.rels";
            var rels = Las(zip, relNamn) ?? new XDocument(new XElement(Rel + "Relationships"));
            var typer = Las(zip, "[Content_Types].xml") ?? throw Ogiltig();

            var body = dokument.Root?.Element(W + "body") ?? throw Ogiltig();
            var forsta = body.Descendants(W + "sectPr").FirstOrDefault() ?? throw new InvalidDataException("Word-filen saknar sidinställningar.");

            // Bilderna läggs i paketet.
            var upptagna = rels.Root!.Elements(Rel + "Relationship").Select(e => (string?)e.Attribute("Id")).ToHashSet();
            string NyttId() { var i = 1; while (upptagna.Contains($"rIdDk{i}")) i++; var id = $"rIdDk{i}"; upptagna.Add(id); return id; }
            string NyFil(string andelse)
            {
                var i = 1;
                while (zip.GetEntry($"word/media/driftkort{i}.{andelse}") is not null) i++;
                return $"driftkort{i}.{andelse}";
            }
            var pngNamn = NyFil("png");
            Skriv(zip, "word/media/" + pngNamn, png);
            var pngId = NyttId();
            rels.Root.Add(new XElement(Rel + "Relationship", new XAttribute("Id", pngId), new XAttribute("Type", BildTyp), new XAttribute("Target", "media/" + pngNamn)));
            string? svgId = null;
            if (svg is { Length: > 0 })
            {
                var svgNamn = NyFil("svg");
                Skriv(zip, "word/media/" + svgNamn, svg);
                svgId = NyttId();
                rels.Root.Add(new XElement(Rel + "Relationship", new XAttribute("Id", svgId), new XAttribute("Type", BildTyp), new XAttribute("Target", "media/" + svgNamn)));
            }
            SakerstallTyp(typer, "png", "image/png");
            if (svgId is not null) SakerstallTyp(typer, "svg", "image/svg+xml");

            // Avsnittet för sida 1: kopia av funktionstextens första avsnitt, med en spalt och sidnummer 1.
            var sida1 = new XElement(forsta);
            var pgSz = sida1.Element(W + "pgSz");
            if (pgSz is not null)
            {
                pgSz.SetAttributeValue(W + "w", SidaB);
                pgSz.SetAttributeValue(W + "h", SidaH);
                pgSz.SetAttributeValue(W + "orient", "landscape");
            }
            sida1.Element(W + "cols")?.ReplaceWith(new XElement(W + "cols", new XAttribute(W + "space", 708)));
            var nummer = sida1.Element(W + "pgNumType");
            if (nummer is not null) nummer.SetAttributeValue(W + "start", 1);
            else
            {
                var ny = new XElement(W + "pgNumType", new XAttribute(W + "start", 1));
                var fore = sida1.Elements().FirstOrDefault(e => EfterSidnummer.Contains(e.Name.LocalName));
                if (fore is not null) fore.AddBeforeSelf(ny); else sida1.Add(ny);
            }
            // Funktionstexten ska alltid börja på en ny sida.
            forsta.Element(W + "type")?.Remove();
            TaBortTommaSidorForst(body);

            var b = (long)SidaB * 635;
            var h = (long)SidaH * 635;
            var docPrId = dokument.Descendants(Wp + "docPr").Select(d => (int?)d.Attribute("id") ?? 0).DefaultIfEmpty(0).Max() + 1;
            var stycke = XElement.Parse(Stycke(pngId, svgId, b, h, docPrId));
            stycke.Element(W + "pPr")!.Add(sida1);
            body.AddFirst(stycke);

            Spara(zip, "word/document.xml", dokument);
            Spara(zip, relNamn, rels);
            Spara(zip, "[Content_Types].xml", typer);
        }
        return minne.ToArray();
    }

    /// <summary>
    /// Mallen kan börja med tomma stycken med sidbrytning (en tom sida där flödesbilden klistrades in förut).
    /// De tas bort, annars blir det en tom sida mellan flödesbilden och funktionstexten.
    /// </summary>
    internal static void TaBortTommaSidorForst(XElement body)
    {
        var tomma = new List<XElement>();
        var sistaMedBrytning = -1;
        foreach (var e in body.Elements())
        {
            if (e.Name != W + "p") break;
            var harInnehall = e.Descendants(W + "t").Any(t => t.Value.Trim() != "")
                || e.Descendants().Any(d => d.Name.LocalName is "drawing" or "pict" or "object" or "sectPr" or "tab" or "sym");
            if (harInnehall) break;
            tomma.Add(e);
            if (e.Descendants(W + "br").Any(b => (string?)b.Attribute(W + "type") == "page")
                || e.Descendants(W + "pageBreakBefore").Any(b => (string?)b.Attribute(W + "val") is null or "1" or "true" or "on"))
                sistaMedBrytning = tomma.Count - 1;
        }
        for (var i = 0; i <= sistaMedBrytning; i++) tomma[i].Remove();
    }

    // Element som ska stå efter pgNumType i sectPr (ordningen krävs av Word).
    private static readonly HashSet<string> EfterSidnummer =
        ["cols", "formProt", "vAlign", "noEndnote", "titlePg", "textDirection", "bidi", "rtlGutter", "docGrid", "printerSettings", "sectPrChange"];

    private static string Stycke(string pngId, string? svgId, long b, long h, int docPrId)
    {
        var svgDel = svgId is null ? "" :
            $$"""<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip r:embed="{{svgId}}"/></a:ext></a:extLst>""";
        return $$"""
            <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
                 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
                 xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main"><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="1" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="{{b}}" cy="{{h}}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="{{docPrId}}" name="Flödesbild"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="{{docPrId}}" name="Flödesbild"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{{pngId}}">{{svgDel}}</a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{{b}}" cy="{{h}}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>
            """;
    }

    private static InvalidDataException Ogiltig() =>
        new("Funktionstexten måste vara ett Word-dokument i formatet .docx. Spara om filen som .docx i Word och försök igen.");

    private static void SakerstallTyp(XDocument typer, string andelse, string typ)
    {
        var finns = typer.Root!.Elements(Ct + "Default")
            .Any(e => string.Equals((string?)e.Attribute("Extension"), andelse, StringComparison.OrdinalIgnoreCase));
        if (!finns) typer.Root.AddFirst(new XElement(Ct + "Default", new XAttribute("Extension", andelse), new XAttribute("ContentType", typ)));
    }

    private static XDocument? Las(ZipArchive zip, string namn)
    {
        var e = zip.GetEntry(namn);
        if (e is null) return null;
        using var s = e.Open();
        try { return XDocument.Load(s); }
        catch (XmlException) { throw Ogiltig(); }
    }

    private static void Skriv(ZipArchive zip, string namn, byte[] data)
    {
        zip.GetEntry(namn)?.Delete();
        using var s = zip.CreateEntry(namn, CompressionLevel.Optimal).Open();
        s.Write(data);
    }

    private static void Spara(ZipArchive zip, string namn, XDocument doc)
    {
        zip.GetEntry(namn)?.Delete();
        using var s = zip.CreateEntry(namn, CompressionLevel.Optimal).Open();
        using var w = XmlWriter.Create(s, new XmlWriterSettings { Encoding = new UTF8Encoding(false) });
        doc.Declaration ??= new XDeclaration("1.0", "UTF-8", "yes");
        doc.Save(w);
    }
}
