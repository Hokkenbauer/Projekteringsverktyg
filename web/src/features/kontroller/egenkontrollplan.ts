import { api } from "../../lib/api";
import type { Block, BlockDokument, TabellRad } from "../../lib/dokumentBlock";
import type { Anteckningar, Komponent, ListDef, ListRad, Projekt } from "../../lib/typer";
import { zip } from "../../lib/zip";
import { blockFiler, rentNamn, type Fil, type Format } from "../export/handlingar";
import { byggRader, listDokument, valtDatum } from "../listor/ListVy";
import { intygDokument } from "../projektering/ProjekteringsintygVy";
import { riskDokument } from "../risk/RiskVy";
import type { Kontroll } from "./KontrollerVy";
import { pekDokument } from "./ProjekteringsegenkontrollVy";

/**
 * Egenkontrollplanen: alla projektets egenkontroller på ett ställe, med ansvarig, skede, metod och kommentar.
 * Egenkontrollerna själva finns i sina flikar (Projekteringsegenkontroll, Riskanalyser, Projekteringsintyg,
 * Egenkontroll, Projektspecifika kontroller, Anmärkningsbilaga). Planen sparar bara sina egna uppgifter per
 * egenkontroll (nyckel = egenkontrollens id) plus egna rader för kontroller som görs utanför verktyget.
 * Sparas som JSON i projektets text "egenkontrollplan".
 */

export type Uppgift = { skede?: string; ansvarig?: string; metod?: string; kommentar?: string };
export type EgenRad = { id: string; namn: string; skede: string; ansvarig: string; metod: string; kommentar: string };
export type PlanData = { upprattadAv: string; datum: string; uppgifter: Record<string, Uppgift>; egna: EgenRad[] };

export const SKEDEN = ["Projektering", "Konstruktion", "Installation", "Driftsättning", "Slutbesiktning", "Garantitid"];

export function lasPlan(text: string | undefined): PlanData {
  const grund: PlanData = { upprattadAv: "", datum: "", uppgifter: {}, egna: [] };
  try {
    if (text) {
      const d = JSON.parse(text) as Partial<PlanData>;
      return { ...grund, ...d, uppgifter: d.uppgifter ?? {}, egna: Array.isArray(d.egna) ? d.egna : [] };
    }
  } catch { /* börja om */ }
  return grund;
}

/** Det planen behöver av projektet (en del av filexportens underlag). */
export type KontrollUnderlag = {
  projektId: string;
  projekt: Projekt;
  komponenter: Komponent[];
  defs: ListDef[];
  listor: Record<string, ListRad[]>;
  kontroller: Kontroll[];
  pek: Kontroll[];
  texter: Record<string, string | undefined>;
};

const TEXTER = ["projekteringsintyg", "risk-projektering", "risk-produktion", "egenkontrollplan"];

/** Hämtar projektets egenkontroller på nytt (fliken och exporten). */
export async function hamtaKontrollUnderlag(projektId: string): Promise<KontrollUnderlag> {
  const P = `/api/projekt/${projektId}`;
  const [projekt, komponenter, defs, kontroller, pek] = await Promise.all([
    api<Projekt>(P),
    api<Komponent[]>(`${P}/komponenter`),
    api<ListDef[]>("/api/listdefinitioner"),
    api<Kontroll[]>(`${P}/kontroller?typ=projekt`),
    api<Kontroll[]>(`${P}/kontroller?typ=projektering`),
  ]);
  const listIds = ["egenkontroll", "anmarkningar", "risk-projektering", "risk-produktion", ...[...kontroller, ...pek].map((k) => `kontroll-${k.id}`)];
  const [listor, texter] = await Promise.all([
    Promise.all(listIds.map(async (id) => [id, await api<ListRad[]>(`${P}/listor/${id}`).catch(() => [] as ListRad[])] as const)),
    Promise.all(TEXTER.map(async (n) => [n, await api<Anteckningar>(`${P}/texter/${n}`).then((t) => t.text).catch(() => undefined)] as const)),
  ]);
  return {
    projektId, projekt, komponenter, defs, kontroller: [...kontroller].sort((a, b) => a.ordning - b.ordning), pek: [...pek].sort((a, b) => a.ordning - b.ordning),
    listor: Object.fromEntries(listor), texter: Object.fromEntries(texter),
  };
}

/** En egenkontroll i planen. Egna rader har inget att exportera (skapa saknas). */
export type Post = {
  id: string;
  namn: string;
  /** Var i menyn egenkontrollen finns. */
  flik: string;
  /** Förslag när inget är ifyllt i planen. */
  skede: string;
  metod: string;
  status: string;
  klar: boolean;
  tom: boolean;
  egen?: boolean;
  skapa?: (format: Format[], sokvag: string) => Promise<Fil[]>;
};

const st = (n: number, en: string, flera: string) => `${n} ${n === 1 ? en : flera}`;
const sant = (v: string | undefined) => v === "true";
const kontrollStatus = (k: Kontroll) => (!k.antal ? "Inga kontrollpunkter" : k.klara >= k.antal ? `Klar (${st(k.antal, "punkt", "punkter")})` : `${k.klara} av ${k.antal} klara`);

/** Alla egenkontroller i projektet, i projektets arbetsordning, följt av planens egna rader. */
export function poster(u: KontrollUnderlag, plan: PlanData, medEa: boolean): Post[] {
  const ut: Post[] = [];
  const rader = (id: string) => [...(u.listor[id] ?? [])].sort((a, b) => a.ordning - b.ordning);
  const def = (id: string) => u.defs.find((d) => d.id === id);

  // ---- Projektering
  for (const k of u.pek) {
    ut.push({
      id: `pek:${k.id}`, namn: u.pek.length > 1 ? `Projekteringsegenkontroll ${k.namn}` : "Projekteringsegenkontroll",
      flik: "Projektering → Kontroller", skede: "Projektering", metod: "Checklista, signerad per punkt",
      status: kontrollStatus(k), klar: !!k.antal && k.klara >= k.antal, tom: !k.antal,
      skapa: (f, s) => blockFiler(pekDokument(k.namn, rader(`kontroll-${k.id}`), u.projekt, u.texter.projekteringsintyg, medEa), s, f),
    });
  }
  for (const variant of ["projektering", "produktion"] as const) {
    const id = `risk-${variant}`;
    const namn = variant === "projektering" ? "Riskanalys projektering" : "Riskanalys produktion";
    const n = rader(id).length;
    ut.push({
      id, namn, flik: "Projektering → Kontroller", skede: variant === "projektering" ? "Projektering" : "Installation",
      metod: "Riskanalys med åtgärder", status: n ? st(n, "risk", "risker") : "Inga risker", klar: n > 0, tom: !n && !u.texter[id],
      skapa: (f, s) => blockFiler(riskDokument(namn, variant, u.texter[id], rader(id), u.projekt), s, f),
    });
  }
  let signerat = false;
  try { signerat = !!String((JSON.parse(u.texter.projekteringsintyg || "{}") as { signatur?: string }).signatur ?? "").trim(); } catch { /* tomt */ }
  ut.push({
    id: "projekteringsintyg", namn: "Projekteringsintyg", flik: "Projektering → Kontroller", skede: "Projektering",
    metod: "Intyg signerat av projekteringsledare", status: !u.texter.projekteringsintyg ? "Inte påbörjat" : signerat ? "Signerat" : "Ej signerat",
    klar: signerat, tom: !u.texter.projekteringsintyg,
    skapa: (f, s) => {
      const egen = u.pek.map((k) => ({ namn: k.namn, rader: rader(`kontroll-${k.id}`) }));
      return blockFiler(intygDokument(u.texter.projekteringsintyg, u.projekt, egen, medEa), s, f);
    },
  });

  // ---- Driftsättning
  const ekDef = def("egenkontroll");
  if (ekDef) {
    const r = rader("egenkontroll");
    const klara = r.filter((x) => sant(x.data.kontrollerad)).length;
    ut.push({
      id: "lista:egenkontroll", namn: "Egenkontroll (komponenter)", flik: "Driftsättning", skede: "Driftsättning",
      metod: "Kontroll per komponent, signerad", status: !r.length ? "Inga kontrollpunkter" : klara >= r.length ? `Klar (${st(r.length, "komponent", "komponenter")})` : `${klara} av ${r.length} kontrollerade`,
      klar: !!r.length && klara >= r.length, tom: !r.length,
      skapa: (f, s) => blockFiler(listDokument(ekDef, byggRader(ekDef, r, u.komponenter), u.projekt), s, f),
    });
  }
  const kDef = def("kontroll");
  for (const k of u.kontroller) {
    if (!kDef) break;
    const id = `kontroll-${k.id}`;
    const d = { ...kDef, id, namn: k.namn };
    ut.push({
      id: `kontroll:${k.id}`, namn: k.namn, flik: "Driftsättning → Projektspecifika kontroller", skede: "Driftsättning",
      metod: "Checklista, signerad per punkt", status: kontrollStatus(k), klar: !!k.antal && k.klara >= k.antal, tom: !k.antal,
      skapa: (f, s) => blockFiler(listDokument(d, byggRader(d, rader(id), u.komponenter), u.projekt), s, f),
    });
  }
  const anmDef = def("anmarkningar");
  if (anmDef) {
    const r = rader("anmarkningar");
    const klara = r.filter((x) => sant(x.data.atgardad)).length;
    ut.push({
      id: "lista:anmarkningar", namn: "Anmärkningsbilaga", flik: "Driftsättning", skede: "Slutbesiktning",
      metod: "Anmärkningar åtgärdade och signerade", status: !r.length ? "Inga anmärkningar" : `${klara} av ${r.length} åtgärdade`,
      klar: klara >= r.length, tom: !r.length,
      skapa: (f, s) => blockFiler(listDokument(anmDef, byggRader(anmDef, r, u.komponenter), u.projekt), s, f),
    });
  }

  // ---- Planens egna rader (kontroller som görs utanför verktyget, t.ex. injustering eller leverantörens provning)
  for (const e of plan.egna) {
    ut.push({ id: e.id, namn: e.namn, flik: "Egen rad", skede: "", metod: "", status: "", klar: false, tom: false, egen: true });
  }
  return ut;
}

/** Värdet som visas för ett fält: det som skrivits i planen, annars förslaget. Ett tömt fält är tomt. */
export function varde(plan: PlanData, p: Post, falt: keyof Uppgift): string {
  if (p.egen) {
    const e = plan.egna.find((x) => x.id === p.id);
    return e ? e[falt] : "";
  }
  const u = plan.uppgifter[p.id];
  if (u && falt in u) return u[falt] ?? "";
  return falt === "skede" ? p.skede : falt === "metod" ? p.metod : "";
}

/**
 * Egenkontrollplanen som dokument: projektuppgifter, förteckning över de valda egenkontrollerna och rutor för
 * signatur. bilagor = filnamnet per egenkontroll som följer med som bilaga (bara i planens egen export).
 */
export function planDokument(plan: PlanData, valda: Post[], projekt: Projekt | null, bilagor?: Map<string, string>): BlockDokument {
  const medBilaga = !!bilagor;
  const kolumner = ["Nr", "Egenkontroll", "Skede", "Ansvarig", "Metod / verifikat", "Status", ...(medBilaga ? ["Bilaga"] : []), "Kommentar"];
  const bredder = medBilaga ? [4, 21, 10, 14, 18, 12, 6, 15] : [4, 22, 10, 15, 19, 13, 17];
  const rader: TabellRad[] = valda.map((p, i) => [
    String(i + 1), p.namn, varde(plan, p, "skede"), varde(plan, p, "ansvarig"), varde(plan, p, "metod"), p.status,
    ...(medBilaga ? [bilagor!.get(p.id) ?? ""] : []), varde(plan, p, "kommentar"),
  ]);
  const block: Block[] = [
    { typ: "form", bredd: 60, etikettBredd: 32, rader: [
      ["Objekt:", projekt?.namn ?? ""], ["Projektnummer:", projekt?.nummer ?? ""], ["Kund:", projekt?.kund ?? ""],
      ["Upprättad av:", plan.upprattadAv], ["Datum:", valtDatum(plan.datum)],
    ] },
    { typ: "text", kursiv: true, text: medBilaga
      ? "Egenkontrollplanen visar vilka egenkontroller som görs i projektet, i vilket skede, vem som är ansvarig och hur kontrollen dokumenteras. Egenkontrollerna bifogas som bilagor med numret i kolumnen Bilaga."
      : "Egenkontrollplanen visar vilka egenkontroller som görs i projektet, i vilket skede, vem som är ansvarig och hur kontrollen dokumenteras." },
    { typ: "tabell", kolumner, bredder, rader: rader.length ? rader : [kolumner.map(() => "")] },
    { typ: "luft", mm: 4 },
    { typ: "rutor", rader: [[{ etikett: "Ort och datum:", varde: "", hojd: 12 }, { etikett: "Signatur ansvarig:", varde: "", hojd: 12 }]] },
  ];
  return { titel: "Egenkontrollplan", kategori: "Egenkontrollplan", projekt, liggande: true, block };
}

export type ExportResultat = { filer: number; byte: number; fel: string[] };

/** ZIP: Egenkontrollplan (PDF/Word) och en fil per vald egenkontroll i mappen Bilagor. */
export async function exporteraPlan(u: KontrollUnderlag, plan: PlanData, valda: Post[], format: Format[],
  forlopp: (text: string) => void, avbrutet: () => boolean): Promise<ExportResultat | null> {
  const bilagor = new Map<string, string>();
  const filer: Fil[] = [];
  const fel: string[] = [];
  let nr = 0;
  for (const p of valda) {
    if (avbrutet()) return null;
    if (!p.skapa) continue;
    nr++;
    const namn = `Bilaga ${String(nr).padStart(2, "0")} ${rentNamn(p.namn)}`;
    forlopp(`Skapar ${p.namn}…`);
    try {
      filer.push(...await p.skapa(format, `Bilagor/${namn}`));
      bilagor.set(p.id, String(nr));
    } catch (e) {
      fel.push(`${p.namn}: ${(e as Error).message}`);
      nr--;
    }
    await new Promise((ok) => window.setTimeout(ok, 0));
  }
  if (avbrutet()) return null;
  forlopp("Skapar egenkontrollplanen…");
  const titel = rentNamn(`Egenkontrollplan ${u.projekt.nummer ?? ""} ${u.projekt.namn}`);
  filer.unshift(...await blockFiler(planDokument(plan, valda, u.projekt, bilagor), titel, format));

  forlopp("Packar ZIP-filen…");
  const rad = "\r\n";
  const innehall = [
    `Egenkontrollplan – ${[u.projekt.nummer, u.projekt.namn].filter(Boolean).join(" ")}`,
    `Skapad ${new Date().toLocaleString("sv-SE")} i Projekteringsverktyget.`,
    "",
    ...(fel.length ? ["KUNDE INTE SKAPAS:", ...fel.map((t) => `  - ${t}`), ""] : []),
    `EGENKONTROLLER I PLANEN (${valda.length}):`,
    ...valda.map((p, i) => `  ${i + 1}. ${p.namn}${bilagor.has(p.id) ? ` – bilaga ${bilagor.get(p.id)}` : p.egen ? " – görs utanför verktyget" : ""}`),
    "",
    `FILER (${filer.length}):`,
    ...filer.map((f) => `  ${f.namn}`),
  ].join(rad);
  const data = zip([...filer, { namn: "Innehåll.txt", data: `﻿${innehall}` }]);
  const blob = new Blob([data as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${rentNamn(`${titel} ${new Date().toLocaleDateString("sv-SE")}`)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { filer: filer.length, byte: data.length, fel };
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
