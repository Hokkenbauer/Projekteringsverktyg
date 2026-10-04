import { useMemo } from "react";
import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import type { Kataloger, Komponent } from "../../lib/typer";

type Props = {
  komponenter: Komponent[];
  kataloger: Kataloger;
  blinkar: Blink[];
  onAndra: (k: Komponent, falt: keyof Komponent & string, varde: string) => void;
  onNy: () => void;
  onTaBort: (ids: string[]) => void;
  lasläge?: boolean;
};

/** Förslag = katalogen från servern plus det som redan finns i projektet, utan dubbletter. */
function forslag(kataloger: Kataloger, komponenter: Komponent[], falt: keyof Kataloger & keyof Komponent) {
  const sett = new Set<string>();
  const ut: string[] = [];
  for (const v of [...komponenter.map((k) => String(k[falt] ?? "").trim()), ...(kataloger[falt] ?? [])]) {
    const nyckel = v.toLowerCase();
    if (v && !sett.has(nyckel)) { sett.add(nyckel); ut.push(v); }
  }
  return ut.sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));
}

export function KomponenterVy({ komponenter, kataloger, blinkar, onAndra, onNy, onTaBort, lasläge }: Props) {
  // Förslagen räknas om när katalogen hämtats eller antalet komponenter ändras, inte vid varje tangenttryckning.
  const antal = komponenter.length;
  const kolumner: Kolumn<Komponent>[] = useMemo(() => {
    const f = (falt: keyof Kataloger & keyof Komponent) => forslag(kataloger, komponenter, falt);
    return [
      { nyckel: "system", rubrik: "System", typ: "text", forslag: f("system"), bredd: 90 },
      { nyckel: "beteckning", rubrik: "Beteckning", typ: "text", mono: true, bredd: 130 },
      { nyckel: "komponenttyp", rubrik: "Komponenttyp", typ: "text", forslag: f("komponenttyp"), bredd: 150 },
      { nyckel: "signaltyp", rubrik: "Signal", typ: "text", forslag: f("signaltyp"), bredd: 70 },
      { nyckel: "placering", rubrik: "Placering", typ: "text", forslag: f("placering"), bredd: 160 },
      { nyckel: "beskrivning", rubrik: "Beskrivning", typ: "text", bredd: 220 },
      { nyckel: "anslutsTill", rubrik: "Ansluts till", typ: "text", mono: true },
      { nyckel: "kabeltyp", rubrik: "Kabeltyp", typ: "text", forslag: f("kabeltyp"), bredd: 130 },
      { nyckel: "produkttyp", rubrik: "Produkttyp", typ: "text", forslag: f("produkttyp"), bredd: 130 },
      { nyckel: "produkt", rubrik: "Produkt", typ: "text", forslag: f("produkt"), bredd: 160 },
      { nyckel: "monteringsanvisning", rubrik: "Monteringsanvisning", typ: "text", bredd: 180 },
      { nyckel: "ovrigt", rubrik: "Övrigt", typ: "text" },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kataloger, antal]);

  return (
    <>
      <div className="brodsmula">Komponenter &amp; Listor</div>
      <h1>Komponenter</h1>
      <p className="ingress">
        Projektets komponentregister. Listor, egenkontroll och placeringsritningar pekar hit. Fälten föreslår värden som
        redan använts i något projekt, och ett nytt värde blir automatiskt ett förslag nästa gång.
      </p>
      <DataGrid
        rader={komponenter}
        kolumner={kolumner}
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
