import type { Projekt } from "./typer";

/**
 * Gemensamt tema för alla utskrifter och PDF:er (utom driftkort och funktionstexter): "HECO kombinerad".
 * Ritningshuvud överst på varje sida (logga, dokumentnamn, projekt, uppgiftsruta och stor statusruta),
 * tabeller med grå rubrikrad och ränder, och en fotrad med företagsuppgifter och bladnummer.
 * Uppgifterna kommer från Projektinformation (dokumenthuvud) och driftkortens sidfot (status och datum).
 */

export type DokUppgifter = {
  foretag: string; adress: string; postadress: string; epost: string; telefon: string; orgnr: string;
  ansvarig: string; revidering: string;
};

/** Används när fältet är tomt i Projektinformation. */
export const STANDARD_UPPGIFTER: DokUppgifter = {
  foretag: "HECO Automation AB", adress: "Gästgivaregatan 8", postadress: "771 53 Ludvika",
  epost: "info@hecoab.se", telefon: "", orgnr: "559393-6197", ansvarig: "", revidering: "",
};

type Aktuellt = { projekt: Projekt | null; uppgifter: Partial<DokUppgifter>; status: string; datum: string };
let aktuellt: Aktuellt = { projekt: null, uppgifter: {}, status: "", datum: "" };

/** Arbetsytan håller detta aktuellt när projektet öppnas och när någon ändrar uppgifterna. */
export function sattDokumentUppgifter(a: Partial<Aktuellt>) { aktuellt = { ...aktuellt, ...a }; }

/** Uppgift med standardvärde när den inte är ifylld i projektet. */
export function uppgift(k: keyof DokUppgifter): string {
  const v = (aktuellt.uppgifter[k] ?? "").trim();
  return v || STANDARD_UPPGIFTER[k];
}

const FORKORTNING: Record<string, string> = { ARBETSKOPIA: "AK", GRANSKNINGSHANDLING: "GH", BYGGHANDLING: "BH", RELATIONSHANDLING: "RH" };

export const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const loggaUrl = () => `${location.origin}/logga/heco-logga-svart.svg`;

/** Gemensamma klasser: table.data (grå rubrik, ränder, tr.sektion), table.form (etikett/värde), h2, .ruta, .tva. */
export const TEMA_CSS = `
body{font-family:Calibri,Carlito,"Segoe UI",Arial,sans-serif;font-size:9.5pt;color:#000;margin:0;line-height:1.3}
.pv-sida{width:100%;border-collapse:collapse}.pv-sida>thead>tr>td,.pv-sida>tbody>tr>td{padding:0;border:0;background:none}
.pv-sida>thead>tr>td{padding-bottom:4mm}
.rh{display:grid;grid-template-columns:24% 1fr 33%;border:1px solid #000}
.rh-logga{display:flex;align-items:center;justify-content:center;border-right:1px solid #000;padding:2mm}
.rh-logga img{height:8.5mm;width:auto;display:block}
.rh-mitt{display:grid;grid-template-rows:1fr 1fr;border-right:1px solid #000}
.rh-cell{padding:.8mm 1.6mm;display:flex;flex-direction:column}.rh-cell+.rh-cell{border-top:1px solid #000}
.rh-cell small{font-size:6.5pt}.rh-cell .v{font-size:11pt}
.rh-hoger{display:grid;grid-template-rows:auto 1fr}
.rh-hoger table{border-collapse:collapse;width:100%}
.rh-hoger td{border:0;border-bottom:1px solid #000;padding:.4mm 1.6mm;font-size:8.5pt;background:none!important}
.rh-hoger td+td{border-left:1px solid #000;width:45%}
.rh-status{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12pt;text-align:center;padding:1mm;text-transform:uppercase}
h2{font-size:10pt;font-weight:700;text-transform:uppercase;margin:5mm 0 1.5mm;break-after:avoid;page-break-after:avoid}
h2:first-child{margin-top:0}
h3{font-size:9.5pt;margin:3mm 0 1mm;break-after:avoid}
p{margin:0 0 1.5mm}
table.data{border-collapse:collapse;width:100%;font-size:inherit}
table.data th,table.data td{border:1px solid #000;padding:1mm 1.4mm;text-align:left;vertical-align:top}
table.data thead th{background:#BFBFBF;font-weight:700}
table.data tbody tr:nth-child(even) td{background:#F2F2F2}
table.data tr.sektion td{background:#E2E2E2!important;font-weight:700}
table.data thead{display:table-header-group}
table.data tr{break-inside:avoid;page-break-inside:avoid}
table.form th{width:42%;font-weight:400;background:#F2F2F2}
table.form tbody tr:nth-child(even) td{background:none}
.ruta{border:1px solid #000;padding:1.5mm 2mm;min-height:12mm;white-space:pre-wrap}
.tva{display:grid;grid-template-columns:1fr 1fr;gap:6mm;align-items:start}
.mitt{text-align:center}.hoger{text-align:right}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}
`;

type Sida = {
  /** Dokumentnamn i huvudet, t.ex. "Anmärkningsbilaga" eller "Apparatskåp AS01". */
  titel: string;
  /** Text i statusrutan när projektet saknar handlingsstatus, t.ex. "EGENKONTROLL". */
  kategori?: string;
  liggande?: boolean;
  /** Extra CSS för just detta dokument. */
  css?: string;
  /** Sidans innehåll (HTML). */
  kropp: string;
  projekt?: Projekt | null;
};

/** Huvud och fot som HTML/CSS (används av oppnaDokument, och kan bäddas in i egna utskrifter). */
export function temaDelar(s: Pick<Sida, "titel" | "kategori" | "liggande" | "projekt">) {
  const projekt = s.projekt ?? aktuellt.projekt;
  const status = aktuellt.status.trim();
  const datum = aktuellt.datum.trim() || new Date().toLocaleDateString("sv-SE");
  const ansvarig = uppgift("ansvarig") || projekt?.ansvarig || "";
  const fotVanster = [uppgift("foretag"), [uppgift("adress"), uppgift("postadress")].filter(Boolean).join(", "),
    uppgift("telefon"), uppgift("epost"), uppgift("orgnr") ? `orgnr ${uppgift("orgnr")}` : ""].filter(Boolean).join(" · ");
  const css = `@page{size:A4 ${s.liggande ? "landscape" : "portrait"};margin:10mm 12mm 14mm;
  @bottom-left{content:"${fotVanster.replace(/"/g, "'")}";font-family:Calibri,Carlito,Arial,sans-serif;font-size:7pt;color:#000;border-top:.6pt solid #000;vertical-align:top;padding-top:1.2mm}
  @bottom-right{content:"${esc(s.titel).replace(/"/g, "'")} · Blad " counter(page) "(" counter(pages) ")";font-family:Calibri,Carlito,Arial,sans-serif;font-size:7pt;color:#000;border-top:.6pt solid #000;vertical-align:top;padding-top:1.2mm}}
${TEMA_CSS}`;
  const huvud = `<div class="rh">
<div class="rh-logga"><img src="${loggaUrl()}" alt="${esc(uppgift("foretag"))}"></div>
<div class="rh-mitt"><div class="rh-cell"><small>Dokumentnamn:</small><span class="v">${esc(s.titel)}</span></div>
<div class="rh-cell"><small>Projekt:</small><span class="v">${esc(projekt?.namn ?? "")}</span><small>${esc([projekt?.nummer, projekt?.kund].filter(Boolean).join(" · "))}</small></div></div>
<div class="rh-hoger"><table>
<tr><td>Handling:</td><td>${esc(FORKORTNING[status] ?? status)}</td></tr>
<tr><td>Ansvarig:</td><td>${esc(ansvarig)}</td></tr>
<tr><td>Datum:</td><td>${esc(datum)}</td></tr>
<tr><td>Senast revidering:</td><td>${esc(uppgift("revidering"))}</td></tr></table>
<div class="rh-status">${esc(status || s.kategori || "")}</div></div></div>`;
  return { css, huvud };
}

/** Öppnar ett utskriftsfönster med temat och skriver ut. Returnerar false om webbläsaren stoppade fönstret. */
export function oppnaDokument(s: Sida, fonster?: Window | null): boolean {
  const f = fonster ?? window.open("", "_blank");
  if (!f) { alert("Webbläsaren stoppade utskriftsfönstret. Tillåt popup-fönster för sidan och försök igen."); return false; }
  const projekt = s.projekt ?? aktuellt.projekt;
  const { css, huvud } = temaDelar(s);
  f.document.open();
  f.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${esc(s.titel)} – ${esc(projekt?.namn ?? "")}</title>
<style>${css}${s.css ?? ""}</style></head><body>
<table class="pv-sida"><thead><tr><td>${huvud}</td></tr></thead><tbody><tr><td>
${s.kropp}
</td></tr></tbody></table>
<script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
  f.document.close();
  return true;
}

/** Tabell med temats utseende. Rader som är en sträng blir avsnittsrader. */
export function tabellHtml(kolumner: string[], rader: (string[] | string)[], bredder?: (string | undefined)[], klass = "") {
  return `<table class="data ${klass}"><thead><tr>${kolumner.map((k, i) => `<th${bredder?.[i] ? ` style="width:${bredder[i]}"` : ""}>${esc(k)}</th>`).join("")}</tr></thead>
<tbody>${rader.map((r) => typeof r === "string"
    ? `<tr class="sektion"><td colspan="${kolumner.length}">${esc(r)}</td></tr>`
    : `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

/** Etikett/värde-tabell. */
export const formHtml = (rader: [string, string][]) =>
  `<table class="data form"><tbody>${rader.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join("")}</tbody></table>`;
