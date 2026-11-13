import { useState } from "react";
import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import type { AttGora } from "../../lib/typer";

export type AttGoraFalt = "text" | "klar" | "pagaende" | "kommentar";

const KOLUMNER: Kolumn<AttGora>[] = [
  { nyckel: "pagaende", rubrik: "Pågående", typ: "kryss" },
  { nyckel: "klar", rubrik: "Åtgärdad", typ: "kryss" },
  { nyckel: "text", rubrik: "Att göra", typ: "text", bredd: 400 },
  { nyckel: "kommentar", rubrik: "Kommentar", typ: "text", fyll: true, bredd: 260 },
];

/** Snabbfilter på kryssrutorna. Valet sparas per webbläsare. */
const FILTER = {
  alla: { namn: "Alla", visa: () => true },
  ejAtgardade: { namn: "Ej åtgärdade", visa: (r: AttGora) => !r.klar },
  pagaende: { namn: "Pågående", visa: (r: AttGora) => r.pagaende && !r.klar },
  ejPaborjade: { namn: "Ej påbörjade", visa: (r: AttGora) => !r.pagaende && !r.klar },
  atgardade: { namn: "Åtgärdade", visa: (r: AttGora) => r.klar },
} as const;
type Filter = keyof typeof FILTER;
const NYCKEL = "pv-attgora-filter";

function lasFilter(): Filter {
  try { const v = localStorage.getItem(NYCKEL); return v && v in FILTER ? (v as Filter) : "alla"; } catch { return "alla"; }
}

type Props = {
  rader: AttGora[];
  blinkar: Blink[];
  onAndra: (rad: AttGora, falt: AttGoraFalt, varde: string) => void;
  onNy: () => void;
  onTaBort: (ids: string[]) => void;
  onFlytta: (ids: string[]) => void;
  lasläge?: boolean;
  /** Visas inte när listan redan ligger i ett eget fönster. */
  onPopUt?: () => void;
};

export function AttGoraVy({ rader, blinkar, onAndra, onNy, onTaBort, onFlytta, lasläge, onPopUt }: Props) {
  const [filter, setFilter] = useState<Filter>(lasFilter);
  const valjFilter = (f: Filter) => { setFilter(f); try { localStorage.setItem(NYCKEL, f); } catch { /* bara bekvämlighet */ } };
  const ordnade = [...rader].sort((a, b) => a.ordning - b.ordning);
  const antal = (f: Filter) => rader.filter(FILTER[f].visa).length;
  return (
    <>
      <div className="brodsmula">Att göra</div>
      <div className="rubrikrad">
        <h1>Lista</h1>
        {onPopUt && <div className="knappar"><button className="knapp" onClick={onPopUt} title="Öppna listan i ett eget fönster som följer med mellan flikarna">⧉ Pop-ut</button></div>}
      </div>
      <p className="ingress">
        Projektets att göra-lista. Bocka i Pågående när någon har börjat och Åtgärdad när saken är gjord. Skriv gärna i Kommentar vad som gjorts.
        Dra i ⠿ eller använd pilarna för att ändra ordningen. Kryssrutan före texten markerar rader, t.ex. för att ta bort dem.
        Klicka på rubriken Pågående eller Åtgärdad för att få de ikryssade överst (klicka igen för omvänt). Med <b>Visa</b> döljer du det du inte vill se.
      </p>
      <div className="attgora-grid">
      <DataGrid
        rader={ordnade}
        kolumner={KOLUMNER}
        sokPlatshallare="Sök i att göra"
        onAndra={(r, nyckel, v) => onAndra(r, nyckel as AttGoraFalt, v)}
        onNy={onNy}
        onTaBort={onTaBort}
        onFlytta={onFlytta}
        filtrera={filter === "alla" ? undefined : FILTER[filter].visa}
        verktyg={
          <label className="attgora-filter">
            <span>Visa</span>
            <select value={filter} onChange={(e) => valjFilter(e.target.value as Filter)} aria-label="Visa rader">
              {(Object.keys(FILTER) as Filter[]).map((f) => <option key={f} value={f}>{FILTER[f].namn} ({antal(f)})</option>)}
            </select>
          </label>
        }
        blinkar={blinkar}
        lasläge={lasläge}
      />
      </div>
    </>
  );
}
