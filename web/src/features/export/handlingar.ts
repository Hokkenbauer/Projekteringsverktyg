import { api, hamtaBinar } from "../../lib/api";
import { byggWord, type BlockDokument } from "../../lib/dokumentBlock";
import { huvudUppgifter } from "../../lib/dokumenttema";
import { excelData, type Blad } from "../../lib/excelFil";
import { dela } from "../../lib/funktionstext";
import { Anslutningar, arGateway, installning, lasGateway, portNamn, protokoll } from "../../lib/gateway";
import { loggaFor, pdfAv } from "../../lib/pdfBlock";
import type { Anteckningar, Komponent, ListDef, ListRad, Projekt, ProjektDokument, ProjektFil, Skap } from "../../lib/typer";
import { utskriftDokument } from "../../lib/utskrift";
import { kommentarDokument, lasKommentarer } from "../att-gora/KommentarerVy";
import { apparatskapDokument } from "../konstruktion/ApparatskapVy";
import { bestallningBlad, bestallningDokument, bestallningsRader } from "../konstruktion/BestallningslistaVy";
import { lasModuler, modulDokument } from "../konstruktion/ModulbelaggningVy";
import type { Kontroll } from "../kontroller/KontrollerVy";
import { pekDokument, pekMedEa } from "../kontroller/ProjekteringsegenkontrollVy";
import { ataDokument } from "../listor/AtaUtskrift";
import { byggRader, listDokument } from "../listor/ListVy";
import { signallistaDokument } from "../listor/SignallistaVy";
import { forhinderDokument, hinderDokument } from "../projektering/HinderVy";
import { intygDokument } from "../projektering/ProjekteringsintygVy";
import { tekniskBlad, tekniskDokument, type TekniskKatalog } from "../projektering/TekniskBeskrivningVy";
import { riskDokument } from "../risk/RiskVy";
import { antalPlan, placeringsritningarPdf, ritbordPdf, type RitbordBild } from "./ritningar";

/**
 * Filexporten: alla utskrivbara handlingar i projektet, var och en som egen fil i valda format (PDF, Word, Excel).
 * Varje handling vet vilka format den finns i och bygger sina filer ur projektets data (hämtad på nytt vid exporten).
 * Service ingår inte (beslut). Anslutningsinformation ingår aldrig (lösenord).
 */

export type Format = "pdf" | "word" | "excel";
export const FORMAT: { id: Format; namn: string; filtyp: string }[] = [
  { id: "pdf", namn: "PDF", filtyp: "pdf" },
  { id: "word", namn: "Word", filtyp: "docx" },
  { id: "excel", namn: "Excel", filtyp: "xlsx" },
];

export type Fil = { namn: string; data: Uint8Array | string };

export type Handling = {
  /** Fast id, så att valet kan kommas ihåg. */
  id: string;
  /** Mapp i ZIP-filen (samma grupper som menyn). */
  mapp: string;
  namn: string;
  format: Format[];
  /** Kort upplysning i listan, t.ex. "3 skåp – en fil per skåp" eller "tom". */
  info: string;
  tom: boolean;
  /** Valt från början första gången (Ändringsloggen är inte en handling man lämnar över). */
  standard?: boolean;
  skapa: (format: Format[], ctx: Ctx) => Promise<Fil[]>;
};

/** Under exporten: avbrott och anteckningar till Innehåll.txt. */
export type Ctx = { avbrutet: () => boolean; notera: (t: string) => void };

type BildInfo = RitbordBild & { ordning: number };

/** Projektets data som handlingarna byggs av. Hämtas när dialogen öppnas och igen när exporten startar. */
export type Underlag = {
  projektId: string;
  projekt: Projekt;
  komponenter: Komponent[];
  defs: ListDef[];
  listor: Record<string, ListRad[]>;
  skap: Skap[];
  kontroller: Kontroll[];
  pek: Kontroll[];
  texter: Record<string, string | undefined>;
  funktionstexter: ProjektDokument[];
  filer: ProjektFil[];
  ritbord: BildInfo[];
  ritning: string | null;
  teknisk: TekniskKatalog;
};

const MAPP = {
  projekt: "01 Projekt",
  listor: "02 Komponenter och listor",
  konstruktion: "03 Konstruktion",
  driftsattning: "04 Driftsättning",
  projektering: "05 Projektering",
  kontroller: "05 Projektering/Kontroller",
  miljo: "05 Projektering/Miljö",
  krav: "05 Projektering/Kravställningar",
  stod: "05 Projektering/Stöd och övrigt",
  dokumentation: "06 Dokumentation",
};

/** Listor i listmotorn som blir egna handlingar, i menyns ordning. */
const LISTOR: [string, keyof typeof MAPP][] = [
  ["skyltlista", "listor"], ["installationslista", "listor"], ["brandspjall", "listor"],
  ["modbus", "konstruktion"],
  ["egenkontroll", "driftsattning"], ["anmarkningar", "driftsattning"], ["iplista", "driftsattning"], ["matplan", "driftsattning"],
  ["byggvarubedomning", "miljo"], ["sundahus", "miljo"],
  ["kravstallning", "krav"],
  ["kalkylmangder", "stod"], ["ata", "stod"],
  ["signaturlista", "dokumentation"], ["anlaggningsinstallningar", "dokumentation"],
];

const TEXTER = ["projektinformation", "risk-projektering", "risk-produktion", "teknisk-beskrivning", "projekteringsintyg"];

export async function hamtaUnderlag(projektId: string): Promise<Underlag> {
  const P = `/api/projekt/${projektId}`;
  const [projekt, komponenter, defs, skap, kontroller, pek, funktionstexter, filer, ritbord, ritning, teknisk] = await Promise.all([
    api<Projekt>(P),
    api<Komponent[]>(`${P}/komponenter`),
    api<ListDef[]>("/api/listdefinitioner"),
    api<Skap[]>(`${P}/skap`),
    api<Kontroll[]>(`${P}/kontroller?typ=projekt`),
    api<Kontroll[]>(`${P}/kontroller?typ=projektering`),
    api<ProjektDokument[]>(`${P}/dokument?typ=funktionstext`),
    api<{ filer: ProjektFil[] }>(`${P}/filer`).then((s) => s.filer).catch(() => [] as ProjektFil[]),
    api<BildInfo[]>(`${P}/ritbord`).catch(() => [] as BildInfo[]),
    api<{ data: string | null }>(`${P}/ritning`).then((r) => r.data).catch(() => null),
    api<{ data: string }>("/api/katalog/tekniskbeskrivning").then((k) => {
      try { return { kategorier: [], ...JSON.parse(k.data || "{}") } as TekniskKatalog; } catch { return { kategorier: [] } as TekniskKatalog; }
    }).catch(() => ({ kategorier: [] }) as TekniskKatalog),
  ]);
  const listIds = [...LISTOR.map(([id]) => id), "modbusrtu", "forhinder", "hinder", "risk-projektering", "risk-produktion",
    ...skap.map((s) => `kraft-${s.id}`), ...[...kontroller, ...pek].map((k) => `kontroll-${k.id}`)];
  const [listor, texter] = await Promise.all([
    Promise.all(listIds.map(async (id) => [id, await api<ListRad[]>(`${P}/listor/${id}`).catch(() => [] as ListRad[])] as const)),
    Promise.all(TEXTER.map(async (n) => [n, await api<Anteckningar>(`${P}/texter/${n}`).then((t) => t.text).catch(() => undefined)] as const)),
  ]);
  return {
    projektId, projekt, komponenter, defs, skap, kontroller, pek, funktionstexter, filer, ritning, teknisk,
    ritbord: [...ritbord].sort((a, b) => a.ordning - b.ordning),
    listor: Object.fromEntries(listor), texter: Object.fromEntries(texter),
  };
}

// ---------------------------------------------------------------- Hjälp

/** Filnamn utan tecken som Windows inte tillåter. */
export const rentNamn = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Namnlös";

const ext = (f: Format) => FORMAT.find((x) => x.id === f)!.filtyp;

/** PDF och/eller Word av ett blockdokument. */
async function blockFiler(d: BlockDokument, sokvag: string, format: Format[]): Promise<Fil[]> {
  const ut: Fil[] = [];
  if (format.includes("pdf")) ut.push({ namn: `${sokvag}.pdf`, data: await pdfAv(d) });
  if (format.includes("word")) {
    const h = huvudUppgifter(d);
    ut.push({ namn: `${sokvag}.docx`, data: byggWord(d, h, await loggaFor(h.loggaUrl)) });
  }
  return ut;
}

const binar = async (url: string) => new Uint8Array(await hamtaBinar(url));
const st = (n: number, en: string, flera: string) => `${n} ${n === 1 ? en : flera}`;
const sorteraKomponenter = (k: Komponent[]) => [...k].sort((a, b) => a.system.localeCompare(b.system, "sv") || a.beteckning.localeCompare(b.beteckning, "sv", { numeric: true }));

function komponentDokument(u: Underlag): BlockDokument {
  return utskriftDokument("Komponentlista", u.projekt, {
    typ: "tabell",
    kolumner: ["Nr", "Beteckning", "System", "Komponenttyp", "Beskrivning", "Placering", "I/O", "Produkt", "Ansluts till"],
    bredder: [4, 13, 7, 12, 22, 12, 9, 11, 10],
    rader: sorteraKomponenter(u.komponenter).map((k, i) => [String(i + 1), k.beteckning, k.system, k.komponenttyp, k.beskrivning, k.placering,
      k.signaltyp, (k.produkttyp || k.produkt).trim(), k.anslutsTill]),
  }, { liggande: true });
}

/** Gateways med portar, inställning och antal Modbus-enheter per port. */
function gatewayTabell(u: Underlag) {
  const a = new Anslutningar(u.komponenter);
  const perPort = new Map<string, number>();
  for (const k of u.komponenter) {
    if (!protokoll(k).includes("RTU")) continue;
    const p = a.kedja(k).port;
    if (p) perPort.set(p.namn.toLowerCase(), (perPort.get(p.namn.toLowerCase()) ?? 0) + 1);
  }
  const kolumner = ["Gateway", "Typ", "IP-adress", "Ansluts till", "Port", "TCP-port", "Inställning", "Antal enheter"];
  const rader = sorteraKomponenter(u.komponenter.filter(arGateway)).flatMap((g) => {
    const inst = lasGateway(g);
    return inst.portar.map((p, i) => [i ? "" : g.beteckning, i ? "" : inst.typ, i ? "" : inst.ip, i ? "" : g.anslutsTill,
      portNamn(g, p), p.tcpPort, installning(p), String(perPort.get(portNamn(g, p).toLowerCase()) ?? 0)]);
  });
  return { kolumner, rader };
}

// ---------------------------------------------------------------- Handlingarna

export function handlingar(u: Underlag): Handling[] {
  const ut: Handling[] = [];
  const P = `/api/projekt/${u.projektId}`;
  const def = (id: string) => u.defs.find((d) => d.id === id);
  const rader = (id: string) => u.listor[id] ?? [];

  /** En lista i listmotorn: PDF/Word av utskriften, Excel från servern. */
  const lista = (id: string, mapp: string, namn?: string, d0?: ListDef, efter?: string): Handling | null => {
    const d = d0 ?? def(id);
    if (!d) return null;
    const visade = byggRader(d, rader(id), u.komponenter);
    const titel = namn ?? d.namn;
    return {
      id: `lista:${id}`, mapp, namn: titel, format: ["pdf", "word", "excel"], tom: !visade.length,
      info: visade.length ? st(visade.length, "rad", "rader") : "tom",
      skapa: async (format) => [
        ...await blockFiler(listDokument(d, visade, u.projekt, { efter }), `${mapp}/${rentNamn(titel)}`, format),
        ...format.includes("excel") ? [{ namn: `${mapp}/${rentNamn(titel)}.xlsx`, data: await binar(`${P}/listor/${id}/excel`) }] : [],
      ],
    };
  };
  const lagg = (h: Handling | null) => { if (h) ut.push(h); };

  // ---- Projekt
  ut.push({
    id: "projektinformation", mapp: MAPP.projekt, namn: "Projektinformation", format: ["pdf", "word"],
    tom: !(u.texter.projektinformation ?? "").trim(), info: (u.texter.projektinformation ?? "").trim() ? "" : "tom",
    skapa: (f) => blockFiler(utskriftDokument("Projektinformation", u.projekt, { typ: "text", text: u.texter.projektinformation ?? "" }), `${MAPP.projekt}/Projektinformation`, f),
  });
  const kommentarer = lasKommentarer(u.ritning).rader;
  ut.push({
    id: "placeringskommentarer", mapp: MAPP.projekt, namn: "Placeringskommentarer", format: ["pdf", "word", "excel"],
    tom: !kommentarer.length, info: kommentarer.length ? st(kommentarer.length, "kommentar", "kommentarer") : "tom",
    skapa: async (f) => [
      ...await blockFiler(kommentarDokument(kommentarer, u.projekt), `${MAPP.projekt}/Placeringskommentarer`, f),
      ...f.includes("excel") ? [{ namn: `${MAPP.projekt}/Placeringskommentarer.xlsx`, data: await excelData([{
        namn: "Placeringskommentarer", bredder: [6, 18, 60, 16, 16, 18, 10],
        rader: [["Nr", "Kategori", "Kommentar", "Byggnad", "Plan", "Rum", "Avslutad"],
          ...kommentarer.map((r, i) => [i + 1, r.kategori, r.text, r.byggnad, r.plan, r.rum, r.avslutad === "true" ? "Ja" : ""])],
      }]) }] : [],
    ],
  });
  ut.push({
    id: "andringslogg", mapp: MAPP.projekt, namn: "Ändringslogg", format: ["excel"], tom: false, info: "hela loggen", standard: false,
    skapa: async () => [{ namn: `${MAPP.projekt}/Ändringslogg.xlsx`, data: await binar(`${P}/andringslogg/excel`) }],
  });

  // ---- Komponenter och listor
  ut.push({
    id: "komponenter", mapp: MAPP.listor, namn: "Komponentlista", format: ["pdf", "word", "excel"],
    tom: !u.komponenter.length, info: u.komponenter.length ? st(u.komponenter.length, "komponent", "komponenter") : "tom",
    skapa: async (f) => [
      ...await blockFiler(komponentDokument(u), `${MAPP.listor}/Komponentlista`, f),
      ...f.includes("excel") ? [{ namn: `${MAPP.listor}/Komponentlista.xlsx`, data: await binar(`${P}/komponenter/excel`) }] : [],
    ],
  });
  for (const [id, m] of LISTOR.filter(([, m]) => m === "listor")) lagg(lista(id, MAPP[m]));
  const antalSignaler = u.komponenter.reduce((s, k) => s + k.signaler.length, 0);
  ut.push({
    id: "signallista", mapp: MAPP.listor, namn: "Signallista (I/O)", format: ["pdf", "word", "excel"],
    tom: !antalSignaler, info: antalSignaler ? st(antalSignaler, "signal", "signaler") : "tom",
    skapa: async (f) => [
      ...await blockFiler(signallistaDokument(u.komponenter, u.projekt), `${MAPP.listor}/Signallista (I-O)`, f),
      ...f.includes("excel") ? [{ namn: `${MAPP.listor}/Signallista (I-O).xlsx`, data: await binar(`${P}/komponenter/signaler/excel`) }] : [],
    ],
  });

  // ---- Konstruktion (per skåp: en fil per skåp)
  const skapInfo = u.skap.length ? `${st(u.skap.length, "skåp", "skåp")} – en fil per skåp` : "inga skåp";
  const skapNamn = (s: Skap) => rentNamn(s.namn || s.beteckning || "Skåp");
  ut.push({
    id: "apparatskap", mapp: MAPP.konstruktion, namn: "Apparatskåp", format: ["pdf", "word"], tom: !u.skap.length, info: skapInfo,
    skapa: async (f, c) => {
      const filer: Fil[] = [];
      for (const s of u.skap) { if (c.avbrutet()) break; filer.push(...await blockFiler(apparatskapDokument(s, u.projekt), `${MAPP.konstruktion}/Apparatskåp ${skapNamn(s)}`, f)); }
      return filer;
    },
  });
  ut.push({
    id: "modulbelaggning", mapp: MAPP.konstruktion, namn: "Modulbeläggning", format: ["pdf", "word", "excel"], tom: !u.skap.length, info: skapInfo,
    skapa: async (f, c) => {
      const filer: Fil[] = [];
      for (const s of u.skap) {
        if (c.avbrutet()) break;
        const bas = `${MAPP.konstruktion}/Modulbeläggning ${skapNamn(s)}`;
        filer.push(...await blockFiler(modulDokument(s, lasModuler(s.moduler), u.komponenter, u.projekt), bas, f));
        if (f.includes("excel")) filer.push({ namn: `${bas}.xlsx`, data: await binar(`${P}/skap/${s.id}/moduler/excel`) });
      }
      return filer;
    },
  });
  const kraftDef = def("kraft");
  ut.push({
    id: "kraftberakning", mapp: MAPP.konstruktion, namn: "Kraftberäkning", format: ["pdf", "word", "excel"], tom: !u.skap.length, info: skapInfo,
    skapa: async (f, c) => {
      const filer: Fil[] = [];
      for (const s of u.skap) {
        if (c.avbrutet() || !kraftDef) break;
        const id = `kraft-${s.id}`;
        const r = rader(id);
        const tal = (v: string | undefined) => Number((v ?? "").replace(",", ".").trim()) || 0;
        const fmt = (v: number) => v.toLocaleString("sv-SE", { maximumFractionDigits: 2 });
        const summa = ["l1", "l2", "l3"].map((l) => r.reduce((x, y) => x + tal(y.data[l]), 0));
        const h = lista(id, MAPP.konstruktion, `Kraftberäkning ${s.namn}`, { ...kraftDef, id, namn: `Kraftberäkning ${s.namn}` },
          `Totalt (A): L1 = ${fmt(summa[0]!)}   L2 = ${fmt(summa[1]!)}   L3 = ${fmt(summa[2]!)}`);
        if (h) filer.push(...await h.skapa(f, c));
      }
      return filer;
    },
  });
  for (const [id, m] of LISTOR.filter(([, m]) => m === "konstruktion")) lagg(lista(id, MAPP[m]));
  const gateways = u.komponenter.filter(arGateway);
  ut.push({
    id: "gateways", mapp: MAPP.konstruktion, namn: "Gateways", format: ["pdf", "word", "excel"],
    tom: !gateways.length, info: gateways.length ? st(gateways.length, "gateway", "gateways") : "inga gateways",
    skapa: async (f) => {
      const t = gatewayTabell(u);
      return [
        ...await blockFiler(utskriftDokument("Gateways", u.projekt, { typ: "tabell", ...t, bredder: [14, 11, 13, 11, 17, 8, 16, 10], centrera: [7] }, { liggande: true }), `${MAPP.konstruktion}/Gateways`, f),
        ...f.includes("excel") ? [{ namn: `${MAPP.konstruktion}/Gateways.xlsx`, data: await excelData([{ namn: "Gateways", bredder: [18, 14, 16, 14, 22, 10, 16, 12], rader: [t.kolumner, ...t.rader] }]) }] : [],
      ];
    },
  });
  const best = bestallningsRader(u.komponenter, u.skap, rader("modbusrtu")).rader;
  ut.push({
    id: "bestallningslista", mapp: MAPP.konstruktion, namn: "Beställningslista", format: ["pdf", "word", "excel"],
    tom: !best.length, info: best.length ? st(best.length, "rad", "rader") : "tom",
    skapa: async (f) => [
      ...await blockFiler(bestallningDokument("Beställningslista", u.projekt, best), `${MAPP.konstruktion}/Beställningslista`, f),
      ...f.includes("excel") ? [{ namn: `${MAPP.konstruktion}/Beställningslista.xlsx`, data: await excelData(bestallningBlad(best)) }] : [],
    ],
  });

  // ---- Driftsättning
  for (const [id, m] of LISTOR.filter(([, m]) => m === "driftsattning")) lagg(lista(id, MAPP[m]));
  const kontrollDef = def("kontroll");
  ut.push({
    id: "kontroller", mapp: MAPP.driftsattning, namn: "Projektspecifika kontroller", format: ["pdf", "word", "excel"],
    tom: !u.kontroller.length, info: u.kontroller.length ? `${st(u.kontroller.length, "kontroll", "kontroller")} – en fil per kontroll` : "inga kontroller",
    skapa: async (f, c) => {
      const filer: Fil[] = [];
      for (const k of u.kontroller) {
        if (c.avbrutet() || !kontrollDef) break;
        const id = `kontroll-${k.id}`;
        const h = lista(id, MAPP.driftsattning, k.namn, { ...kontrollDef, id, namn: k.namn });
        if (h) filer.push(...await h.skapa(f, c));
      }
      return filer;
    },
  });

  // ---- Projektering: ritningar och funktionstexter
  const plan = antalPlan(u.ritning);
  ut.push({
    id: "placeringsritningar", mapp: `${MAPP.projektering}/Placeringsritningar`, namn: "Placeringsritningar", format: ["pdf"],
    tom: !plan, info: plan ? `${st(plan, "plan", "plan")} – en PDF per plan` : "inga plan med ritning",
    skapa: async (_f, c) => {
      const filer = await placeringsritningarPdf(u.projektId, u.projekt.namn, u.ritning, u.komponenter, rader("egenkontroll"), rader("installationslista"));
      if (!c.avbrutet() && !filer.length && plan) c.notera("Placeringsritningar: inga plan kunde exporteras.");
      return filer.map((x) => ({ namn: `${MAPP.projektering}/Placeringsritningar/${rentNamn(x.namn)}.pdf`, data: x.data }));
    },
  });
  ut.push({
    id: "ritbord", mapp: `${MAPP.projektering}/Ritbord`, namn: "Ritbord (flödesbilder)", format: ["pdf"],
    tom: !u.ritbord.length, info: u.ritbord.length ? `${st(u.ritbord.length, "bild", "bilder")} – en PDF per bild` : "inga bilder",
    skapa: async (_f, c) => (await ritbordPdf(u.projektId, u.ritbord, c.avbrutet))
      .map((x) => ({ namn: `${MAPP.projektering}/Ritbord/${rentNamn(x.namn)}.pdf`, data: x.data })),
  });
  // Driftkort = Word-filen som Ritbordet skapade (flödesbild + text) i Projektfiler → Driftkort, med bildens namn.
  const bildNamn = new Set(u.ritbord.map((b) => `${b.namn}.docx`.toLowerCase()));
  const driftkort = u.filer.filter((f) => f.mapp === "Driftkort" && bildNamn.has(f.namn.toLowerCase()));
  const systemFor = (d: ProjektDokument) => ((dela(d.data).meta.System ?? "") || d.namn).toUpperCase().trim();
  const harDriftkort = (d: ProjektDokument) => {
    const sys = systemFor(d);
    return !!sys && driftkort.some((f) => f.namn.toUpperCase().includes(sys));
  };
  const antalFt = u.funktionstexter.length;
  ut.push({
    id: "funktionstexter", mapp: `${MAPP.projektering}/Funktionstexter`, namn: "Funktionstexter och driftkort", format: ["word"],
    tom: !antalFt && !driftkort.length,
    info: antalFt || driftkort.length
      ? `${st(antalFt, "text", "texter")}${driftkort.length ? `, ${st(driftkort.length, "driftkort med flödesbild", "driftkort med flödesbild")}` : ""} – en fil per text`
      : "inga texter",
    skapa: async (_f, c) => {
      const filer: Fil[] = [];
      const mapp = `${MAPP.projektering}/Funktionstexter`;
      for (const f of driftkort) {
        if (c.avbrutet()) break;
        filer.push({ namn: `${mapp}/${rentNamn(f.namn.replace(/\.docx$/i, ""))}.docx`, data: await binar(`${P}/filer/${f.id}/innehall`) });
        // Driftkortet är skapat vid ett visst tillfälle: har texten ändrats efteråt behöver det skapas om i Ritbordet.
        const text = u.funktionstexter.find((d) => { const s = systemFor(d); return s && f.namn.toUpperCase().includes(s); });
        if (text && new Date(text.andrad) > new Date(f.uppladdad))
          c.notera(`${f.namn}: funktionstexten ${text.namn} är ändrad efter att driftkortet skapades. Skapa om driftkortet i Ritbordet om ändringen ska med.`);
      }
      for (const d of u.funktionstexter) {
        if (c.avbrutet()) break;
        if (harDriftkort(d)) continue;
        try { filer.push({ namn: `${mapp}/${rentNamn(d.namn.replace(/\.docx$/i, ""))}.docx`, data: await binar(`${P}/funktionstexter/${d.id}/word`) }); }
        catch (e) { c.notera(`${d.namn}: Word-filen kunde inte skapas (${(e as Error).message}).`); }
      }
      return filer;
    },
  });

  // ---- Projektering: kontroller
  const medEa = pekMedEa();
  ut.push({
    id: "projekteringsegenkontroll", mapp: MAPP.kontroller, namn: "Projekteringsegenkontroll", format: ["pdf", "word", "excel"],
    tom: !u.pek.length, info: u.pek.length ? `${st(u.pek.length, "kontroll", "kontroller")}${medEa ? ", med ej aktuella" : ", utan ej aktuella"}` : "ingen kontroll",
    skapa: async (f, c) => {
      const filer: Fil[] = [];
      for (const k of u.pek) {
        if (c.avbrutet()) break;
        const bas = `${MAPP.kontroller}/${rentNamn(u.pek.length > 1 ? `Projekteringsegenkontroll ${k.namn}` : "Projekteringsegenkontroll")}`;
        filer.push(...await blockFiler(pekDokument(k.namn, rader(`kontroll-${k.id}`), u.projekt, u.texter.projekteringsintyg, medEa), bas, f));
        if (f.includes("excel")) filer.push({ namn: `${bas}.xlsx`, data: await binar(`${P}/listor/kontroll-${k.id}/excel`) });
      }
      return filer;
    },
  });
  for (const variant of ["projektering", "produktion"] as const) {
    const id = `risk-${variant}`;
    const namn = variant === "projektering" ? "Riskanalys projektering" : "Riskanalys produktion";
    ut.push({
      id, mapp: MAPP.kontroller, namn, format: ["pdf", "word", "excel"], tom: !rader(id).length && !u.texter[id],
      info: rader(id).length ? st(rader(id).length, "risk", "risker") : "inga risker",
      skapa: async (f) => [
        ...await blockFiler(riskDokument(namn, variant, u.texter[id], rader(id), u.projekt), `${MAPP.kontroller}/${namn}`, f),
        ...f.includes("excel") ? [{ namn: `${MAPP.kontroller}/${namn}.xlsx`, data: await binar(`${P}/listor/${id}/excel`) }] : [],
      ],
    });
  }
  ut.push({
    id: "projekteringsintyg", mapp: MAPP.kontroller, namn: "Projekteringsintyg", format: ["pdf", "word"],
    tom: !u.texter.projekteringsintyg, info: u.pek.length ? "med projekteringsegenkontrollen som bilaga" : "",
    skapa: async (f) => {
      const egen = u.pek.map((k) => ({ namn: k.namn, rader: [...rader(`kontroll-${k.id}`)].sort((a, b) => a.ordning - b.ordning) }));
      return blockFiler(intygDokument(u.texter.projekteringsintyg, u.projekt, egen, medEa), `${MAPP.kontroller}/Projekteringsintyg`, f);
    },
  });

  // ---- Projektering: miljö, kravställningar, stöd och övrigt
  for (const [id, m] of LISTOR.filter(([, m]) => m === "miljo")) lagg(lista(id, MAPP[m]));
  ut.push({
    id: "teknisk-beskrivning", mapp: MAPP.krav, namn: "Teknisk beskrivning", format: ["pdf", "word", "excel"],
    tom: !u.texter["teknisk-beskrivning"], info: u.texter["teknisk-beskrivning"] ? "" : "inte påbörjad",
    skapa: async (f) => [
      ...await blockFiler(tekniskDokument(u.teknisk, u.texter["teknisk-beskrivning"], u.projekt), `${MAPP.krav}/Teknisk beskrivning`, f),
      ...f.includes("excel") ? [{ namn: `${MAPP.krav}/Teknisk beskrivning.xlsx`, data: await excelData(tekniskBlad(u.teknisk, u.texter["teknisk-beskrivning"])) }] : [],
    ],
  });
  for (const [id, m] of LISTOR.filter(([, m]) => m === "krav" || m === "stod")) lagg(lista(id, MAPP[m]));
  const ataDef = def("ata");
  const ataRader = ataDef ? byggRader(ataDef, rader("ata"), u.komponenter) : [];
  ut.push({
    id: "ata-styckvis", mapp: `${MAPP.stod}/ÄTA`, namn: "ÄTA-underrättelser (styckvis)", format: ["pdf", "word"],
    tom: !ataRader.length, info: ataRader.length ? `${st(ataRader.length, "ÄTA", "ÄTA")} – en fil per ÄTA` : "inga ÄTA",
    skapa: async (f, c) => {
      const filer: Fil[] = [];
      for (const r of ataRader) {
        if (c.avbrutet()) break;
        filer.push(...await blockFiler(ataDokument(r, u.projekt), `${MAPP.stod}/ÄTA/${rentNamn(`${r.nr ?? ""} ${(r.kommentar ?? "").split("\n")[0]!.slice(0, 50)}`)}`, f));
      }
      return filer;
    },
  });
  for (const typ of ["forhinder", "hinder"] as const) {
    const lista0 = [...rader(typ)].sort((a, b) => a.ordning - b.ordning);
    const namn = typ === "forhinder" ? "Förhindersanmälan" : "Underrättelse om hinder";
    ut.push({
      id: typ, mapp: `${MAPP.stod}/Hinder`, namn, format: ["pdf", "word"], tom: !lista0.length,
      info: lista0.length ? `${st(lista0.length, "st", "st")} – en fil per ${typ === "forhinder" ? "anmälan" : "underrättelse"}` : "inga",
      skapa: async (f, c) => {
        const filer: Fil[] = [];
        for (const r of lista0) {
          if (c.avbrutet()) break;
          const d = typ === "forhinder" ? forhinderDokument(r.data, u.projekt) : hinderDokument(r.data, u.projekt);
          filer.push(...await blockFiler(d, `${MAPP.stod}/Hinder/${rentNamn(`${namn} ${r.data.nr ?? ""} ${r.data.rubrik ?? ""}`)}`, f));
        }
        return filer;
      },
    });
  }

  // ---- Dokumentation
  for (const [id, m] of LISTOR.filter(([, m]) => m === "dokumentation")) lagg(lista(id, MAPP[m]));

  // Excel-filer från servern finns bara för listor; formaten som handlingen inte har hoppas över.
  return ut;
}

/** Formaten en handling får: de valda som den finns i, annars dess första format (t.ex. funktionstexter bara i Word). */
export function formatFor(h: Handling, valda: Format[]): Format[] {
  const f = h.format.filter((x) => valda.includes(x));
  return f.length ? f : [h.format[0]!];
}

export { ext as filtyp };
export type { Blad };
