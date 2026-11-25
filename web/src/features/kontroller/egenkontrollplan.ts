import { hamtaBinar } from "../../lib/api";
import type { BlockDokument, TabellRad } from "../../lib/dokumentBlock";
import { handlingsdatum, handlingsstatus } from "../../lib/dokumenttema";
import { zip } from "../../lib/zip";
import { blockFiler, formatFor, handlingar, rentNamn, type Fil, type Format, type Handling, type Underlag } from "../export/handlingar";
import { valtDatum } from "../listor/ListVy";
import { forhinderDokument, hinderDokument } from "../projektering/HinderVy";

/**
 * Egenkontrollplan = Förteckning egenkontroller: en numrerad förteckning över projektets egenkontrollhandlingar
 * (01_Kontaktlista, 02_Riskanalys projektering …) med status, benämning och datum, som i HECO:s förlaga
 * (Tönsberg 5). Handlingarna själva finns i sina flikar; förteckningen sparar bara ordning, status, benämning,
 * datum och egna rader. Exporten ger en ZIP med förteckningen och de ikryssade handlingarna numrerade i samma ordning.
 * Sparas som JSON i projektets text "egenkontrollplan".
 */

export type Uppgift = { status?: string; benamning?: string; datum?: string };
export type EgenRad = { id: string; namn: string; status: string; benamning: string; datum: string };
export type PlanData = { version: 2; ordning: string[]; uppgifter: Record<string, Uppgift>; egna: EgenRad[] };

export const STATUSAR = ["AK", "GH", "BH", "RH"];

/** Standardhandlingarna i förteckningen, i standardordning. handling = id i filexportens handlingar (null = finns inte i verktyget). */
export const STANDARD: { id: string; namn: string; benamning: string; handling: string | null; flik: string; tomBlankett?: "forhinder" | "hinder" }[] = [
  { id: "kontaktlista", namn: "Kontaktlista", benamning: "Adressförteckning inklusive ICE-kontakter", handling: "lista:kontaktlista", flik: "Projektering → Stöd/Övrigt" },
  { id: "risk-projektering", namn: "Riskanalys projektering", benamning: "Riskanalys, underlag till kontrollplan", handling: "risk-projektering", flik: "Projektering → Kontroller" },
  { id: "risk-produktion", namn: "Riskanalys produktion", benamning: "Riskanalys, underlag till kontrollplan", handling: "risk-produktion", flik: "Projektering → Kontroller" },
  { id: "projekteringsegenkontroll", namn: "Projekteringsegenkontroll", benamning: "Signeras löpande under projekteringen", handling: "projekteringsegenkontroll", flik: "Projektering → Kontroller" },
  { id: "projekteringsintyg", namn: "Projekteringsintyg", benamning: "Signeras vid färdigställd projektering", handling: "projekteringsintyg", flik: "Projektering → Kontroller" },
  { id: "signaturlista", namn: "Signaturlista", benamning: "Signaturlista", handling: "lista:signaturlista", flik: "Dokumentation" },
  { id: "anmarkningar", namn: "Anmärkningsbilaga", benamning: "Beskriver gränsöverskridande anmärkningar i anläggning", handling: "lista:anmarkningar", flik: "Driftsättning" },
  { id: "installationslista", namn: "Installationslista", benamning: "Checklista installation. Signeras löpande vid färdigställda installationsmoment", handling: "lista:installationslista", flik: "Komponenter & Listor" },
  { id: "installationsintyg", namn: "Installationsintyg", benamning: "Signeras vid färdigställd installation", handling: null, flik: "Finns inte i verktyget" },
  { id: "brandfunktionsintyg", namn: "Brandfunktionsintyg", benamning: "Signeras vid färdiginstallerad och avprovad funktion", handling: null, flik: "Finns inte i verktyget" },
  { id: "egenkontroll", namn: "Egenkontroll driftsättning", benamning: "Checklista driftsättning. Signeras vid färdigställande", handling: "lista:egenkontroll", flik: "Driftsättning" },
  { id: "forhinder", namn: "Förhindersanmälan", benamning: "Används vid eventuellt förhinder", handling: "forhinder", flik: "Projektering → Stöd/Övrigt", tomBlankett: "forhinder" },
  { id: "hinder", namn: "Underrättelse om hinder", benamning: "Används vid hindersanmälan", handling: "hinder", flik: "Projektering → Stöd/Övrigt", tomBlankett: "hinder" },
  { id: "modulbelaggning", namn: "Modulbeläggning", benamning: "Signalhanteringslista, signeras", handling: "modulbelaggning", flik: "Konstruktion" },
  { id: "driftkort", namn: "Driftkort", benamning: "Funktionsbeskrivning som avsigneras", handling: "funktionstexter", flik: "Projektering → Funktionstexter" },
];

export function lasPlan(text: string | undefined): PlanData {
  const grund: PlanData = { version: 2, ordning: [], uppgifter: {}, egna: [] };
  try {
    const d = text ? JSON.parse(text) as Partial<PlanData> & { version?: number } : null;
    if (d && d.version === 2)
      return { ...grund, ...d, version: 2, uppgifter: d.uppgifter ?? {}, egna: Array.isArray(d.egna) ? d.egna : [], ordning: Array.isArray(d.ordning) ? d.ordning : [] };
    // Första versionen (skede/ansvarig/metod) läses inte vidare; dess egna rader behålls med namn.
    if (d && Array.isArray(d.egna)) return { ...grund, egna: d.egna.map((e) => ({ id: e.id, namn: e.namn, status: "", benamning: "", datum: "" })) };
  } catch { /* börja om */ }
  return grund;
}

/** En rad i förteckningen. Egna rader och handlingar som inte finns i verktyget har inget att exportera. */
export type Post = {
  id: string;
  namn: string;
  flik: string;
  /** Förslag när inget är ifyllt. */
  benamning: string;
  /** Kort upplysning om innehållet (från filexporten), t.ex. "12 rader" eller "Finns inte i verktyget". */
  info: string;
  tom: boolean;
  egen?: boolean;
  handling?: Handling;
  tomBlankett?: "forhinder" | "hinder";
};

/** Förteckningens rader i sparad ordning (nya standardhandlingar och egna rader läggs sist). */
export function poster(u: Underlag, plan: PlanData, alla: Handling[] = handlingar(u)): Post[] {
  const ut: Post[] = STANDARD.map((s) => {
    const h = s.handling ? alla.find((x) => x.id === s.handling) : undefined;
    const drift = s.id === "driftkort" ? u.filer.filter((f) => f.mapp === "Driftkort").length : 0;
    return {
      id: s.id, namn: s.namn, flik: s.flik, benamning: s.benamning, handling: h, tomBlankett: s.tomBlankett,
      info: !s.handling ? "Finns inte i verktyget – bifogas separat"
        : drift ? `${drift} driftkort i Projektfiler`
        : h ? (h.tom && s.tomBlankett ? "blank blankett" : h.info || (h.tom ? "tom" : "")) : "",
      tom: !s.handling || (!!h?.tom && !s.tomBlankett && !drift),
    };
  });
  for (const e of plan.egna) ut.push({ id: e.id, namn: e.namn, flik: "Egen rad", benamning: "", info: "Bara i förteckningen", tom: false, egen: true });
  const plats = (id: string) => { const i = plan.ordning.indexOf(id); return i < 0 ? 1000 : i; };
  return ut.map((p, i) => ({ p, i })).sort((a, b) => plats(a.p.id) - plats(b.p.id) || a.i - b.i).map((x) => x.p);
}

/** Värdet som visas: det som skrivits i förteckningen, annars förslaget (status och datum från projektets handlingsuppgifter). */
export function varde(plan: PlanData, p: Post, falt: keyof Uppgift): string {
  if (p.egen) {
    const e = plan.egna.find((x) => x.id === p.id);
    return e ? e[falt] : "";
  }
  const u = plan.uppgifter[p.id];
  if (u && falt in u) return u[falt] ?? "";
  return falt === "benamning" ? p.benamning : falt === "status" ? handlingsstatus() : handlingsdatum();
}

/** Dokumentnamnet med nummer, som i förlagan: 01_Kontaktlista. */
export const nummerNamn = (nr: number, namn: string) => `${String(nr).padStart(2, "0")}_${namn}`;

/** Förteckning egenkontroller som dokument: Dokumentnamn, Status, Benämning, Datum och tomma rader att fylla i för hand. */
export function planDokument(plan: PlanData, valda: Post[], projekt: BlockDokument["projekt"]): BlockDokument {
  const rader: TabellRad[] = valda.map((p, i) => [nummerNamn(i + 1, p.namn), varde(plan, p, "status"), varde(plan, p, "benamning"), valtDatum(varde(plan, p, "datum"))]);
  while (rader.length < 25) rader.push(["", "", "", ""]);
  return {
    titel: "Förteckning egenkontroller", kategori: "Egenkontroller", projekt,
    block: [{ typ: "tabell", kolumner: ["Dokumentnamn", "Status", "Benämning", "Datum"], bredder: [31, 9, 46, 14], centrera: [1], rader }],
  };
}

export type ExportResultat = { filer: number; byte: number; fel: string[]; utanFil: string[] };

/** Filerna för en post, med sökvägen ersatt av förteckningens nummer och namn. */
async function filerFor(u: Underlag, p: Post, nr: number, format: Format[]): Promise<Fil[]> {
  const bas = nummerNamn(nr, rentNamn(p.namn));
  // Driftkorten i Projektfiler → Driftkort är de som lämnas över; finns inga tas funktionstexterna.
  if (p.id === "driftkort") {
    const drift = u.filer.filter((f) => f.mapp === "Driftkort");
    if (drift.length)
      return Promise.all(drift.map(async (f) => ({ namn: `${bas}/${rentNamn(f.namn)}`, data: new Uint8Array(await hamtaBinar(`/api/projekt/${u.projektId}/filer/${f.id}/innehall`)) })));
  }
  if (p.tomBlankett && p.handling?.tom) {
    const d = p.tomBlankett === "forhinder" ? forhinderDokument({}, u.projekt) : hinderDokument({}, u.projekt);
    return blockFiler(d, bas, format);
  }
  if (!p.handling) return [];
  const filer = await p.handling.skapa(formatFor(p.handling, format), { avbrutet: () => false, notera: () => undefined });
  const typ = (n: string) => n.slice(n.lastIndexOf(".") + 1).toLowerCase();
  const enPerTyp = new Set(filer.map((f) => typ(f.namn))).size === filer.length;
  // En fil per format = 01_Namn.pdf. Flera (en per skåp, driftkort, hinder …) = mappen 01_Namn/ med filernas egna namn.
  return filer.map((f) => ({ namn: enPerTyp ? `${bas}.${typ(f.namn)}` : `${bas}/${f.namn.slice(f.namn.lastIndexOf("/") + 1)}`, data: f.data }));
}

/** ZIP: 00_Förteckning egenkontroller (PDF/Word) och de valda handlingarna numrerade i förteckningens ordning. */
export async function exporteraPlan(u: Underlag, plan: PlanData, valda: Post[], format: Format[],
  forlopp: (text: string) => void, avbrutet: () => boolean): Promise<ExportResultat | null> {
  const filer: Fil[] = [];
  const fel: string[] = [];
  const utanFil: string[] = [];
  for (let i = 0; i < valda.length; i++) {
    if (avbrutet()) return null;
    const p = valda[i]!;
    forlopp(`Skapar ${p.namn}…`);
    try {
      const f = await filerFor(u, p, i + 1, format);
      if (!f.length) utanFil.push(nummerNamn(i + 1, p.namn));
      filer.push(...f);
    } catch (e) { fel.push(`${p.namn}: ${(e as Error).message}`); }
    await new Promise((ok) => window.setTimeout(ok, 0));
  }
  if (avbrutet()) return null;
  forlopp("Skapar förteckningen…");
  filer.unshift(...await blockFiler(planDokument(plan, valda, u.projekt), "00_Förteckning egenkontroller", format));

  forlopp("Packar ZIP-filen…");
  const rad = "\r\n";
  const innehall = [
    `Förteckning egenkontroller – ${[u.projekt.nummer, u.projekt.namn].filter(Boolean).join(" ")}`,
    `Skapad ${new Date().toLocaleString("sv-SE")} i Projekteringsverktyget.`,
    "",
    ...(fel.length ? ["KUNDE INTE SKAPAS:", ...fel.map((t) => `  - ${t}`), ""] : []),
    ...(utanFil.length ? ["I FÖRTECKNINGEN MEN UTAN FIL (bifogas separat):", ...utanFil.map((t) => `  - ${t}`), ""] : []),
    `FILER (${filer.length}):`,
    ...filer.map((f) => `  ${f.namn}`),
  ].join(rad);
  const data = zip([...filer, { namn: "Innehåll.txt", data: `﻿${innehall}` }]);
  const blob = new Blob([data as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${rentNamn(`Egenkontroller ${u.projekt.nummer ?? ""} ${u.projekt.namn} ${new Date().toLocaleDateString("sv-SE")}`)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { filer: filer.length, byte: data.length, fel, utanFil };
}

// ---- Senaste valet i exportdialogen (per projekt och webbläsare)
export type ExportVal = { valda: string[]; format: Format[] };
const nyckel = (projektId: string) => `pv.egenkontrollplan.${projektId}`;
export function lasExportVal(projektId: string): ExportVal | null {
  try {
    const v = JSON.parse(localStorage.getItem(nyckel(projektId)) ?? "null") as ExportVal | null;
    return v && Array.isArray(v.valda) && Array.isArray(v.format) ? v : null;
  } catch { return null; }
}
export function sparaExportVal(projektId: string, v: ExportVal) {
  try { localStorage.setItem(nyckel(projektId), JSON.stringify(v)); } catch { /* bara bekvämlighet */ }
}
/** Med i förteckningen: senaste valet i exporten, annars alla rader. */
export const valdaPoster = (projektId: string, lista: Post[]) => {
  const v = lasExportVal(projektId);
  return v ? lista.filter((x) => v.valda.includes(x.id)) : lista;
};
