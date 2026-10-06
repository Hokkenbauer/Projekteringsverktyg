import { useMemo, useRef, useState } from "react";
import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import { api, laddaNer, skicka } from "../../lib/api";
import type { Kataloger, Komponent } from "../../lib/typer";
import { KomponentMallDialog } from "./KomponentMallDialog";

type Props = {
  projektId: string;
  kanHanteraMallar: boolean;
  /** Hämtar om komponenterna (efter import eller mall). */
  onUppdatera: () => void;
  visaMeddelande: (t: string) => void;
  komponenter: Komponent[];
  kataloger: Kataloger;
  blinkar: Blink[];
  onAndra: (k: Komponent, falt: keyof Komponent & string, varde: string) => void;
  onNy: () => void;
  onTaBort: (ids: string[]) => void;
  lasläge?: boolean;
  onInfo: (k: Komponent) => void;
  fokusId?: string | null;
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

const MALLFALT = ["beteckning", "system", "komponenttyp", "signaltyp", "placering", "beskrivning", "ovrigt", "anslutsTill", "kabeltyp", "produkttyp", "produkt", "monteringsanvisning"] as const;

export function KomponenterVy({
  projektId, kanHanteraMallar, onUppdatera, visaMeddelande, komponenter, kataloger, blinkar, onAndra, onNy, onTaBort, lasläge, onInfo, fokusId,
}: Props) {
  const [mallOppen, setMallOppen] = useState(false);
  const [importerar, setImporterar] = useState(false);
  const filval = useRef<HTMLInputElement>(null);

  const importera = async (fil: File) => {
    const form = new FormData();
    form.append("fil", fil, fil.name);
    setImporterar(true);
    try {
      const svar = await api<{ antal: number }>(`/api/projekt/${projektId}/komponenter/import`, { method: "POST", body: form });
      visaMeddelande(`${svar.antal} komponenter importerade från ${fil.name}.`);
      onUppdatera();
    } catch (e) {
      visaMeddelande(`Importen misslyckades: ${(e as Error).message}`);
    } finally {
      setImporterar(false);
      if (filval.current) filval.current.value = "";
    }
  };

  const sparaSomMall = async (ids: string[]) => {
    const valda = komponenter.filter((k) => ids.includes(k.id));
    const namn = window.prompt(`Namn på mallen (${valda.length} komponenter). Skriv xx där numret ska bytas, t.ex. LBxx-GT11.`);
    if (!namn?.trim()) return;
    const rader = valda.map((k) => Object.fromEntries(MALLFALT.map((f) => [f, k[f]]).filter(([, v]) => v)));
    try {
      await api("/api/komponentmallar", { method: "POST", body: skicka({ namn, rader }) });
      visaMeddelande(`Mallen ${namn} är sparad.`);
    } catch (e) {
      if ((e as { status?: number }).status === 409 && window.confirm(`Det finns redan en mall som heter ${namn}. Skriva över den?`)) {
        await api("/api/komponentmallar", { method: "POST", body: skicka({ namn, rader, skrivOver: true }) });
        visaMeddelande(`Mallen ${namn} är uppdaterad.`);
      } else if ((e as { status?: number }).status !== 409) {
        visaMeddelande(`Mallen kunde inte sparas: ${(e as Error).message}`);
      }
    }
  };

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
      { nyckel: "produkt", rubrik: "Fabrikat", typ: "text", forslag: f("produkt"), bredd: 160 },
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
        onInfo={onInfo}
        fokusId={fokusId}
        markeradeVerktyg={kanHanteraMallar ? (ids) => (
          <button className="knapp" disabled={ids.length === 0} onClick={() => void sparaSomMall(ids)}>Spara markerade som mall</button>
        ) : undefined}
        verktyg={<>
          {!lasläge && <button className="knapp" onClick={() => setMallOppen(true)}>Lägg till från mall</button>}
          {!lasläge && (
            <>
              <input ref={filval} type="file" accept=".xlsx,.csv,.txt" hidden onChange={(e) => e.target.files?.[0] && void importera(e.target.files[0])} />
              <button className="knapp" disabled={importerar} onClick={() => filval.current?.click()}>{importerar ? "Importerar…" : "Importera Excel/CSV"}</button>
            </>
          )}
          <button className="knapp" onClick={() => void laddaNer(`/api/projekt/${projektId}/komponenter/excel`, "Komponenter.xlsx").catch((e) => visaMeddelande((e as Error).message))}>Exportera Excel</button>
        </>}
      />
      <KomponentMallDialog
        projektId={projektId} oppen={mallOppen} onStang={() => setMallOppen(false)} kanHanteraMallar={kanHanteraMallar}
        onKlar={(n) => { visaMeddelande(`${n} komponenter tillagda från mallen.`); onUppdatera(); }}
        visaMeddelande={visaMeddelande}
      />
    </>
  );
}
