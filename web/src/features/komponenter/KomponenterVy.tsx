import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import type { Komponent } from "../../lib/typer";

// Valbara värden. Flyttas till redigerbara kataloger (som dagens DropDowns) i fas 2.
const SYSTEM = ["LB01", "LB02", "LB03", "VS01", "VS02", "KB01", "VV01"];
const KOMPONENTTYP = [
  "Temperaturgivare", "Rumsgivare", "Tryckgivare", "Närvarosensor", "Rumsregulator",
  "Ventilställdon", "Spjällställdon", "Brandspjäll", "Fläkt", "Pump", "Larm",
];
const SIGNALTYP = ["AI", "AO", "DI", "DO", "Bus"];
const KABELTYP = ["EKKX 2x2x0,5", "EKKX 4x2x0,5", "FQAR 3G1,5", "EKLK 4x0,5"];

const KOLUMNER: Kolumn<Komponent>[] = [
  { nyckel: "system", rubrik: "System", typ: "val", val: SYSTEM },
  { nyckel: "beteckning", rubrik: "Beteckning", typ: "text", mono: true, bredd: 130 },
  { nyckel: "komponenttyp", rubrik: "Komponenttyp", typ: "val", val: KOMPONENTTYP },
  { nyckel: "signaltyp", rubrik: "Signal", typ: "val", val: SIGNALTYP },
  { nyckel: "placering", rubrik: "Placering", typ: "text", bredd: 160 },
  { nyckel: "beskrivning", rubrik: "Beskrivning", typ: "text", bredd: 220 },
  { nyckel: "anslutsTill", rubrik: "Ansluts till", typ: "text", mono: true },
  { nyckel: "kabeltyp", rubrik: "Kabeltyp", typ: "val", val: KABELTYP },
  { nyckel: "ovrigt", rubrik: "Övrigt", typ: "text" },
];

type Props = {
  komponenter: Komponent[];
  blinkar: Blink[];
  onAndra: (k: Komponent, falt: keyof Komponent & string, varde: string) => void;
  onNy: () => void;
  onTaBort: (ids: string[]) => void;
  lasläge?: boolean;
};

export function KomponenterVy({ komponenter, blinkar, onAndra, onNy, onTaBort, lasläge }: Props) {
  return (
    <>
      <div className="brodsmula">Komponenter &amp; Listor</div>
      <h1>Komponenter</h1>
      <p className="ingress">
        Projektets komponentregister. Skyltlista, Installationslista, Signallista, Egenkontroll och ritningen
        kommer att peka hit. Ändringar sparas när du lämnar cellen och syns direkt för alla som har projektet öppet.
      </p>
      <DataGrid
        rader={komponenter}
        kolumner={KOLUMNER}
        sokPlatshallare="Sök i komponenter"
        onAndra={onAndra}
        onNy={onNy}
        onTaBort={onTaBort}
        blinkar={blinkar}
        lasläge={lasläge}
      />
    </>
  );
}
