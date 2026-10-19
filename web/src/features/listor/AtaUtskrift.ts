import { esc, oppnaDokument, uppgift } from "../../lib/dokumenttema";
import type { Projekt } from "../../lib/typer";
import { valtDatum, type VisadRad } from "./ListVy";

const ruta = (pa: boolean) => `<span class="kr">${pa ? "☒" : "☐"}</span>`;
/** Text eller en tom rad att fylla i för hand. */
const fyll = (t: string, bredd = "38mm") => t.trim() ? `<b>${esc(t)}</b>` : `<span class="linje" style="width:${bredd}"></span>`;
const flerrad = (t: string) => esc(t).replace(/\n/g, "<br>");

const CSS = `
.ata h1{font-size:14pt;margin:0 0 2.5mm;text-transform:uppercase;letter-spacing:.2pt}
.ata h1 small{display:block;font-size:10pt;font-weight:400;text-transform:none;letter-spacing:0}
.ata table.ruta4{border-collapse:collapse;width:100%;margin-bottom:3mm}
.ata table.ruta4 td{border:1px solid #000;vertical-align:top;padding:1mm 1.8mm 1.6mm;width:50%}
.ata td small{display:block;font-size:7pt;margin-bottom:.6mm}
.ata td .v{font-size:10.5pt;min-height:5mm;white-space:pre-wrap}
.ata .stor{border:1px solid #000;padding:2.4mm 2.6mm;margin-bottom:3mm}
.ata .stor p{margin:0 0 2mm}
.ata .kr{font-size:12pt;margin-right:1.6mm;vertical-align:-1px}
.ata .rubrik{font-weight:700;margin-top:3mm}
.ata .text{min-height:17mm;white-space:normal;margin-bottom:2mm}
.ata .linje{display:inline-block;border-bottom:1px solid #000;height:4mm;vertical-align:bottom}
.ata .svar span.val{display:inline-block;margin-right:8mm}
.ata .sign td{height:10mm}
.ata-sida{break-after:page;page-break-after:always}
.ata-sida:last-child{break-after:auto;page-break-after:auto}
`;

/**
 * ÄTA-lista, styckvis: en färdig "Underrättelse – Utförande av ÄTA-arbete" per rad, i dokumenttemat.
 * Layouten följer HECO:s mall (ÄTA-004). Uppgifter som inte finns i verktyget blir tomma rader att fylla i för hand.
 */
export function ataStyckvis(rader: VisadRad[], projekt: Projekt | null) {
  const ort = uppgift("postadress").replace(/^[\d\s]+/, "").trim();
  const platschef = uppgift("ansvarig") || projekt?.ansvarig || "";
  const sidor = rader.map((r) => {
    const datum = valtDatum(r.datum);
    const svar = valtDatum(r.svarSenast);
    const kostnad = (r.kostnad ?? "").trim();
    return `<section class="ata ata-sida">
<h1>Underrättelse<small>Utförande av ÄTA-arbete</small></h1>
<table class="ruta4">
<tr><td colspan="2"><small>Underrättelse nr.</small><div class="v"><b>${esc(r.nr)}</b></div></td></tr>
<tr><td><small>Beställare</small><div class="v">${esc(projekt?.kund ?? "")}</div></td>
<td><small>Projekt</small><div class="v">${esc([projekt?.nummer, projekt?.namn].filter(Boolean).join(" "))}</div></td></tr>
<tr><td><small>Beställarens kontaktuppgifter (e-post)</small><div class="v"></div></td>
<td><small>Beställarens kontaktuppgifter (postadress)</small><div class="v"></div></td></tr>
<tr><td><small>Entreprenör</small><div class="v">${esc(uppgift("foretag"))}</div></td>
<td><small>Entreprenadform/tillämpligt standardavtal</small><div class="v"></div></td></tr>
<tr><td><small>Entreprenörens platschef</small><div class="v">${esc(platschef)}</div></td>
<td><small>Ort och datum</small><div class="v">${esc([ort, datum].filter(Boolean).join(" "))}</div></td></tr>
</table>
<div class="stor">
<p>Entreprenören underrättar härmed om följande omständighet(er) enligt kontraktet:</p>
<p>${ruta(true)}Att ÄTA-arbete måste/bör utföras/kan utföras.</p>
<p>${ruta(false)}Se bilaga (med kompletterande uppgifter om omständigheten).</p>
<p class="rubrik">Omständigheten innebär:</p>
<div class="text">${flerrad(r.kommentar ?? "")}</div>
<p class="rubrik">Förslag på åtgärd:</p>
<div class="text">${flerrad(r.atgard ?? "")}</div>
<p>Entreprenören måste ha beställarens svar/beställning senast den ${fyll(svar, "30mm")} för att inte hinder ska uppstå.</p>
<p>ÄTA-arbetet bedöms kosta ${fyll(kostnad, "30mm")}${kostnad && /kr|sek/i.test(kostnad) ? "" : ":- SEK"} exkl moms.</p>
</div>
<table class="ruta4 sign"><tr><td><small>Datum</small><div class="v">${esc(datum)}</div></td><td><small>Signatur</small><div class="v"></div></td></tr></table>
<div class="stor svar">
<p class="rubrik" style="margin-top:0">Beställarens svar:</p>
<p><span class="val">${ruta(r.bestalld === "true")}Arbetet beställs</span><span class="val">${ruta(false)}Svar lämnas i PM</span><span class="val">${ruta(false)}Anbud ska lämnas</span><span class="val">${ruta(false)}Annat</span></p>
<div class="text" style="min-height:8mm"></div>
</div>
<table class="ruta4 sign"><tr><td><small>Datum</small><div class="v"></div></td><td><small>Signatur</small><div class="v"></div></td></tr></table>
</section>`;
  });
  const titel = rader.length === 1 ? `ÄTA ${rader[0]!.nr}` : "ÄTA – underrättelser";
  oppnaDokument({ titel, kategori: "ÄTA", projekt, css: CSS, kropp: sidor.join("\n") });
}
