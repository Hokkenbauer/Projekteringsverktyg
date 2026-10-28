import { uppgift } from "../../lib/dokumenttema";
import { skrivUtBlock, type Block, type BlockDokument } from "../../lib/dokumentBlock";
import type { Projekt } from "../../lib/typer";
import { valtDatum, type VisadRad } from "./ListVy";

const kryss = (pa: boolean) => (pa ? "☒" : "☐");
const lucka = "______________";

/** Blocken i en "Underrättelse – Utförande av ÄTA-arbete" (en ÄTA-rad). */
function ataBlock(r: VisadRad, projekt: Projekt | null): Block[] {
  const ort = uppgift("postadress").replace(/^[\d\s]+/, "").trim();
  const platschef = uppgift("ansvarig") || projekt?.ansvarig || "";
  const datum = valtDatum(r.datum);
  const svar = valtDatum(r.svarSenast);
  const kostnad = (r.kostnad ?? "").trim();
  return [
    { typ: "text", text: "UNDERRÄTTELSE – Utförande av ÄTA-arbete", fet: true },
    { typ: "rutor", rader: [
      [{ etikett: "Underrättelse nr.", varde: r.nr ?? "" }],
      [{ etikett: "Beställare", varde: projekt?.kund ?? "" }, { etikett: "Projekt", varde: [projekt?.nummer, projekt?.namn].filter(Boolean).join(" ") }],
      [{ etikett: "Beställarens kontaktuppgifter (e-post)", hojd: 11 }, { etikett: "Beställarens kontaktuppgifter (postadress)", hojd: 11 }],
      [{ etikett: "Entreprenör", varde: uppgift("foretag") }, { etikett: "Entreprenadform/tillämpligt standardavtal", hojd: 11 }],
      [{ etikett: "Entreprenörens platschef", varde: platschef }, { etikett: "Ort och datum", varde: [ort, datum].filter(Boolean).join(" ") }],
    ] },
    { typ: "luft", mm: 3 },
    { typ: "rutor", rader: [[{
      etikett: "Entreprenören underrättar härmed om följande omständighet(er) enligt kontraktet:",
      varde: `${kryss(true)} Att ÄTA-arbete måste/bör utföras/kan utföras.\n${kryss(false)} Se bilaga (med kompletterande uppgifter om omständigheten).`,
    }], [
      { etikett: "Omständigheten innebär:", varde: r.kommentar ?? "", hojd: 24 },
    ], [
      { etikett: "Förslag på åtgärd:", varde: r.atgard ?? "", hojd: 24 },
    ], [{
      varde: `Entreprenören måste ha beställarens svar/beställning senast den ${svar || lucka} för att inte hinder ska uppstå.\n`
        + `ÄTA-arbetet bedöms kosta ${kostnad || lucka}${kostnad && /kr|sek/i.test(kostnad) ? "" : ":- SEK"} exkl moms.`,
    }], [
      { etikett: "Datum", varde: datum, bredd: 40, hojd: 12 }, { etikett: "Signatur" },
    ]] },
    { typ: "luft", mm: 3 },
    { typ: "rutor", rader: [[{
      etikett: "Beställarens svar:",
      varde: `${kryss(r.bestalld === "true")} Arbetet beställs     ${kryss(false)} Svar lämnas i PM     ${kryss(false)} Anbud ska lämnas     ${kryss(false)} Annat`,
      hojd: 20,
    }], [
      { etikett: "Datum", bredd: 40, hojd: 12 }, { etikett: "Signatur" },
    ]] },
  ];
}

/** En ÄTA-underrättelse som eget dokument (filexporten gör en fil per ÄTA). */
export function ataDokument(r: VisadRad, projekt: Projekt | null): BlockDokument {
  return { titel: `ÄTA ${r.nr ?? ""}`.trim(), kategori: "ÄTA", projekt, block: ataBlock(r, projekt) };
}

/**
 * ÄTA-lista, styckvis: en färdig "Underrättelse – Utförande av ÄTA-arbete" per rad, i dokumenttemat.
 * Layouten följer HECO:s mall (ÄTA-004). Uppgifter som inte finns i verktyget blir tomma rutor att fylla i för hand.
 */
export function ataStyckvis(rader: VisadRad[], projekt: Projekt | null) {
  const titel = rader.length === 1 ? `ÄTA ${rader[0]!.nr}` : "ÄTA – underrättelser";
  skrivUtBlock({ titel, kategori: "ÄTA", projekt, block: rader.flatMap((r, i) => [...(i ? [{ typ: "sidbrytning" as const }] : []), ...ataBlock(r, projekt)]) });
}
