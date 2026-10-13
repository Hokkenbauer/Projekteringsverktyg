using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Projekteringsverktyg.Server.FunktionstextApi;

/// <summary>
/// Funktionstexter mellan Word och verktyget.
/// Import: .docx blir enkel HTML (rubriker, stycken, punktlistor, tabeller, fet/kursiv/understruken).
/// Wordstilarnas namn följer med (data-stil, data-num) så att en export med originalfilen som mall
/// ser ut som originalet. Export: HTML blir brödtext i en Word-fil som använder mallens stilar,
/// sidfot och sidinställningar.
/// </summary>
public static partial class WordHtml
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace XmlNs = XNamespace.Xml;

    /// <summary>Markering först i en funktionstext som är formaterad (HTML). Äldre texter är ren text.</summary>
    public const string Markering = "<!--pv ";

    public sealed record Meta(string? Kalla, string? System);

    public static string MedMeta(string html, Meta meta) =>
        Markering + global::System.Text.Json.JsonSerializer.Serialize(meta) + "-->" + html;

    /// <summary>Delar upp sparad text i metadata och HTML. Ren text blir stycken.</summary>
    public static (Meta Meta, string Html) Dela(string data)
    {
        if (data.StartsWith(Markering, StringComparison.Ordinal))
        {
            var slut = data.IndexOf("-->", StringComparison.Ordinal);
            if (slut > 0)
            {
                Meta? meta = null;
                try { meta = global::System.Text.Json.JsonSerializer.Deserialize<Meta>(data[Markering.Length..slut]); } catch { /* trasig metadata */ }
                return (meta ?? new Meta(null, null), data[(slut + 3)..]);
            }
        }
        var stycken = data.Replace("\r\n", "\n").Split('\n').Select(r => r.Length == 0 ? "<p></p>" : $"<p>{Esc(r)}</p>");
        return (new Meta(null, null), string.Concat(stycken));
    }

    // ================= Import: Word → HTML =================

    public sealed record Import(string Html, string? System, int Stycken, int Tabeller);

    public static Import TillHtml(byte[] docx)
    {
        using var minne = new MemoryStream(docx);
        ZipArchive zip;
        try { zip = new ZipArchive(minne, ZipArchiveMode.Read); }
        catch (InvalidDataException) { throw new InvalidDataException("Filen är inte en Word-fil (.docx)."); }
        using (zip)
        {
            var dok = Las(zip, "word/document.xml") ?? throw new InvalidDataException("Filen är inte en Word-fil (.docx).");
            var stilar = StilNamn(Las(zip, "word/styles.xml"));
            var body = dok.Root?.Element(W + "body") ?? throw new InvalidDataException("Word-filen saknar innehåll.");
            var sb = new StringBuilder();
            var raknare = new Raknare();
            Block(body.Elements(), sb, stilar, raknare);
            var html = Regex.Replace(sb.ToString(), "(<p[^>]*></p>){2,}", m => Regex.Match(m.Value, "<p[^>]*></p>").Value);
            html = Regex.Replace(html, "^(<p[^>]*></p>)+|(<p[^>]*></p>)+$", "");
            return new Import(html, HittaSystem(body), raknare.Stycken, raknare.Tabeller);
        }
    }

    private sealed class Raknare { public int Stycken; public int Tabeller; }

    private static void Block(IEnumerable<XElement> element, StringBuilder sb, Dictionary<string, string> stilar, Raknare r)
    {
        var iLista = false;
        foreach (var e in element)
        {
            var namn = e.Name.LocalName;
            if (namn == "sdt") { Avsluta(); Block(e.Element(W + "sdtContent")?.Elements() ?? [], sb, stilar, r); continue; }
            if (namn == "tbl") { Avsluta(); Tabell(e, sb, stilar, r); continue; }
            if (namn != "p") continue;

            var pPr = e.Element(W + "pPr");
            var stil = (string?)pPr?.Element(W + "pStyle")?.Attribute(W + "val");
            var numPr = pPr?.Element(W + "numPr");
            var inneh = Inline(e);
            var bara = e.Descendants(W + "br").Any(b => (string?)b.Attribute(W + "type") == "page") && inneh.Trim().Length == 0;
            if (bara) continue;
            r.Stycken++;

            var attr = stil is null ? "" : $" data-stil=\"{Esc(stil)}\"";
            var niva = RubrikNiva(stil, stilar, pPr);
            if (numPr is not null && niva == 0)
            {
                var numId = (string?)numPr.Element(W + "numId")?.Attribute(W + "val");
                var ilvl = (string?)numPr.Element(W + "ilvl")?.Attribute(W + "val") ?? "0";
                if (numId is not null && numId != "0")
                {
                    if (!iLista) { sb.Append("<ul>"); iLista = true; }
                    sb.Append($"<li{attr} data-num=\"{Esc(numId)}:{Esc(ilvl)}\">{inneh}</li>");
                    continue;
                }
            }
            Avsluta();
            if (niva > 0) sb.Append($"<h{niva}{attr}>{inneh}</h{niva}>");
            else sb.Append($"<p{attr}>{inneh}</p>");
        }
        Avsluta();

        void Avsluta()
        {
            if (iLista) { sb.Append("</ul>"); iLista = false; }
        }
    }

    private static void Tabell(XElement tbl, StringBuilder sb, Dictionary<string, string> stilar, Raknare r)
    {
        r.Tabeller++;
        var stil = (string?)tbl.Element(W + "tblPr")?.Element(W + "tblStyle")?.Attribute(W + "val");
        sb.Append(stil is null ? "<table>" : $"<table data-stil=\"{Esc(stil)}\">");
        foreach (var tr in tbl.Elements(W + "tr"))
        {
            sb.Append("<tr>");
            foreach (var tc in tr.Elements(W + "tc"))
            {
                var span = (string?)tc.Element(W + "tcPr")?.Element(W + "gridSpan")?.Attribute(W + "val");
                sb.Append(span is null or "1" ? "<td>" : $"<td colspan=\"{Esc(span)}\">");
                var inre = new StringBuilder();
                Block(tc.Elements(), inre, stilar, new Raknare());
                sb.Append(inre).Append("</td>");
            }
            sb.Append("</tr>");
        }
        sb.Append("</table>");
    }

    /// <summary>Texten i ett stycke med fet/kursiv/understruken och radbrytningar.</summary>
    private static string Inline(XElement p)
    {
        var sb = new StringBuilder();
        foreach (var run in Korningar(p))
        {
            var rPr = run.Element(W + "rPr");
            var fet = Pa(rPr?.Element(W + "b"));
            var kursiv = Pa(rPr?.Element(W + "i"));
            var under = rPr?.Element(W + "u") is { } u && (string?)u.Attribute(W + "val") is not ("none" or "0");
            var text = new StringBuilder();
            foreach (var c in run.Elements())
            {
                switch (c.Name.LocalName)
                {
                    case "t": text.Append(Esc(c.Value)); break;
                    case "tab": text.Append(' '); break;
                    case "noBreakHyphen": text.Append('-'); break;
                    case "br" when (string?)c.Attribute(W + "type") is null or "textWrapping": text.Append("<br/>"); break;
                }
            }
            if (text.Length == 0) continue;
            var s = text.ToString();
            if (under) s = $"<u>{s}</u>";
            if (kursiv) s = $"<i>{s}</i>";
            if (fet) s = $"<b>{s}</b>";
            sb.Append(s);
        }
        // Sammanhängande formatering slås ihop: "<b>a</b><b>b</b>" → "<b>ab</b>".
        var html = sb.ToString();
        string forra;
        do { forra = html; html = html.Replace("</b><b>", "").Replace("</i><i>", "").Replace("</u><u>", ""); } while (html != forra);
        return html;
    }

    /// <summary>Körningarna i ett stycke, även i länkar och spårade infogningar. Borttaget och textrutor hoppas över.</summary>
    private static IEnumerable<XElement> Korningar(XElement e)
    {
        foreach (var c in e.Elements())
        {
            var n = c.Name.LocalName;
            if (n == "r")
            {
                if (c.Descendants(W + "txbxContent").Any()) continue;
                yield return c;
            }
            else if (n is "hyperlink" or "ins" or "smartTag" or "fldSimple" or "customXml") foreach (var r in Korningar(c)) yield return r;
            else if (n == "sdt") foreach (var r in Korningar(c.Element(W + "sdtContent") ?? new XElement("x"))) yield return r;
        }
    }

    private static bool Pa(XElement? e) => e is not null && (string?)e.Attribute(W + "val") is null or "1" or "true" or "on";

    private static int RubrikNiva(string? stil, Dictionary<string, string> stilar, XElement? pPr)
    {
        var namn = stil is not null && stilar.TryGetValue(stil, out var n) ? n : stil ?? "";
        var m = RubrikRegex().Match(namn);
        if (m.Success) return Math.Min(3, int.Parse(m.Groups[1].Value));
        if (stil is not null && (namn.Equals("Title", StringComparison.OrdinalIgnoreCase) || namn.Equals("Rubrik", StringComparison.OrdinalIgnoreCase))) return 1;
        var outline = (string?)pPr?.Element(W + "outlineLvl")?.Attribute(W + "val");
        return int.TryParse(outline, out var o) && o < 9 ? Math.Min(3, o + 1) : 0;
    }

    [GeneratedRegex(@"^(?:heading|rubrik)\s*(\d)$", RegexOptions.IgnoreCase)]
    private static partial Regex RubrikRegex();

    private static Dictionary<string, string> StilNamn(XDocument? styles)
    {
        var d = new Dictionary<string, string>();
        foreach (var s in styles?.Root?.Elements(W + "style") ?? [])
        {
            var id = (string?)s.Attribute(W + "styleId");
            var namn = (string?)s.Element(W + "name")?.Attribute(W + "val");
            if (id is not null && namn is not null) d[id] = namn;
        }
        return d;
    }

    /// <summary>Systemet ur tabellraden "System | VS01", annars ur texten "System VS01".</summary>
    public static string? HittaSystem(XElement body)
    {
        foreach (var tr in body.Descendants(W + "tr"))
        {
            var celler = tr.Elements(W + "tc").Select(Text).ToList();
            for (var i = 0; i + 1 < celler.Count; i++)
                if (celler[i].Trim().Equals("System", StringComparison.OrdinalIgnoreCase) && celler[i + 1].Trim() is { Length: > 0 } s)
                    return s;
        }
        var m = SystemRegex().Match(Text(body));
        return m.Success ? m.Groups[1].Value : null;
    }

    [GeneratedRegex(@"System\s*:?\s*([A-ZÅÄÖ]{2,4}\d{2,3})")]
    private static partial Regex SystemRegex();

    private static string Text(XElement e) => string.Concat(e.Descendants(W + "t").Select(t => t.Value));

    // ================= Export: HTML → Word =================

    /// <summary>
    /// Bygger en Word-fil av texten. Mallen (t.ex. den importerade originalfilen) ger stilar, sidfot och
    /// sidinställningar; dess brödtext byts ut. Utan mall används en enkel standardmall.
    /// </summary>
    public static byte[] TillWord(string html, byte[]? mall)
    {
        using var minne = new MemoryStream();
        minne.Write(mall ?? Standardmall());
        minne.Position = 0;
        ZipArchive zip;
        try { zip = new ZipArchive(minne, ZipArchiveMode.Update, leaveOpen: true); }
        catch (InvalidDataException) { throw new InvalidDataException("Mallen är inte en Word-fil (.docx)."); }
        using (zip)
        {
            var dok = Las(zip, "word/document.xml") ?? throw new InvalidDataException("Mallen saknar innehåll.");
            var body = dok.Root?.Element(W + "body") ?? throw new InvalidDataException("Mallen saknar innehåll.");
            var stilar = StilNamn(Las(zip, "word/styles.xml"));
            var numrering = Las(zip, "word/numbering.xml");
            var numIds = numrering?.Root?.Elements(W + "num").Select(n => (string?)n.Attribute(W + "numId")).Where(x => x is not null).ToHashSet() ?? [];

            var sista = body.Elements(W + "sectPr").LastOrDefault() ?? body.Descendants(W + "sectPr").LastOrDefault();
            var sectPr = sista is null ? null : new XElement(sista);
            body.RemoveNodes();

            var bygg = new Byggare(stilar, numIds);
            XElement rot;
            try { rot = XElement.Parse($"<rot>{html}</rot>", LoadOptions.PreserveWhitespace); }
            catch (global::System.Xml.XmlException)
            {
                // Trasig HTML: ta texten som stycken hellre än att misslyckas.
                var ren = Regex.Replace(Regex.Replace(html, "<(br|/p|/h[1-6]|/li|/tr)[^>]*>", "\n"), "<[^>]+>", "");
                rot = new XElement("rot", WebUtility.HtmlDecode(ren).Split('\n').Select(r => new XElement("p", r)));
            }
            foreach (var b in bygg.Block(rot)) body.Add(b);
            if (!body.Elements().Any()) body.Add(new XElement(W + "p"));
            if (sectPr is not null) body.Add(sectPr);

            Skriv(zip, "word/document.xml", dok);
        }
        return minne.ToArray();
    }

    private sealed class Byggare(Dictionary<string, string> stilar, HashSet<string?> numIds)
    {
        private string? StilFor(string? onskad, int rubrik)
        {
            if (onskad is not null && stilar.ContainsKey(onskad)) return onskad;
            if (rubrik > 0)
                return stilar.Where(s => RubrikRegex().Match(s.Value) is { Success: true } m && m.Groups[1].Value == rubrik.ToString()).Select(s => (string?)s.Key).FirstOrDefault();
            return null;
        }

        private string? TabellStil(string? onskad)
        {
            if (onskad is not null && stilar.ContainsKey(onskad)) return onskad;
            return stilar.Where(s => s.Value.Equals("Table Grid", StringComparison.OrdinalIgnoreCase)).Select(s => (string?)s.Key).FirstOrDefault();
        }

        public IEnumerable<XElement> Block(XElement forald)
        {
            var losText = new List<XNode>();
            foreach (var n in forald.Nodes())
            {
                if (n is XElement e && ArBlock(e.Name.LocalName))
                {
                    if (losText.Count > 0) { yield return Stycke(losText, null, 0, null); losText = []; }
                    foreach (var b in BlockElement(e)) yield return b;
                }
                else losText.Add(n);
            }
            if (losText.Any(n => n is XElement || (n is XText t && t.Value.Trim().Length > 0)))
                yield return Stycke(losText, null, 0, null);
        }

        private static bool ArBlock(string namn) => namn is "p" or "div" or "h1" or "h2" or "h3" or "h4" or "h5" or "h6" or "ul" or "ol" or "li" or "table" or "tbody" or "thead" or "tr";

        private IEnumerable<XElement> BlockElement(XElement e)
        {
            var namn = e.Name.LocalName;
            var stil = (string?)e.Attribute("data-stil");
            switch (namn)
            {
                case "h1" or "h2" or "h3" or "h4" or "h5" or "h6":
                    yield return Stycke(e.Nodes(), stil, Math.Min(3, namn[1] - '0'), null);
                    break;
                case "p":
                    yield return Stycke(e.Nodes(), stil, 0, null);
                    break;
                case "div":
                    if (e.Elements().Any(c => ArBlock(c.Name.LocalName))) foreach (var b in Block(e)) yield return b;
                    else yield return Stycke(e.Nodes(), stil, 0, null);
                    break;
                case "ul" or "ol":
                    foreach (var li in e.Elements())
                    {
                        if (li.Name.LocalName != "li") { foreach (var b in BlockElement(li)) yield return b; continue; }
                        yield return Stycke(li.Nodes().Where(x => x is not XElement c || c.Name.LocalName is not ("ul" or "ol")),
                            (string?)li.Attribute("data-stil"), 0, (string?)li.Attribute("data-num") ?? "punkt");
                        foreach (var under in li.Elements().Where(c => c.Name.LocalName is "ul" or "ol"))
                            foreach (var b in BlockElement(under)) yield return b;
                    }
                    break;
                case "li":
                    yield return Stycke(e.Nodes(), stil, 0, (string?)e.Attribute("data-num") ?? "punkt");
                    break;
                case "table":
                    yield return Tabell(e);
                    break;
                default:
                    foreach (var b in Block(e)) yield return b;
                    break;
            }
        }

        private XElement Stycke(IEnumerable<XNode> innehall, string? onskadStil, int rubrik, string? lista)
        {
            var p = new XElement(W + "p");
            var pPr = new XElement(W + "pPr");
            var stil = StilFor(onskadStil, rubrik);
            if (stil is not null) pPr.Add(new XElement(W + "pStyle", new XAttribute(W + "val", stil)));
            var prefix = "";
            if (lista is not null)
            {
                var delar = lista.Split(':');
                if (delar.Length == 2 && numIds.Contains(delar[0]))
                    pPr.Add(new XElement(W + "numPr",
                        new XElement(W + "ilvl", new XAttribute(W + "val", delar[1])),
                        new XElement(W + "numId", new XAttribute(W + "val", delar[0]))));
                else
                {
                    prefix = "– ";
                    pPr.Add(new XElement(W + "ind", new XAttribute(W + "left", 360), new XAttribute(W + "hanging", 240)));
                }
            }
            if (rubrik > 0 && stil is null)
                pPr.Add(new XElement(W + "spacing", new XAttribute(W + "before", 240), new XAttribute(W + "after", 60)));
            if (pPr.HasElements) p.Add(pPr);
            if (prefix != "") p.Add(Korning(prefix, false, false, false));
            foreach (var r in Korningar(innehall, rubrik > 0 && stil is null, false, false)) p.Add(r);
            return p;
        }

        private static IEnumerable<XElement> Korningar(IEnumerable<XNode> noder, bool fet, bool kursiv, bool under)
        {
            foreach (var n in noder)
            {
                if (n is XText t)
                {
                    var text = Regex.Replace(t.Value, @"[\r\n\t ]+", " ");
                    if (text.Length > 0) yield return Korning(text, fet, kursiv, under);
                    continue;
                }
                if (n is not XElement e) continue;
                switch (e.Name.LocalName)
                {
                    case "br": yield return new XElement(W + "r", new XElement(W + "br")); break;
                    case "b" or "strong": foreach (var r in Korningar(e.Nodes(), true, kursiv, under)) yield return r; break;
                    case "i" or "em": foreach (var r in Korningar(e.Nodes(), fet, true, under)) yield return r; break;
                    case "u": foreach (var r in Korningar(e.Nodes(), fet, kursiv, true)) yield return r; break;
                    default: foreach (var r in Korningar(e.Nodes(), fet, kursiv, under)) yield return r; break;
                }
            }
        }

        private static XElement Korning(string text, bool fet, bool kursiv, bool under)
        {
            var r = new XElement(W + "r");
            if (fet || kursiv || under)
            {
                var rPr = new XElement(W + "rPr");
                if (fet) rPr.Add(new XElement(W + "b"));
                if (kursiv) rPr.Add(new XElement(W + "i"));
                if (under) rPr.Add(new XElement(W + "u", new XAttribute(W + "val", "single")));
                r.Add(rPr);
            }
            r.Add(new XElement(W + "t", new XAttribute(XmlNs + "space", "preserve"), text));
            return r;
        }

        private XElement Tabell(XElement table)
        {
            var rader = table.Descendants().Where(x => x.Name.LocalName == "tr" && x.Ancestors().First(a => a.Name.LocalName == "table") == table).ToList();
            var kolumner = Math.Max(1, rader.Select(tr => tr.Elements().Where(c => c.Name.LocalName is "td" or "th")
                .Sum(c => int.TryParse((string?)c.Attribute("colspan"), out var s) ? s : 1)).DefaultIfEmpty(1).Max());
            var tbl = new XElement(W + "tbl");
            var tblPr = new XElement(W + "tblPr");
            var stil = TabellStil((string?)table.Attribute("data-stil"));
            if (stil is not null) tblPr.Add(new XElement(W + "tblStyle", new XAttribute(W + "val", stil)));
            tblPr.Add(new XElement(W + "tblW", new XAttribute(W + "w", 0), new XAttribute(W + "type", "auto")));
            if (stil is null)
                tblPr.Add(new XElement(W + "tblBorders",
                    new[] { "top", "left", "bottom", "right", "insideH", "insideV" }.Select(k => new XElement(W + k,
                        new XAttribute(W + "val", "single"), new XAttribute(W + "sz", 4), new XAttribute(W + "space", 0), new XAttribute(W + "color", "A0A0A0")))));
            tbl.Add(tblPr);
            tbl.Add(new XElement(W + "tblGrid", Enumerable.Range(0, kolumner).Select(_ => new XElement(W + "gridCol", new XAttribute(W + "w", 9000 / kolumner)))));
            foreach (var tr in rader)
            {
                var wtr = new XElement(W + "tr");
                foreach (var td in tr.Elements().Where(c => c.Name.LocalName is "td" or "th"))
                {
                    var tc = new XElement(W + "tc");
                    var tcPr = new XElement(W + "tcPr");
                    if (int.TryParse((string?)td.Attribute("colspan"), out var span) && span > 1)
                        tcPr.Add(new XElement(W + "gridSpan", new XAttribute(W + "val", span)));
                    if (tcPr.HasElements) tc.Add(tcPr);
                    var stycken = Block(td).ToList();
                    if (stycken.Count == 0 || stycken[^1].Name.LocalName != "p") stycken.Add(new XElement(W + "p"));
                    foreach (var s in stycken) tc.Add(s);
                    wtr.Add(tc);
                }
                tbl.Add(wtr);
            }
            return tbl;
        }
    }

    // ================= Standardmall =================

    /// <summary>En enkel Word-fil (A4, Calibri, rubrikstilar, sidnummer i sidfoten) för texter utan egen mall.</summary>
    public static byte[] Standardmall()
    {
        using var minne = new MemoryStream();
        using (var zip = new ZipArchive(minne, ZipArchiveMode.Create, leaveOpen: true))
        {
            void Lagg(string namn, string innehall)
            {
                var e = zip.CreateEntry(namn);
                using var s = new StreamWriter(e.Open(), new UTF8Encoding(false));
                s.Write(innehall);
            }
            const string w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
            const string r = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
            Lagg("[Content_Types].xml", """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                <Default Extension="xml" ContentType="application/xml"/>
                <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
                <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
                <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
                </Types>
                """);
            Lagg("_rels/.rels", """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
                </Relationships>
                """);
            Lagg("word/_rels/document.xml.rels", """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
                <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
                </Relationships>
                """);
            Lagg("word/document.xml", $"""
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <w:document xmlns:w="{w}" xmlns:r="{r}"><w:body><w:p/>
                <w:sectPr><w:footerReference w:type="default" r:id="rId2"/><w:pgSz w:w="11906" w:h="16838"/>
                <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="567" w:footer="567" w:gutter="0"/><w:cols w:space="708"/></w:sectPr>
                </w:body></w:document>
                """);
            Lagg("word/footer1.xml", $"""
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <w:ftr xmlns:w="{w}"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>
                <w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
                <w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>
                """);
            string Rubrik(int n, int storlek) => $"""
                <w:style w:type="paragraph" w:styleId="Heading{n}"><w:name w:val="heading {n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
                <w:pPr><w:keepNext/><w:spacing w:before="{(n == 1 ? 360 : 240)}" w:after="80"/><w:outlineLvl w:val="{n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="{storlek}"/></w:rPr></w:style>
                """;
            Lagg("word/styles.xml", $"""
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <w:styles xmlns:w="{w}">
                <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="sv-SE"/></w:rPr></w:rPrDefault>
                <w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
                <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
                {Rubrik(1, 30)}{Rubrik(2, 25)}{Rubrik(3, 22)}
                <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>
                <w:top w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/>
                <w:bottom w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/>
                <w:insideH w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A0A0A0"/>
                </w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
                </w:styles>
                """);
        }
        return minne.ToArray();
    }

    // ================= Hjälp =================

    private static string Esc(string s) => s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;");

    private static XDocument? Las(ZipArchive zip, string namn)
    {
        var e = zip.GetEntry(namn);
        if (e is null) return null;
        using var s = e.Open();
        return XDocument.Load(s, LoadOptions.PreserveWhitespace);
    }

    private static void Skriv(ZipArchive zip, string namn, XDocument dok)
    {
        zip.GetEntry(namn)?.Delete();
        var e = zip.CreateEntry(namn, CompressionLevel.Optimal);
        using var s = e.Open();
        dok.Save(s, SaveOptions.DisableFormatting);
    }
}
