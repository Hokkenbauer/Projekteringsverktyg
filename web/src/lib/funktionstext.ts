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
 * Komponenter i ett driftkort. Texten läses i ordning:
 *  - En rad "System <tab> VS01, VP01" (tabellen Allmänt) startar ett nytt avsnitt. Delade driftkort (VS01-VV01) har
 *    ett avsnitt per system.
 *  - Hela beteckningar (VS01-P01, KB01-ME41-GT41) behålls.
 *  - Korta beteckningar (P01, SV11, GT11) får systemet från närmast föregående hela beteckning med samma namn i
 *    avsnittet (VVC01-P01 … "P01 går att styra"), annars avsnittets första system, annars textens system.
 *  - Snedstreck expanderas: VS01-P01/P02, VVC01-GT41/42, LA01-GT43/GM41.
 *  - Signalsuffix (-FAULT, -SP, -I), intervall (ST401-402) och matning (24VAC) tas bort.
 * kandaSystem = system i projektet och texterna (de räknas aldrig som komponenter).
 */
export function komponenterIDriftkort(text: string, system: string, kandaSystem: Set<string>, koder: Set<string>,
  /** Korta namn som redan finns som rumskomponenter (131_GT501): de hoppas över i typrumskort. */
  rumsnamn: Set<string> = new Set()): Kandidat[] {
  // Textens system: första riktiga systemnamnet ("VS01, VP01" → VS01; "R101-FLV01" är en komponent, inget system).
  const textSystem = systemerI(system)[0] ?? "";
  const ut = new Map<string, Kandidat>();
  let sektion: string[] = textSystem ? [textSystem] : [];
  /** Kort namn (P01, ME41-GT41) → system från senaste hela beteckning i avsnittet. */
  let senast = new Map<string, string>();
  /** Texten beskriver rumskomponenter (typrum): övriga korta beteckningar är då osäkra. */
  let rumstext = false;
  const arKandSystem = (d: string) => kandaSystem.has(d) || sektion.includes(d) || d === textSystem;
  const harKod = (d: string) => koder.has(kod(d));
  const lagg = (beteckning: string, sy: string, iTexten: string, tolkad: boolean, osaker = false) => {
    const f = ut.get(beteckning);
    if (!f) ut.set(beteckning, { beteckning, system: sy, iTexten, tolkad, osaker });
    else if (!osaker) f.osaker = false;
  };

  for (const rad of text.toUpperCase().split("\n")) {
    // Nytt avsnitt: "System <tab> VS01, VP01".
    const sysRad = /^\s*SYSTEM\s*[\t:|]\s*(.+)$/.exec(rad);
    if (sysRad) {
      const lista = systemerI(sysRad[1]!);
      if (lista.length) { sektion = lista; senast = new Map(); for (const x of sektion) kandaSystem.add(x); continue; }
    }
    const tokens = rad.match(/(?<![A-ZÅÄÖ0-9_-])[A-ZÅÄÖ]{1,5}\d{1,4}[A-ZÅÄÖ]?(?:[-_/][A-ZÅÄÖ0-9:]+)*(?![A-ZÅÄÖ0-9])/g) ?? [];
    for (const token0 of tokens) {
      // Uppräkningar skrivna med bindestreck blir snedstreck: ME42-ME43 och ST401-402 är två komponenter.
      const token = token0.replace(/([A-ZÅÄÖ]+)(\d+)-\1(\d+)(?![0-9])/g, "$1$2/$1$3").replace(/([A-ZÅÄÖ]+\d+)-(\d+)(?![0-9A-ZÅÄÖ])/g, "$1/$2");
      // Snedstreck: VS01-P01/P02-AUT → VS01-P01 och VS01-P02. VVC01-GT41/42 → GT41 och GT42.
      const bitar = token.split("/");
      let forra: string[] = [];
      for (let i = 0; i < bitar.length; i++) {
        let delar = norm(bitar[i]!).split("-").filter(Boolean);
        if (i > 0 && forra.length) {
          const sista = forra.at(-1)!;
          const forsta = delar[0] ?? "";
          if (/^\d+$/.test(forsta)) delar = [...forra.slice(0, -1), sista.replace(/\d+[A-ZÅÄÖ]?$/, forsta), ...delar.slice(1)];
          else if (harKod(forsta) && !arKandSystem(forsta)) delar = [...forra.slice(0, -1), ...delar];
        }
        // Komponentens delar: första delen ska ha bokstäver och siffror; följande delar bara om de är komponentkoder
        // (KB01-ME41-GT41), annars är det signaler, intervall eller matning.
        const komp: string[] = [];
        for (const d of delar) {
          const ren = d.replace(/:.*$/, "");
          // P0X och GT4X är platshållare, inga komponenter.
          const ok = /^[A-ZÅÄÖ]+\d/.test(ren) && !/\dX$/.test(ren) && (komp.length === 0 || harKod(ren) || (komp.length === 1 && arKandSystem(komp[0]!)));
          if (!ok) break;
          komp.push(ren);
        }
        forra = komp;
        if (!komp.length) continue;
        const forsta = komp[0]!;
        // System: känt system, eller ett namn som inte är en komponentkod följt av en komponent (KV01-GT41).
        if (SYSTEMNAMN.test(forsta) && komp.length > 1 && (arKandSystem(forsta) || (!harKod(forsta) && harKod(komp[1]!)))) {
          // Hel beteckning.
          lagg(komp.join("-"), forsta, bitar[i]!, false);
          for (let n = 1; n < komp.length; n++) senast.set(komp.slice(1, n + 1).join("-"), forsta);
          continue;
        }
        // Kort beteckning: system och okända koder hoppas över.
        if (arKandSystem(forsta) || !harKod(forsta)) continue;
        const kort = komp.filter((d, n) => n === 0 || harKod(d)).join("-");
        // Finns redan som rumskomponent (131_GT501): typrumskortets GT501 är rummens givare, inte systemets.
        if (rumsnamn.has(kort)) { rumstext = true; continue; }
        const sy = senast.get(kort) ?? sektion[0] ?? "";
        if (!sy) continue;
        lagg(`${sy}-${kort}`, sy, bitar[i]!, true, !senast.has(kort) && sektion.length > 1);
      }
    }
  }
  // Kort beteckning som också står med ett annat system i texten (GM41 och LA01-GM41) är osäker.
  const hela = [...ut.values()].filter((k) => !k.tolkad);
  for (const k of ut.values()) {
    if (!k.tolkad) continue;
    if (rumstext) { k.osaker = true; continue; }
    const kort = k.beteckning.slice(k.system.length + 1);
    if (hela.some((h) => h.system !== k.system && h.beteckning.slice(h.system.length + 1) === kort)) k.osaker = true;
  }
  return [...ut.values()].sort((a, b) => a.beteckning.localeCompare(b.beteckning, "sv", { numeric: true }));
}

/** Systemnamn i en text: VS01 och VP01 i "VS01, VP01", men inte FLV01 i "R101-FLV01" (det är en komponent). */
export function systemerI(text: string): string[] {
  return [...new Set((norm(text).match(/(?<![A-ZÅÄÖ0-9_-])[A-ZÅÄÖ]{2,4}\d{2,3}(?![0-9_-])/g) ?? []))];
}

/**
 * Korta namn på komponenter som sitter i rum (prefixet är inget system, t.ex. 131_GT501 eller TYPRUM6_PL3_R1_GT501):
 * GT501, ST401 … Typrumskort beskriver dem generellt och ska inte skapa systemkomponenter av dem.
 */
export function rumskomponenter(komponenter: { beteckning: string }[]): Set<string> {
  const s = new Set<string>();
  for (const k of komponenter) {
    const delar = norm(k.beteckning).split("-");
    if (delar.length > 1 && !SYSTEMNAMN.test(delar[0]!)) s.add(delar.at(-1)!);
  }
  return s;
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
