import { useEffect, useMemo, useState } from "react";
import { DataGrid, type Kolumn } from "../../grid/DataGrid";
import { api, ApiFel, skicka } from "../../lib/api";
import { oppenRitning } from "../ritning/PlaceringsritningVy";
import type { Projekt } from "../../lib/typer";
import { skrivUtBlock, type BlockDokument } from "../../lib/dokumentBlock";
import { utskriftDokument } from "../../lib/utskrift";

/** Samma standardkategorier som kommentarslagret i placeringsritningen (public/ritning/placeringsritning.html). */
const STANDARD: Kategori[] = [
  { id: "allman", namn: "Allmän", farg: "" }, { id: "minne", namn: "Minnesanteckning", farg: "#1e88e5" },
  { id: "fel", namn: "Fel", farg: "#e53935" }, { id: "avvikelse", namn: "Avvikelse", farg: "#f57c00" },
  { id: "fraga", namn: "Fråga", farg: "#00a39a" },
];
/** Färg för kategorier med automatisk färg (magenta, som på ritningen). */
const AUTO = "#c8006a";

type Kategori = { id: string; namn: string; farg: string };
type Pkt = [number, number];
type RitKommentar = { id: string; text?: string; kat?: string; ax: number; ay: number; klar?: boolean };
type RitPlan = { name: string; ref?: { w: number; h: number } | null; rooms?: { name: string; points: Pkt[] }[]; kommentarer?: RitKommentar[] };
type RitData = { settings?: { kommKat?: Kategori[] }; buildings?: { name: string; floors?: RitPlan[] }[] };

export type KommentarRad = { id: string; avslutad: string; kategori: string; katId: string; farg: string; text: string; byggnad: string; plan: string; rum: string };

const inPoly = (pts: Pkt[], x: number, y: number) => {
  let inne = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inne = !inne;
  }
  return inne;
};

/** Läser alla kommentarer i placeringsritningen, med kategori, plan och rummet som pilen pekar på. */
export function lasKommentarer(json: string | null): { rader: KommentarRad[]; kategorier: Kategori[] } {
  let d: RitData = {};
  try { if (json) d = JSON.parse(json) as RitData; } catch { /* trasig ritning */ }
  const kategorier = d.settings?.kommKat?.length ? d.settings.kommKat : STANDARD;
  const rader: KommentarRad[] = [];
  for (const b of d.buildings ?? []) for (const f of b.floors ?? []) for (const k of f.kommentarer ?? []) {
    if (!(k.text ?? "").trim()) continue;
    const kat = kategorier.find((c) => c.id === k.kat) ?? kategorier[0]!;
    const x = k.ax * (f.ref?.w ?? 0), y = k.ay * (f.ref?.h ?? 0);
    const rum = f.ref ? [...(f.rooms ?? [])].reverse().find((r) => r.points?.length > 2 && inPoly(r.points, x, y)) : undefined;
    rader.push({ id: k.id, avslutad: k.klar ? "true" : "", kategori: kat.namn, katId: kat.id, farg: kat.farg || AUTO, text: (k.text ?? "").trim(), byggnad: b.name, plan: f.name, rum: rum?.name ?? "" });
  }
  return { rader, kategorier };
}

/** Placeringskommentarerna som dokument (utskrift, PDF och Word). */
export function kommentarDokument(rader: KommentarRad[], projekt: Projekt | null): BlockDokument {
  return utskriftDokument("Placeringskommentarer", projekt, {
    typ: "tabell",
    kolumner: ["Nr", "Kategori", "Kommentar", "Byggnad", "Plan", "Rum", "Avslutad"],
    bredder: [5, 14, 41, 11, 10, 11, 8], centrera: [6],
    rader: rader.map((r, i) => [String(i + 1), r.kategori, r.text, r.byggnad, r.plan, r.rum, r.avslutad === "true" ? "✔" : ""]),
  }, { liggande: true });
}

type Props = {
  projektId: string;
  projekt: Projekt | null;
  /** Räknas upp när ritningen sparats (av vem som helst). */
  uppdaterad: number;
  onVisa: (kommentarId: string) => void;
  onPopUt?: () => void;
  lasläge?: boolean;
  visaMeddelande?: (t: string) => void;
};

/** Sätter status direkt i den sparade ritningen (när placeringsritningen inte är öppen). Försöker igen om någon sparade samtidigt. */
async function sattKlarIRitning(projektId: string, id: string, klar: boolean) {
  for (let forsok = 0; forsok < 3; forsok++) {
    const r = await api<{ data: string | null; version: number }>(`/api/projekt/${projektId}/ritning`);
    if (!r.data) return;
    const d = JSON.parse(r.data) as RitData;
    let hittad = false;
    for (const b of d.buildings ?? []) for (const f of b.floors ?? []) for (const k of f.kommentarer ?? [])
      if (k.id === id) { hittad = true; if (klar) k.klar = true; else delete k.klar; }
    if (!hittad) throw new Error("Kommentaren finns inte längre på ritningen.");
    try {
      await api(`/api/projekt/${projektId}/ritning`, { method: "PUT", body: skicka({ data: JSON.stringify(d), version: r.version }) });
      return;
    } catch (e) {
      if (!(e instanceof ApiFel && e.status === 409)) throw e;
    }
  }
  throw new Error("Ritningen ändrades samtidigt av någon annan. Försök igen.");
}

/**
 * Att göra → Placeringskommentarer: alla kommentarer från placeringsritningarnas kommentarslager,
 * med kategori (Minnesanteckning, Fel, Avvikelse, Fråga …). Kommentarerna ändras på ritningen; här visas och filtreras de.
 */
export function KommentarerVy({ projektId, projekt, uppdaterad, onVisa, onPopUt, lasläge, visaMeddelande }: Props) {
  const [data, setData] = useState<{ rader: KommentarRad[]; kategorier: Kategori[] } | null>(null);
  const [fel, setFel] = useState("");
  const [filter, setFilter] = useState<string | null>(null);
  const [status, setStatus] = useState<"oppna" | "avslutade" | "alla">("oppna");

  const sattKlar = async (id: string, klar: boolean) => {
    // Visa ändringen direkt.
    setData((d) => d && { ...d, rader: d.rader.map((r) => (r.id === id ? { ...r, avslutad: klar ? "true" : "" } : r)) });
    if (oppenRitning?.sattKommentarKlar(id, klar)) return;
    try { await sattKlarIRitning(projektId, id, klar); }
    catch (e) { visaMeddelande?.(`Statusen kunde inte sparas: ${(e as Error).message}`); }
  };

  useEffect(() => {
    let aktuell = true;
    api<{ data: string | null }>(`/api/projekt/${projektId}/ritning`)
      .then((r) => { if (aktuell) { setData(lasKommentarer(r.data)); setFel(""); } })
      .catch((e) => { if (aktuell) setFel((e as Error).message); });
    return () => { aktuell = false; };
  }, [projektId, uppdaterad]);

  const iStatus = useMemo(() => (data?.rader ?? []).filter((r) => status === "alla" || (status === "avslutade") === (r.avslutad === "true")), [data, status]);
  const visade = useMemo(() => iStatus.filter((r) => !filter || r.katId === filter), [iStatus, filter]);

  const kolumner: Kolumn<KommentarRad>[] = useMemo(() => [
    {
      nyckel: "id", rubrik: "", typ: "ro", bredd: 74,
      cell: (r) => <button className="knapp liten" title="Gå till kommentaren på placeringsritningen" onClick={() => onVisa(r.id)}>Visa ➜</button>,
    },
    { nyckel: "avslutad", rubrik: "Avslutad", typ: "kryss", bredd: 80 },
    {
      nyckel: "kategori", rubrik: "Kategori", typ: "ro", bredd: 150,
      cell: (r) => <span className="kommkat"><i style={{ background: r.farg }} />{r.kategori}</span>,
    },
    { nyckel: "text", rubrik: "Kommentar", typ: "ro", fyll: true },
    { nyckel: "byggnad", rubrik: "Byggnad", typ: "ro", bredd: 120 },
    { nyckel: "plan", rubrik: "Plan", typ: "ro", bredd: 120 },
    { nyckel: "rum", rubrik: "Rum", typ: "ro", bredd: 140 },
  ], [onVisa]);

  const utskrift = () => skrivUtBlock(kommentarDokument(visade, projekt));

  return (
    <>
      <div className="brodsmula">Att göra</div>
      <div className="rubrikrad">
        <h1>Placeringskommentarer</h1>
        <div className="knappar">
          {onPopUt && <button className="knapp" onClick={onPopUt} title="Öppna i ett eget fönster som följer med mellan flikarna">⧉ Pop-ut</button>}
          <button className="knapp" onClick={utskrift} disabled={!visade.length}>Skriv ut / PDF</button>
        </div>
      </div>
      <p className="ingress">
        Alla kommentarer från kommentarslagret på placeringsritningarna. Klicka på <b>Visa ➜</b> för att gå till kommentaren på rätt plan.
        Bocka i <b>Avslutad</b> när saken är klar – kommentaren tonas då ned på ritningen.
        Kategorier och färger ställs in under ✎ Kommentarslager ▾ på ritningen.
      </p>
      {fel && <p className="felruta">Kommentarerna kunde inte hämtas: {fel}</p>}
      {data && (
        <div className="summering" aria-label="Filtrera på kategori">
          {(["oppna", "avslutade", "alla"] as const).map((s) => (
            <button key={s} className={`chip${status === s ? " vald" : ""}`} onClick={() => setStatus(s)}>
              {s === "oppna" ? "Öppna" : s === "avslutade" ? "Avslutade" : "Alla"} <b>{data.rader.filter((r) => s === "alla" || (s === "avslutade") === (r.avslutad === "true")).length}</b>
            </button>
          ))}
          <span className="chip-avdelare" />
          <button className={`chip${filter === null ? " vald" : ""}`} onClick={() => setFilter(null)}>Alla kategorier</button>
          {data.kategorier.map((c) => (
            <button key={c.id} className={`chip kommkat${filter === c.id ? " vald" : ""}`} onClick={() => setFilter(filter === c.id ? null : c.id)}>
              <i style={{ background: c.farg || AUTO }} />{c.namn} <b>{iStatus.filter((r) => r.katId === c.id).length}</b>
            </button>
          ))}
        </div>
      )}
      {!data ? (!fel && <p className="dampad">Hämtar…</p>) : (
        <DataGrid
          rader={visade}
          kolumner={kolumner}
          sokPlatshallare="Sök i kommentarer"
          onAndra={(r, nyckel, v) => { if (nyckel === "avslutad") void sattKlar(r.id, v === "true"); }}
          lasläge={lasläge}
          tomText={data.rader.length ? "Inga kommentarer med det här urvalet." : "Inga kommentarer på placeringsritningarna än. Öppna en placeringsritning, klicka på ✎ Kommentarslager och dra ut en kommentar."}
        />
      )}
    </>
  );
}
