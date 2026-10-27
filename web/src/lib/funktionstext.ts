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

/* ---------- Komponenter i driftkort (med systemnamn) ---------- */

/**
 * Komponentkoder som står först i en komponents beteckning (GT11, SV21, P01 …). Används för att avgöra
 * om en kort beteckning i ett driftkort är en komponent. Projektets egna koder läggs till automatiskt.
 */
export const KOMPONENTKODER = [
  "GT", "GP", "GF", "GM", "GQ", "GX", "GN", "GS", "GH", "GL", "GB", "GE", "GV",
  "SV", "ST", "SP", "SL", "P", "PU", "PV", "TF", "FF", "CF", "VVX", "SO", "ME", "MQ", "MF", "AV", "EB", "EV", "KM",
  "RC", "BV", "BT", "LS", "VA", "SB", "KA", "OS", "TK",
];

/** Gissad komponenttyp ur koden (bara ett förslag när komponenten skapas). */
export const KOMPONENTTYP_FOR_KOD: Record<string, string> = {
  GT: "Temperaturgivare", GP: "Tryckgivare", GF: "Flödesgivare", GM: "Fuktgivare", GQ: "Koncentrationsgivare", GX: "CO2-Givare",
  GN: "Närvarodetektor", SV: "Ventilställdon", ST: "Spjällställdon", P: "Pump", PU: "Pump", TF: "Fläkt", FF: "Fläkt", CF: "Fläkt",
  VVX: "Värmeväxlare", SO: "Serviceomkopplare", ME: "Mätare", MQ: "Mätare", MF: "Mätare", RC: "Rumsregulator", EB: "Elbatteri",
};

const SYSTEMNAMN = /^[A-ZÅÄÖ]{2,4}\d{2,3}$/;
const kod = (del: string) => /^([A-ZÅÄÖ]+)\d/.exec(del)?.[1] ?? "";

export type Kandidat = {
  /** Beteckningen som den blir i Komponenter, t.ex. LA01-GT11. */
  beteckning: string;
  system: string;
  /** Hur den stod i texten, t.ex. GT11 eller FF01-FAULT. */
  iTexten: string;
  /** Systemnamnet lades till från textens system (beteckningen stod utan system). */
  tolkad: boolean;
  /** Osäker: samma kod står också med ett annat system i texten (t.ex. GM41 och LA01-GM41). Inte förvald. */
  osaker?: boolean;
};

/**
 * Komponenter i ett driftkort. Driftkort skriver ofta komponenterna utan system (GT11, SV21, FF01-FAULT);
 * då läggs textens system till (LA01-GT11). Hela beteckningar (KB01-GT41, VP01-ME41) behålls.
 * Signalsuffix (-FAULT, -AUTO, -SP, -I …) och intervall (ST401-402) tas bort.
 * kandaSystem = system som finns i projektet eller i texterna (de räknas aldrig som komponenter).
 */
export function komponenterIDriftkort(text: string, system: string, kandaSystem: Set<string>, koder: Set<string>): Kandidat[] {
  const sys = norm(system);
  const ut = new Map<string, Kandidat>();
  const tokens = text.toUpperCase().match(/(?<![A-ZÅÄÖ0-9_-])[A-ZÅÄÖ]{1,5}\d{1,4}[A-ZÅÄÖ]?(?:[-_][A-ZÅÄÖ0-9:]+)*(?![A-ZÅÄÖ0-9])/g) ?? [];
  for (const t of tokens) {
    const alla = norm(t).split("-");
    // Komponentens delar: så länge delen har både bokstäver och siffror (FAULT, AUTO, 402 och I är signaler/intervall).
    const delar: string[] = [];
    // Delen ska börja med bokstav (24VAC och 230VAC är matning, inte komponenter).
    for (const d of alla) { if (/^[A-ZÅÄÖ]/.test(d) && /\d/.test(d)) delar.push(d.replace(/:.*$/, "")); else break; }
    if (!delar.length) continue;
    const forsta = delar[0]!;
    // Hel beteckning: första delen är ett system (känt, eller följt av en komponentkod som i KV01-GT41).
    const arSystem = SYSTEMNAMN.test(forsta) && delar.length > 1 && (kandaSystem.has(forsta) || koder.has(kod(delar[1]!)));
    let beteckning: string, sy: string, tolkad = false;
    if (arSystem) { beteckning = delar.slice(0, 2).join("-"); sy = forsta; }
    else {
      // Kort beteckning: bara om det är en komponentkod och textens system är känt. System och kända system hoppas över.
      if (!sys || kandaSystem.has(forsta) || forsta === sys || !koder.has(kod(forsta))) continue;
      beteckning = `${sys}-${forsta}`; sy = sys; tolkad = true;
    }
    if (!ut.has(beteckning)) ut.set(beteckning, { beteckning, system: sy, iTexten: t, tolkad });
  }
  // Kort beteckning som också står med ett annat system i texten (GM41 och LA01-GM41) är osäker.
  const medAnnatSystem = new Set([...ut.values()].filter((k) => !k.tolkad && k.system !== sys).map((k) => k.beteckning.split("-")[1]));
  for (const k of ut.values()) if (k.tolkad && medAnnatSystem.has(k.beteckning.split("-")[1])) k.osaker = true;
  return [...ut.values()].sort((a, b) => a.beteckning.localeCompare(b.beteckning, "sv", { numeric: true }));
}

/** System som projektet känner till: komponenternas system och första delen av beteckningar som LA01-GT11. */
export function kandaSystem(komponenter: { system: string; beteckning: string }[], extra: string[] = []): Set<string> {
  const s = new Set<string>();
  for (const k of komponenter) {
    if (SYSTEMNAMN.test(norm(k.system))) s.add(norm(k.system));
    const forsta = norm(k.beteckning).split("-")[0] ?? "";
    if (SYSTEMNAMN.test(forsta) && norm(k.beteckning).includes("-")) s.add(forsta);
  }
  for (const e of extra) if (SYSTEMNAMN.test(norm(e))) s.add(norm(e));
  return s;
}

/** Komponentkoder: standardlistan plus koderna i projektets beteckningar (sista delen, t.ex. GT i LA01-GT11). */
export function komponentkoder(komponenter: { beteckning: string }[]): Set<string> {
  const s = new Set(KOMPONENTKODER);
  for (const k of komponenter) {
    const delar = norm(k.beteckning).split("-");
    if (delar.length > 1) { const c = kod(delar.at(-1)!); if (c && c.length <= 4) s.add(c); }
  }
  return s;
}

/** Systemen i ett namn, t.ex. "S81-8-004 VS01-VV01.docx" → [VS01, VV01]. */
export function systemINamn(namn: string): string[] {
  return [...new Set((namn.toUpperCase().match(/(?<![A-ZÅÄÖ0-9])[A-ZÅÄÖ]{2,4}\d{2,3}(?![0-9])/g) ?? []))];
}
