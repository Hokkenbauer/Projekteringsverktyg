import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import type { AttGora } from "../../lib/typer";

export type AttGoraFalt = "text" | "klar" | "pagaende" | "kommentar";

const KOLUMNER: Kolumn<AttGora>[] = [
  { nyckel: "pagaende", rubrik: "Pågående", typ: "kryss" },
  { nyckel: "klar", rubrik: "Åtgärdad", typ: "kryss" },
  { nyckel: "text", rubrik: "Att göra", typ: "text", bredd: 400 },
  { nyckel: "kommentar", rubrik: "Kommentar", typ: "text", fyll: true, bredd: 260 },
];

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
  const ordnade = [...rader].sort((a, b) => a.ordning - b.ordning);
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
      </p>
      <DataGrid
        rader={ordnade}
        kolumner={KOLUMNER}
        sokPlatshallare="Sök i att göra"
        onAndra={(r, nyckel, v) => onAndra(r, nyckel as AttGoraFalt, v)}
        onNy={onNy}
        onTaBort={onTaBort}
        onFlytta={onFlytta}
        blinkar={blinkar}
        lasläge={lasläge}
      />
    </>
  );
}
