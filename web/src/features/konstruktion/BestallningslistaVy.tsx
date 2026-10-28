import { useMemo } from "react";
import { DataGrid, type Kolumn } from "../../grid/DataGrid";
import { skrivExcel } from "../../lib/excelFil";
import type { Komponent, ListRad, Projekt, Skap } from "../../lib/typer";
import { skrivUtBlock, type BlockDokument } from "../../lib/dokumentBlock";
import { utskriftDokument } from "../../lib/utskrift";
import type { Blad } from "../../lib/excelFil";
import { arGateway, lasGateway } from "../../lib/gateway";

/** Komponenttyper i Apparatskåp som ska beställas när de är ibockade (samma som dagens program). */
const SKAP_BESTALLS = ["Dupline", "DIN-PC", "M-busgateway", "SIOX-Axccess", "Panel-PC / HMI i front"];

type Rad = { id: string; kalla: string; beskrivning: string; fabrikat: string; antal: string };

type Props = {
  grupp: string;
  rubrik: string;
  projekt: Projekt | null;
  komponenter: Komponent[];
  skap: Skap[] | null;
  gateways: ListRad[] | undefined;
  visaMeddelande: (t: string) => void;
};

/**
 * Beställningslistans rader: räknas fram ur Komponenter (per produkttyp och fabrikat), Modulbeläggning (I/O-kort),
 * gatewaykomponenterna, äldre Modbus RTU-slingor och Apparatskåp (vissa ibockade komponenter).
 */
export function bestallningsRader(komponenter: Komponent[], skap: Skap[] | null, gateways: ListRad[] | undefined): { rader: Rad[]; utanProdukttyp: number } {
    const ut: Rad[] = [];
    const rakna = (kalla: string, nycklar: [string, string][]) => {
      const m = new Map<string, { beskrivning: string; fabrikat: string; antal: number }>();
      for (const [b, f] of nycklar) {
        const k = `${b.toLowerCase()}|${f.toLowerCase()}`;
        const x = m.get(k) ?? { beskrivning: b, fabrikat: f, antal: 0 };
        x.antal++;
        m.set(k, x);
      }
      [...m.values()].sort((a, b) => a.beskrivning.localeCompare(b.beskrivning, "sv") || a.fabrikat.localeCompare(b.fabrikat, "sv"))
        .forEach((x, i) => ut.push({ id: `${kalla}-${i}`, kalla, beskrivning: x.beskrivning, fabrikat: x.fabrikat, antal: String(x.antal) }));
    };

    // Produkt (fabrikat och modell) per komponenttyp. Äldre komponenter med bara Fabrikat räknas på det.
    const produkt = (k: Komponent) => (k.produkttyp || k.produkt).trim();
    const medTyp = komponenter.filter((k) => produkt(k) && !arGateway(k));
    rakna("Komponenter", medTyp.map((k) => [k.komponenttyp.trim() || "Övrigt", produkt(k)]));
    rakna("Gateways", komponenter.filter(arGateway).map((k) => [`Gateway ${lasGateway(k).typ} (${lasGateway(k).portar.length} portar)`, produkt(k)]));

    const kort: [string, string][] = [];
    const skapKomp: [string, string][] = [];
    for (const s of skap ?? []) {
      try {
        const m = JSON.parse(s.moduler || "{}") as { kort?: { beskrivning?: string }[] };
        for (const k of m.kort ?? []) if (k.beskrivning?.trim()) kort.push([k.beskrivning.trim(), ""]);
      } catch { /* trasig modulbeläggning hoppas över */ }
      try {
        const d = JSON.parse(s.data || "{}") as { komponenter?: Record<string, { vald?: boolean; info?: string }> };
        for (const n of SKAP_BESTALLS) if (d.komponenter?.[n]?.vald) skapKomp.push([n, d.komponenter[n]!.info?.trim() ?? ""]);
      } catch { /* trasigt formulär hoppas över */ }
    }
    rakna("Modulbeläggning", kort);
    rakna("Modbus RTU (äldre slingor)", (gateways ?? []).filter((g) => (g.data.namn ?? g.data.fabrikat ?? "").trim())
      .map((g) => [(g.data.fabrikat || "Modbus RTU-gateway").trim(), ""]));
    rakna("Apparatskåp", skapKomp);
    return { rader: ut, utanProdukttyp: komponenter.filter((k) => !arGateway(k)).length - medTyp.length };
}

const KOLUMNER = ["Nr", "Källa", "Beskrivning", "Produkt / information", "Antal"];

export function bestallningDokument(rubrik: string, projekt: Projekt | null, rader: Rad[]): BlockDokument {
  return utskriftDokument(rubrik, projekt, { typ: "tabell", kolumner: KOLUMNER, bredder: [5, 20, 38, 29, 8], centrera: [4],
    rader: rader.map((r, i) => [String(i + 1), r.kalla, r.beskrivning, r.fabrikat, r.antal]) });
}

export function bestallningBlad(rader: Rad[]): Blad[] {
  return [{ namn: "Beställningslista", bredder: [6, 18, 50, 36, 8],
    rader: [KOLUMNER, ...rader.map((r, i) => [i + 1, r.kalla, r.beskrivning, r.fabrikat, Number(r.antal)])] }];
}

/**
 * Beställningslista: räknas fram ur Komponenter (per produkttyp och fabrikat), Modulbeläggning (I/O-kort),
 * Modbus RTU (gateways) och Apparatskåp (vissa ibockade komponenter). Inget sparas här.
 */
export function BestallningslistaVy(p: Props) {
  const { rader, utanProdukttyp } = useMemo(() => bestallningsRader(p.komponenter, p.skap, p.gateways), [p.komponenter, p.skap, p.gateways]);

  const kolumner: Kolumn<Rad>[] = [
    { nyckel: "kalla", rubrik: "Källa", typ: "ro", bredd: 150 },
    { nyckel: "beskrivning", rubrik: "Beskrivning", typ: "ro", fyll: true },
    { nyckel: "fabrikat", rubrik: "Produkt / information", typ: "ro", bredd: 260 },
    { nyckel: "antal", rubrik: "Antal", typ: "ro", mono: true, bredd: 80 },
  ];

  const excel = () => void skrivExcel(`Beställningslista ${p.projekt?.nummer ?? ""}`.trim(), bestallningBlad(rader))
    .catch((e) => p.visaMeddelande((e as Error).message));

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          <button className="knapp" onClick={excel}>Exportera till Excel</button>
          <button className="knapp" onClick={() => skrivUtBlock(bestallningDokument(p.rubrik, p.projekt, rader))}>Skriv ut / PDF</button>
        </div>
      </div>
      <p className="ingress">
        Räknas fram ur Komponenter (per komponenttyp och produkt), gatewaykomponenterna, I/O-korten i Modulbeläggning och
        ibockade {SKAP_BESTALLS.join(", ")} i Apparatskåp. Ändra i de flikarna, så uppdateras listan.
        {utanProdukttyp > 0 && ` ${utanProdukttyp} komponenter saknar produkt och är inte med.`}
      </p>
      {p.skap === null ? <p className="dampad">Hämtar…</p> : (
        <DataGrid rader={rader} kolumner={kolumner} sokPlatshallare="Sök i beställningslistan" onAndra={() => undefined} lasläge tomText="Inget att beställa än." />
      )}
    </>
  );
}
