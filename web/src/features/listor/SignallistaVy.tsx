import { useMemo } from "react";
import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import { FUNKTIONER, TYPER, sammanfatta, signalnamn, type Signal } from "../../lib/signaler";
import type { Komponent, Projekt } from "../../lib/typer";
import { skrivUt } from "../../lib/utskrift";

type Rad = {
  id: string; komponentId: string; signalId: string;
  signalnamn: string; typ: string; funktion: string; beskrivning: string;
  system: string; beteckning: string; komponenttyp: string; anslutsTill: string;
};

type Props = {
  komponenter: Komponent[];
  projekt: Projekt | null;
  blinkar: Blink[];
  lasläge: boolean;
  onAndra: (k: Komponent, falt: keyof Komponent & string, varde: string) => void;
  onExcel: () => void;
  onInfo: (komponentId: string) => void;
  fokusId?: string | null;
};

/**
 * Signallistan: en rad per I/O-punkt, hämtad från komponenternas I/O. Typ, funktion och beskrivning kan ändras
 * här och sparas på komponenten; övriga uppgifter ändras i Komponenter.
 */
export function SignallistaVy({ komponenter, projekt, blinkar, lasläge, onAndra, onExcel, onInfo, fokusId }: Props) {
  const rader: Rad[] = useMemo(() => komponenter.flatMap((k) => k.signaler.map((s) => ({
    id: `${k.id}:${s.id}`, komponentId: k.id, signalId: s.id,
    signalnamn: signalnamn(k.beteckning, s), typ: s.typ, funktion: s.funktion, beskrivning: s.beskrivning,
    system: k.system, beteckning: k.beteckning, komponenttyp: k.komponenttyp, anslutsTill: k.anslutsTill,
  }))).sort((a, b) => a.signalnamn.localeCompare(b.signalnamn, "sv", { numeric: true })), [komponenter]);

  const alla = [...new Set(Object.values(FUNKTIONER).flat())];
  const kolumner: Kolumn<Rad>[] = [
    { nyckel: "signalnamn", rubrik: "Signalnamn", typ: "ro", mono: true, bredd: 190 },
    { nyckel: "typ", rubrik: "Typ", typ: "val", val: TYPER, bredd: 120 },
    { nyckel: "funktion", rubrik: "Funktion", typ: "text", forslag: alla, bredd: 130 },
    { nyckel: "beskrivning", rubrik: "Beskrivning", typ: "text", bredd: 240 },
    { nyckel: "beteckning", rubrik: "Komponent", typ: "ro", mono: true, bredd: 140 },
    { nyckel: "komponenttyp", rubrik: "Komponenttyp", typ: "ro", bredd: 140 },
    { nyckel: "anslutsTill", rubrik: "Ansluts till", typ: "ro", mono: true },
  ];

  const andra = (r: Rad, falt: keyof Rad & string, varde: string) => {
    const k = komponenter.find((x) => x.id === r.komponentId);
    if (!k || !(falt === "typ" || falt === "funktion" || falt === "beskrivning")) return;
    const lista: Signal[] = k.signaler.map((s) => (s.id === r.signalId ? { ...s, [falt]: falt === "funktion" ? varde.toUpperCase() : varde } : s));
    onAndra(k, "signaler", JSON.stringify(lista));
  };

  const antalPerTyp = sammanfatta(rader.map((r) => ({ id: r.id, typ: r.typ, funktion: "", beskrivning: "" })));
  const skriv = () => skrivUt("Signallista (I/O)", projekt, {
    typ: "tabell", sammanfattning: `${rader.length} signaler: ${antalPerTyp}`,
    kolumner: ["Nr", "Signalnamn", "Typ", "Beskrivning", "Komponenttyp", "Ansluts till"],
    rader: rader.map((r, i) => [String(i + 1), r.signalnamn, r.typ, r.beskrivning, r.komponenttyp, r.anslutsTill]),
  });

  return (
    <>
      <div className="brodsmula">Komponenter &amp; Listor</div>
      <div className="rubrikrad">
        <h1>Signallista (I/O)</h1>
        <div className="knappar">
          <button className="knapp" onClick={skriv}>Skriv ut / PDF</button>
          <button className="knapp" onClick={onExcel}>Exportera till Excel</button>
        </div>
      </div>
      <p className="ingress">
        En rad per I/O-punkt från Komponenter. Signalnamnet är komponentens beteckning och funktionen. Typ, funktion och beskrivning
        kan ändras här; lägg till eller ta bort I/O i kolumnen I/O i Komponenter.
        {rader.length > 0 && <> <b>{rader.length} signaler:</b> {antalPerTyp}.</>}
      </p>
      <DataGrid
        rader={rader}
        kolumner={kolumner}
        sokPlatshallare="Sök signal, komponent eller typ"
        onAndra={andra}
        blinkar={blinkar.map((b) => ({ ...b, radId: rader.find((r) => r.komponentId === b.radId)?.id ?? b.radId }))}
        lasläge={lasläge}
        onInfo={(r) => onInfo(r.komponentId)}
        fokusId={fokusId ? rader.find((r) => r.komponentId === fokusId)?.id ?? null : null}
        tomText="Inga signaler än. Lägg till I/O på komponenterna i Komponenter (kolumnen I/O)."
      />
    </>
  );
}
