/**
 * Funktionstexter kan vara ren text (äldre och från mallar) eller formaterade (importerade från Word).
 * En formaterad text börjar med en markering med metadata: <!--pv {"Kalla":"<filId>","System":"VS01"}-->
 * följt av enkel HTML (rubriker, stycken, punktlistor, tabeller, fet/kursiv/understruken).
 */
export type FtMeta = { Kalla?: string | null; System?: string | null };

const MARKERING = "<!--pv ";

export const arFormaterad = (data: string) => data.startsWith(MARKERING);

export function dela(data: string): { meta: FtMeta; html: string } {
  if (!arFormaterad(data)) return { meta: {}, html: textTillHtml(data) };
  const slut = data.indexOf("-->");
  let meta: FtMeta = {};
  try { meta = JSON.parse(data.slice(MARKERING.length, slut)) as FtMeta; } catch { /* trasig metadata */ }
  return { meta, html: data.slice(slut + 3) };
}

export const sattIhop = (meta: FtMeta, html: string) => `${MARKERING}${JSON.stringify(meta)}-->${html}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const textTillHtml = (t: string) =>
  t.replace(/\r\n/g, "\n").split("\n").map((r) => (r ? `<p>${esc(r)}</p>` : "<p></p>")).join("");

/** Texten utan formatering (för sökning, utskrift av ren text och komponenter i texten). */
export function htmlTillText(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|h[1-6]|li|tr)>/gi, "\n").replace(/<\/td>/gi, "\t");
  return (d.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Importerad med Words formatering (typsnitt, storlekar, tabellbredder) som exporten kan återskapa. */
export const harWordFormat = (data: string) => data.includes('data-ppr="&lt;w:') || data.includes("data-r=\"&lt;w:");

export const textAv = (data: string) => (arFormaterad(data) ? htmlTillText(dela(data).html) : data);

const BLOCK = new Set(["P", "H1", "H2", "H3", "UL", "OL", "LI", "TABLE", "TR", "TD", "TH"]);
/** Words egen formatering från importen ligger i dolda attribut och följer med till exporten. */
const STYCKE = ["data-stil", "data-ppr", "data-r"];
const TILLATNA_ATTR: Record<string, string[]> = {
  P: STYCKE, H1: STYCKE, H2: STYCKE, H3: STYCKE, LI: [...STYCKE, "data-num"],
  TABLE: ["data-stil", "data-tblpr", "data-grid"], TR: ["data-trpr"], TD: ["colspan", "data-tcpr"], TH: ["colspan", "data-tcpr"],
};

/**
 * Gör om editorns innehåll till ren, välformad HTML med bara de element som Word-exporten förstår.
 * Allt annat (span, font, stilattribut, inklistrat skräp) tas bort men texten behålls.
 */
export function rensa(rot: HTMLElement): string {
  const ut: string[] = [];
  const nod = (n: Node, iBlock: boolean) => {
    if (n.nodeType === Node.TEXT_NODE) { ut.push(esc((n.textContent ?? "").replace(/ /g, " "))); return; }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as HTMLElement;
    let tag = e.tagName;
    if (tag === "BR") {
      const w = e.getAttribute("data-w");
      ut.push(w === "page" || w === "column" ? `<br data-w="${w}"/>` : "<br/>");
      return;
    }
    if (tag === "STRONG") tag = "B";
    if (tag === "EM") tag = "I";
    if (tag === "DIV") tag = iBlock ? "" : "P";
    if (tag === "H4" || tag === "H5" || tag === "H6") tag = "H3";
    if (tag === "THEAD" || tag === "TBODY" || tag === "TFOOT") tag = "";
    if (tag === "TH") tag = "TD";
    // Fet/kursiv som stil (t.ex. från webbläsarens egna kommandon).
    if (tag === "SPAN" || tag === "FONT") {
      const st = e.style;
      const fet = st.fontWeight === "bold" || Number(st.fontWeight) >= 600;
      const kursiv = st.fontStyle === "italic";
      // Text med eget typsnitt/storlek från Word.
      const rpr = e.getAttribute("data-rpr");
      if (rpr !== null) ut.push(`<span data-rpr="${esc(rpr)}">`);
      if (fet) ut.push("<b>");
      if (kursiv) ut.push("<i>");
      e.childNodes.forEach((c) => nod(c, iBlock));
      if (kursiv) ut.push("</i>");
      if (fet) ut.push("</b>");
      if (rpr !== null) ut.push("</span>");
      return;
    }
    const ok = ["B", "I", "U", "P", "H1", "H2", "H3", "UL", "OL", "LI", "TABLE", "TR", "TD"].includes(tag);
    if (!ok) { e.childNodes.forEach((c) => nod(c, iBlock)); return; }
    const t = tag.toLowerCase();
    const attr = (TILLATNA_ATTR[tag] ?? []).map((a) => (e.hasAttribute(a) ? ` ${a}="${esc(e.getAttribute(a) ?? "")}"` : "")).join("");
    ut.push(`<${t}${attr}>`);
    e.childNodes.forEach((c) => nod(c, iBlock || BLOCK.has(tag)));
    ut.push(`</${t}>`);
  };
  rot.childNodes.forEach((c) => nod(c, false));
  // Lös text direkt i roten läggs i stycken.
  let html = ut.join("");
  if (!/^\s*</.test(html) && html.trim()) html = `<p>${html}</p>`;
  return html.replace(/<(b|i|u)><\/\1>/g, "").replace(/<span data-rpr="[^"]*"><\/span>/g, "")
    // Ett tomt stycke som webbläsaren fyllt med en radbrytning är fortfarande tomt (annars blir det dubbel höjd i Word).
    .replace(/<(p|h1|h2|h3|li)([^>]*)><br\/><\/\1>/g, "<$1$2></$1>");
}

/* ---------- Komponenter i texten ---------- */

const norm = (s: string) => s.trim().toUpperCase().replace(/_/g, "-");

/** Fullständiga beteckningar i texten, t.ex. VS01-P01, AS01-GT3U, VP01-ME01-GT41 (även med understreck). */
export function beteckningarIText(text: string): string[] {
  const traffar = text.toUpperCase().match(/\b[A-ZÅÄÖ]{2,4}\d{2,3}(?:[-_][A-ZÅÄÖ0-9]+)+\b/g) ?? [];
  // Signalnamn som VS01-P01-AUT eller VS01-GT11-FAULT hör till komponenten VS01-P01/VS01-GT11:
  // beteckningen tar slut vid första delen utan siffror.
  const komp = traffar.map((t) => {
    const delar = norm(t).split("-");
    const n = delar.findIndex((d) => !/\d/.test(d));
    return (n === -1 ? delar : delar.slice(0, n)).join("-");
  }).filter((t) => t.includes("-"));
  return [...new Set(komp)].sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
}

export type Traff = { beteckning: string; finns: boolean; komponentId?: string; system: string };

/** Jämför beteckningarna i texten med projektets komponenter (bindestreck och understreck räknas lika). */
export function jamfor(text: string, komponenter: { id: string; beteckning: string }[]): Traff[] {
  const perNamn = new Map(komponenter.map((k) => [norm(k.beteckning), k.id]));
  return beteckningarIText(text).map((b) => ({
    beteckning: b, finns: perNamn.has(b), komponentId: perNamn.get(b), system: b.split("-")[0] ?? "",
  }));
}
