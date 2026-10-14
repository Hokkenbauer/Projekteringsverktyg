using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace Projekteringsverktyg.Server.FunktionstextApi;

/// <summary>
/// Funktionstexter mellan Word och verktyget.
/// Import: .docx blir enkel HTML (rubriker, stycken, punktlistor, tabeller, fet/kursiv/understruken).
/// Words egen formatering följer med i dolda attribut så att exporten ser ut som originalet:
/// data-ppr (stycke: stil, indrag, avstånd, sektionsbrytning), data-r (styckets vanliga typsnitt och storlek),
/// span data-rpr (text som avviker), data-tblpr/data-grid/data-trpr/data-tcpr (tabell, kolumnbredder, rader, celler)
/// och br data-w (sid- och spaltbrytning). Export: HTML blir brödtext i en Word-fil som använder mallens stilar,
/// sidfot och sidinställningar.
/// </summary>
public static partial class WordHtml
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private static readonly XNamespace Rel = "http://schemas.openxmlformats.org/package/2006/relationships";
    private static readonly XNamespace R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
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
            // Tomma stycken behålls: de är en del av hur dokumentet ser ut (luft, sidbrytningar).
            var html = sb.ToString();
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
            var basR = VanligRpr(e);
            var inneh = Inline(e, basR);
            r.Stycken++;

            var attr = (stil is null ? "" : $" data-stil=\"{Esc(stil)}\"")
                + (pPr is null ? "" : $" data-ppr=\"{Esc(Spara(pPr))}\"")
                + (basR.Length == 0 ? "" : $" data-r=\"{Esc(basR)}\"");
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
        var tblPr = tbl.Element(W + "tblPr");
        var stil = (string?)tblPr?.Element(W + "tblStyle")?.Attribute(W + "val");
        var grid = string.Join(",", tbl.Element(W + "tblGrid")?.Elements(W + "gridCol").Select(g => (string?)g.Attribute(W + "w") ?? "0") ?? []);
        sb.Append("<table")
            .Append(stil is null ? "" : $" data-stil=\"{Esc(stil)}\"")
            .Append(tblPr is null ? "" : $" data-tblpr=\"{Esc(Spara(tblPr))}\"")
            .Append(grid.Length == 0 ? "" : $" data-grid=\"{Esc(grid)}\"")
            .Append('>');
        foreach (var tr in tbl.Elements(W + "tr"))
        {
            var trPr = tr.Element(W + "trPr");
            sb.Append(trPr is null ? "<tr>" : $"<tr data-trpr=\"{Esc(Spara(trPr))}\">");
            foreach (var tc in tr.Elements(W + "tc"))
            {
                var tcPr = tc.Element(W + "tcPr");
                var span = (string?)tcPr?.Element(W + "gridSpan")?.Attribute(W + "val");
                sb.Append("<td")
                    .Append(span is null or "1" ? "" : $" colspan=\"{Esc(span)}\"")
                    .Append(tcPr is null ? "" : $" data-tcpr=\"{Esc(Spara(tcPr))}\"")
                    .Append('>');
                var inre = new StringBuilder();
                Block(tc.Elements(), inre, stilar, new Raknare());
                sb.Append(inre).Append("</td>");
            }
            sb.Append("</tr>");
        }
        sb.Append("</table>");
    }

    /// <summary>
    /// Texten i ett stycke med fet/kursiv/understruken, radbrytningar och sid-/spaltbrytningar.
    /// Text vars typsnitt eller storlek avviker från styckets vanliga (basR) läggs i span data-rpr.
    /// </summary>
    private static string Inline(XElement p, string basR)
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
                    case "br" when (string?)c.Attribute(W + "type") is "page" or "column": text.Append($"<br data-w=\"{(string?)c.Attribute(W + "type")}\"/>"); break;
                }
            }
            if (text.Length == 0) continue;
            var s = text.ToString();
            if (under) s = $"<u>{s}</u>";
            if (kursiv) s = $"<i>{s}</i>";
            if (fet) s = $"<b>{s}</b>";
            var egen = Teckenformat(rPr);
            if (egen != basR) s = $"<span data-rpr=\"{Esc(egen)}\">{s}</span>";
            sb.Append(s);
        }
        // Sammanhängande formatering slås ihop: "<b>a</b><b>b</b>" → "<b>ab</b>".
        var html = sb.ToString();
        string forra;
        do { forra = html; html = html.Replace("</b><b>", "").Replace("</i><i>", "").Replace("</u><u>", ""); } while (html != forra);
        return html;
    }

    /// <summary>Teckenformatet utan fet/kursiv/understruken (de blir egna taggar) och utan Words revisionsmärken.</summary>
    private static string Teckenformat(XElement? rPr)
    {
        if (rPr is null) return "";
        var k = Rensa(rPr);
        k.Elements().Where(x => x.Name.LocalName is "b" or "bCs" or "i" or "iCs" or "u").Remove();
        return k.HasElements ? Xml(k) : "";
    }

    /// <summary>Det teckenformat som flest tecken i stycket har (styckets "vanliga" typsnitt och storlek).</summary>
    private static string VanligRpr(XElement p)
    {
        var antal = new Dictionary<string, int>();
        foreach (var run in Korningar(p))
        {
            var langd = run.Elements(W + "t").Sum(t => t.Value.Length);
            if (langd == 0) continue;
            var f = Teckenformat(run.Element(W + "rPr"));
            antal[f] = antal.GetValueOrDefault(f) + langd;
        }
        if (antal.Count == 0)
            return Teckenformat(p.Element(W + "pPr")?.Element(W + "rPr"));
        return antal.OrderByDescending(x => x.Value).First().Key;
    }

    /// <summary>En kopia utan revisionsmärken (rsid, w14:paraId m.m.).</summary>
    private static XElement Rensa(XElement e)
    {
        var k = new XElement(e);
        foreach (var x in k.DescendantsAndSelf())
            x.Attributes().Where(a => a.Name.LocalName.StartsWith("rsid", StringComparison.Ordinal) || a.Name.NamespaceName == W14).Remove();
        return k;
    }

    private const string W14 = "http://schemas.microsoft.com/office/word/2010/wordml";

    /// <summary>Elementet som XML-text utan namnrymdsdeklarationer (prefixen, t.ex. w:, gäller i Word-filen).</summary>
    private static string Spara(XElement e) => Xml(Rensa(e));

    private static string Xml(XElement e) =>
        NamnrymdRegex().Replace(e.ToString(SaveOptions.DisableFormatting), "");

    [GeneratedRegex(@"\s+xmlns(:\w+)?=""[^""]*""")]
    private static partial Regex NamnrymdRegex();

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

            // Namnrymderna i mallen, så att sparad Word-formatering (w:, r:, w14: …) kan läsas tillbaka.
            var nsDekl = string.Join(" ", dok.Root!.Attributes().Where(a => a.IsNamespaceDeclaration).Select(a => a.ToString()));
            if (!nsDekl.Contains("xmlns:w=\"", StringComparison.Ordinal)) nsDekl += $" xmlns:w=\"{W.NamespaceName}\"";
            if (!nsDekl.Contains("xmlns:r=\"", StringComparison.Ordinal)) nsDekl += $" xmlns:r=\"{R.NamespaceName}\"";
            var relIds = Las(zip, "word/_rels/document.xml.rels")?.Root?.Elements(Rel + "Relationship")
                .Select(x => (string?)x.Attribute("Id")).Where(x => x is not null).ToHashSet() ?? [];
            var bygg = new Byggare(stilar, numIds, nsDekl);
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
            // Sparade sektionsbrytningar kan peka på sidhuvud/sidfot eller listor som inte finns i den här mallen.
            foreach (var x in body.Descendants().Where(x => x.Name.LocalName is "headerReference" or "footerReference").ToList())
                if (!relIds.Contains((string?)x.Attribute(R + "id"))) x.Remove();
            foreach (var x in body.Descendants(W + "numPr").ToList())
                if (!numIds.Contains((string?)x.Element(W + "numId")?.Attribute(W + "val"))) x.Remove();
            if (sectPr is not null) body.Add(sectPr);

            Skriv(zip, "word/document.xml", dok);
        }
        return minne.ToArray();
    }

    private sealed class Byggare(Dictionary<string, string> stilar, HashSet<string?> numIds, string nsDekl)
    {
        /// <summary>Sparad Word-formatering (data-ppr m.fl.) tillbaka till XML. Trasig eller tom → null.</summary>
        private XElement? Xml(string? s)
        {
            if (string.IsNullOrWhiteSpace(s)) return null;
            try { return XElement.Parse($"<x {nsDekl}>{s}</x>").Elements().FirstOrDefault() is { } e ? new XElement(e) : null; }
            catch (global::System.Xml.XmlException) { return null; }
        }

        private XElement? Xml(XElement? kalla, string attribut) => Xml((string?)kalla?.Attribute(attribut));

        /// <summary>Words krav på ordningen i w:rPr (fel ordning kan ge "filen är skadad").</summary>
        private static readonly string[] RprOrdning = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow",
            "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight",
            "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];

        private static void Ordna(XElement rPr)
        {
            var barn = rPr.Elements().ToList();
            var sorterade = barn.Select((e, i) => (e, i))
                .OrderBy(x => Array.IndexOf(RprOrdning, x.e.Name.LocalName) is var n and >= 0 ? n : 999).ThenBy(x => x.i).Select(x => x.e).ToList();
            rPr.RemoveNodes();
            foreach (var e in sorterade) rPr.Add(e);
        }

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
                    if (losText.Count > 0) { yield return Stycke(losText, null, 0, null, null); losText = []; }
                    foreach (var b in BlockElement(e)) yield return b;
                }
                else losText.Add(n);
            }
            if (losText.Any(n => n is XElement || (n is XText t && t.Value.Trim().Length > 0)))
                yield return Stycke(losText, null, 0, null, null);
        }

        private static bool ArBlock(string namn) => namn is "p" or "div" or "h1" or "h2" or "h3" or "h4" or "h5" or "h6" or "ul" or "ol" or "li" or "table" or "tbody" or "thead" or "tr";

        private IEnumerable<XElement> BlockElement(XElement e)
        {
            var namn = e.Name.LocalName;
            var stil = (string?)e.Attribute("data-stil");
            switch (namn)
            {
                case "h1" or "h2" or "h3" or "h4" or "h5" or "h6":
                    yield return Stycke(e.Nodes(), stil, Math.Min(3, namn[1] - '0'), null, e);
                    break;
                case "p":
                    yield return Stycke(e.Nodes(), stil, 0, null, e);
                    break;
                case "div":
                    if (e.Elements().Any(c => ArBlock(c.Name.LocalName))) foreach (var b in Block(e)) yield return b;
                    else yield return Stycke(e.Nodes(), stil, 0, null, e);
                    break;
                case "ul" or "ol":
                    foreach (var li in e.Elements())
                    {
                        if (li.Name.LocalName != "li") { foreach (var b in BlockElement(li)) yield return b; continue; }
                        yield return Stycke(li.Nodes().Where(x => x is not XElement c || c.Name.LocalName is not ("ul" or "ol")),
                            (string?)li.Attribute("data-stil"), 0, (string?)li.Attribute("data-num") ?? "punkt", li);
                        foreach (var under in li.Elements().Where(c => c.Name.LocalName is "ul" or "ol"))
                            foreach (var b in BlockElement(under)) yield return b;
                    }
                    break;
                case "li":
                    yield return Stycke(e.Nodes(), stil, 0, (string?)e.Attribute("data-num") ?? "punkt", e);
                    break;
                case "table":
                    yield return Tabell(e);
                    break;
                default:
                    foreach (var b in Block(e)) yield return b;
                    break;
            }
        }

        private XElement Stycke(IEnumerable<XNode> innehall, string? onskadStil, int rubrik, string? lista, XElement? kalla)
        {
            var p = new XElement(W + "p");
            var sparad = Xml(kalla, "data-ppr");
            var basR = Xml(kalla, "data-r");
            if (sparad is not null && sparad.Name == W + "pPr")
            {
                // Styckets formatering som i originalet (stil, indrag, avstånd, lista, sektionsbrytning).
                p.Add(sparad);
                foreach (var r in Korningar(innehall, false, false, false, basR)) p.Add(r);
                return p;
            }
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
            if (prefix != "") p.Add(Korning(prefix, false, false, false, basR));
            foreach (var r in Korningar(innehall, rubrik > 0 && stil is null, false, false, basR)) p.Add(r);
            return p;
        }

        private IEnumerable<XElement> Korningar(IEnumerable<XNode> noder, bool fet, bool kursiv, bool under, XElement? rPr)
        {
            foreach (var n in noder)
            {
                if (n is XText t)
                {
                    var text = Regex.Replace(t.Value, @"[\r\n\t ]+", " ");
                    if (text.Length > 0) yield return Korning(text, fet, kursiv, under, rPr);
                    continue;
                }
                if (n is not XElement e) continue;
                switch (e.Name.LocalName)
                {
                    case "br" when (string?)e.Attribute("data-w") is "page" or "column":
                        yield return new XElement(W + "r", new XElement(W + "br", new XAttribute(W + "type", (string)e.Attribute("data-w")!)));
                        break;
                    case "br": yield return new XElement(W + "r", rPr is null ? null : new XElement(rPr), new XElement(W + "br")); break;
                    case "b" or "strong": foreach (var r in Korningar(e.Nodes(), true, kursiv, under, rPr)) yield return r; break;
                    case "i" or "em": foreach (var r in Korningar(e.Nodes(), fet, true, under, rPr)) yield return r; break;
                    case "u": foreach (var r in Korningar(e.Nodes(), fet, kursiv, true, rPr)) yield return r; break;
                    case "span" when e.Attribute("data-rpr") is { } a:
                        // Text med eget typsnitt/storlek. Tomt värde = inget eget format.
                        foreach (var r in Korningar(e.Nodes(), fet, kursiv, under, a.Value.Length == 0 ? null : Xml(a.Value) ?? rPr)) yield return r;
                        break;
                    default: foreach (var r in Korningar(e.Nodes(), fet, kursiv, under, rPr)) yield return r; break;
                }
            }
        }

        private static XElement Korning(string text, bool fet, bool kursiv, bool under, XElement? bas)
        {
            var r = new XElement(W + "r");
            var rPr = bas is not null && bas.Name == W + "rPr" ? new XElement(bas) : new XElement(W + "rPr");
            if (fet) rPr.Add(new XElement(W + "b"));
            if (kursiv) rPr.Add(new XElement(W + "i"));
            if (under) rPr.Add(new XElement(W + "u", new XAttribute(W + "val", "single")));
            Ordna(rPr);
            if (rPr.HasElements) r.Add(rPr);
            r.Add(new XElement(W + "t", new XAttribute(XmlNs + "space", "preserve"), text));
            return r;
        }

        private XElement Tabell(XElement table)
        {
            var rader = table.Descendants().Where(x => x.Name.LocalName == "tr" && x.Ancestors().First(a => a.Name.LocalName == "table") == table).ToList();
            var kolumner = Math.Max(1, rader.Select(tr => tr.Elements().Where(c => c.Name.LocalName is "td" or "th")
                .Sum(c => int.TryParse((string?)c.Attribute("colspan"), out var s) ? s : 1)).DefaultIfEmpty(1).Max());
            var tbl = new XElement(W + "tbl");
            var sparadTbl = Xml(table, "data-tblpr");
            if (sparadTbl is not null && sparadTbl.Name == W + "tblPr") tbl.Add(sparadTbl);
            else
            {
                var tblPr = new XElement(W + "tblPr");
                var stil = TabellStil((string?)table.Attribute("data-stil"));
                if (stil is not null) tblPr.Add(new XElement(W + "tblStyle", new XAttribute(W + "val", stil)));
                tblPr.Add(new XElement(W + "tblW", new XAttribute(W + "w", 0), new XAttribute(W + "type", "auto")));
                if (stil is null)
                    tblPr.Add(new XElement(W + "tblBorders",
                        new[] { "top", "left", "bottom", "right", "insideH", "insideV" }.Select(k => new XElement(W + k,
                            new XAttribute(W + "val", "single"), new XAttribute(W + "sz", 4), new XAttribute(W + "space", 0), new XAttribute(W + "color", "A0A0A0")))));
                tbl.Add(tblPr);
            }
            // Kolumnbredderna som i originalet, annars lika breda.
            var bredder = ((string?)table.Attribute("data-grid") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries)
                .Select(x => int.TryParse(x, out var b) ? b : 0).ToList();
            if (bredder.Count == 0 || bredder.Any(b => b <= 0)) bredder = Enumerable.Repeat(9000 / kolumner, kolumner).ToList();
            tbl.Add(new XElement(W + "tblGrid", bredder.Select(b => new XElement(W + "gridCol", new XAttribute(W + "w", b)))));
            foreach (var tr in rader)
            {
                var wtr = new XElement(W + "tr");
                var trPr = Xml(tr, "data-trpr");
                if (trPr is not null && trPr.Name == W + "trPr") wtr.Add(trPr);
                foreach (var td in tr.Elements().Where(c => c.Name.LocalName is "td" or "th"))
                {
                    var tc = new XElement(W + "tc");
                    var sparadTc = Xml(td, "data-tcpr");
                    if (sparadTc is not null && sparadTc.Name == W + "tcPr") tc.Add(sparadTc);
                    else
                    {
                        var tcPr = new XElement(W + "tcPr");
                        if (int.TryParse((string?)td.Attribute("colspan"), out var span) && span > 1)
                            tcPr.Add(new XElement(W + "gridSpan", new XAttribute(W + "val", span)));
                        if (tcPr.HasElements) tc.Add(tcPr);
                    }
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
