import type { Projekt } from "./typer";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Innehall =
  | { typ: "tabell"; kolumner: string[]; rader: string[][]; sammanfattning?: string }
  | { typ: "text"; text: string }
  /** Formaterad text (funktionstexter från Word). HTML:en är redan rensad. */
  | { typ: "html"; html: string };

/**
 * Öppnar en utskriftsvänlig sida med projektets sidhuvud och skriver ut den.
 * I utskriftsrutan kan man välja "Spara som PDF". Samma mall används av alla listor.
 */
export function skrivUt(titel: string, projekt: Projekt | null, innehall: Innehall) {
  const f = window.open("", "_blank");
  if (!f) {
    alert("Webbläsaren stoppade utskriftsfönstret. Tillåt popup-fönster för sidan och försök igen.");
    return;
  }
  const datum = new Date().toLocaleDateString("sv-SE");
  const huvud = [projekt?.nummer, projekt?.kund].filter(Boolean).join(" · ");
  const kropp =
    innehall.typ === "tabell"
      ? `${innehall.sammanfattning ? `<p class="samm">${esc(innehall.sammanfattning)}</p>` : ""}
         <table><thead><tr>${innehall.kolumner.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
         <tbody>${innehall.rader.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : innehall.typ === "html" ? `<div class="rik">${innehall.html}</div>`
      : `<pre>${esc(innehall.text)}</pre>`;
  const liggande = innehall.typ === "tabell" && innehall.kolumner.length > 7;

  f.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${esc(titel)} – ${esc(projekt?.namn ?? "")}</title>
<style>
  @page { size: A4 ${liggande ? "landscape" : "portrait"}; margin: 14mm 12mm 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #111; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1E3450; padding-bottom: 6px; margin-bottom: 10px; }
  header h1 { font-size: 15pt; margin: 0; color: #1E3450; }
  header .proj { text-align: right; font-size: 9pt; }
  header .proj b { display: block; font-size: 10.5pt; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #1E3450; color: #fff; text-align: left; padding: 4px 5px; font-weight: 600; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  td { border-bottom: 1px solid #ccc; padding: 4px 5px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  pre { white-space: pre-wrap; font-family: inherit; font-size: 10pt; line-height: 1.5; }
  .samm { margin: 0 0 8px; }
  .rik { font-size: 10pt; line-height: 1.45; }
  .rik h1 { font-size: 13pt; margin: 14px 0 4px; } .rik h2 { font-size: 11.5pt; margin: 12px 0 3px; } .rik h3 { font-size: 10.5pt; margin: 10px 0 2px; }
  .rik p { margin: 0 0 5px; min-height: 1em; }
  .rik table { width: auto; margin: 4px 0 8px; } .rik td { border: 1px solid #bbb; padding: 3px 6px; } .rik td p { margin: 0; }
  .rik .ftnamn { font-size: 14pt; color: #1E3450; border-bottom: 1px solid #ccc; margin-top: 18px; page-break-before: always; }
  .rik .ftnamn:first-child { page-break-before: auto; margin-top: 0; }
  footer { margin-top: 12px; font-size: 8pt; color: #666; border-top: 1px solid #ccc; padding-top: 4px; }
</style></head><body>
<header><h1>${esc(titel)}</h1><div class="proj"><b>${esc(projekt?.namn ?? "")}</b>${esc(huvud)}</div></header>
${kropp}
<footer>Utskrivet ${datum} från Projekteringsverktyg</footer>
<script>window.onload = () => { window.focus(); window.print(); };</script>
</body></html>`);
  f.document.close();
}
