import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import type { AttGora } from "../../lib/typer";

const KOLUMNER: Kolumn<AttGora>[] = [
  { nyckel: "klar", rubrik: "Klar", typ: "kryss" },
  { nyckel: "text", rubrik: "Att göra", typ: "text", bredd: 400 },
];

type Props = {
  rader: AttGora[];
  blinkar: Blink[];
  onAndra: (rad: AttGora, falt: "text" | "klar", varde: string) => void;
  onNy: () => void;
  onTaBort: (ids: string[]) => void;
  lasläge?: boolean;
};

export function AttGoraVy({ rader, blinkar, onAndra, onNy, onTaBort, lasläge }: Props) {
  return (
    <>
      <div className="brodsmula">Att göra</div>
      <h1>Lista</h1>
      <p className="ingress">Projektets att göra-lista. Bocka i Klar när en sak är gjord.</p>
      <DataGrid
        rader={rader}
        kolumner={KOLUMNER}
        sokPlatshallare="Sök i att göra"
        onAndra={(r, nyckel, v) => onAndra(r, nyckel as "text" | "klar", v)}
        onNy={onNy}
        onTaBort={onTaBort}
        blinkar={blinkar}
        lasläge={lasläge}
      />
    </>
  );
}
