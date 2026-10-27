import { useEffect, useMemo, useRef, useState } from "react";
import { DataGrid, type Kolumn } from "../../grid/DataGrid";
import { api } from "../../lib/api";
import { skrivExcel } from "../../lib/excelFil";
import { franNamn, produktNamn, tomProdukt, useProduktregister, type Produkt, type Produktregister } from "../../lib/produkter";
import type { Kataloger } from "../../lib/typer";

/** En rad i tabellen: produktens fält som text (Utgången som "true"/""), plus det räknade namnet. */
type Rad = { [K in Exclude<keyof Produkt, "utgatt">]: string } & { utgatt: string; namn: string };

const BEDOMNING = ["Rekommenderas", "Accepteras", "Undviks", "Ej bedömd"];
const SUNDA_HUS = ["A", "B", "C+", "C-", "D", "Ej bedömd"];

type Props = {
  kanHantera: boolean;
  visaMeddelande: (t: string) => void;
};

/**
 * Verktyg → Produktregister: gemensamt för alla projekt. Admin och de som får ändra mallar och kataloger kan
 * lägga till, ändra och ta bort. Produkterna föreslås i komponentens fält Produkt; väljs en produkt fylls
 * komponenttyp och I/O i (om de är tomma) och Kraftberäkningen hämtar strömmen.
 */
export function ProduktregisterVy({ kanHantera, visaMeddelande }: Props) {
  const reg = useProduktregister();
  const [lokal, setLokal] = useState<Produktregister | null>(null);
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const [iProjekten, setIProjekten] = useState<string[]>([]);
  const timer = useRef<number | undefined>(undefined);
  const sparaRef = useRef(reg.spara);
  sparaRef.current = reg.spara;

  useEffect(() => { if (status === "sparat" && reg.data) setLokal(reg.data); }, [reg.data]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    api<Kataloger>("/api/kataloger").then((k) => setIProjekten(k.produkttyp ?? [])).catch(() => setIProjekten([]));
  }, []);

  /** Ändringar sparas samlat en kort stund efter sista ändringen (hela registret skickas). */
  const andra = (ny: Produktregister) => {
    setLokal(ny);
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setStatus("sparar");
      try { await sparaRef.current(ny); setStatus("sparat"); }
      catch (e) { setStatus("sparat"); visaMeddelande((e as Error).message); }
    }, 700);
  };

  const produkter = lokal?.produkter ?? [];
  const rader: Rad[] = useMemo(() => produkter.map((p) => ({
    ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "boolean" ? (v ? "true" : "") : String(v ?? "")])),
    namn: produktNamn(p),
  }) as Rad), [produkter]);

  const sattFalt = (rad: Rad, nyckel: keyof Rad, varde: string) => {
    if (nyckel === "namn") return;
    andra({ produkter: produkter.map((p) => (p.id === rad.id ? { ...p, [nyckel]: nyckel === "utgatt" ? varde === "true" : varde } : p)) });
  };

  const namnRegister = new Set(produkter.map((p) => produktNamn(p).toLowerCase()));
  const dubbletter = produkter.length - namnRegister.size;
  const saknas = useMemo(() => [...new Set(iProjekten.map((v) => v.trim()).filter((v) => v && !namnRegister.has(v.toLowerCase())))]
    .sort((a, b) => a.localeCompare(b, "sv", { numeric: true })), [iProjekten, produkter]);

  const laggTill = (namn: string[]) => andra({ produkter: [...produkter, ...namn.map(franNamn)] });

  const kolumner: Kolumn<Rad>[] = [
    { nyckel: "fabrikat", rubrik: "Fabrikat", typ: "text", bredd: 120, forslag: [...new Set(produkter.map((p) => p.fabrikat).filter(Boolean))] },
    { nyckel: "modell", rubrik: "Modell", typ: "text", mono: true, bredd: 150 },
    { nyckel: "komponenttyp", rubrik: "Komponenttyp", typ: "text", bredd: 150, forslag: [...new Set(produkter.map((p) => p.komponenttyp).filter(Boolean))] },
    { nyckel: "io", rubrik: "I/O", typ: "text", mono: true, bredd: 100 },
    { nyckel: "stromA", rubrik: "Ström (A)", typ: "text", mono: true, bredd: 80 },
    { nyckel: "fas", rubrik: "Faser", typ: "val", val: ["1", "3"], bredd: 70 },
    { nyckel: "artikelnummer", rubrik: "Artikelnr / E-nr", typ: "text", mono: true, bredd: 120 },
    { nyckel: "leverantor", rubrik: "Leverantör", typ: "text", bredd: 120 },
    { nyckel: "bedomning", rubrik: "Byggvarubedömning", typ: "val", val: BEDOMNING, bredd: 130 },
    { nyckel: "sundaHus", rubrik: "Sunda Hus", typ: "val", val: SUNDA_HUS, bredd: 90 },
    { nyckel: "datablad", rubrik: "Datablad (länk)", typ: "text", bredd: 160 },
    { nyckel: "kommentar", rubrik: "Kommentar", typ: "text", fyll: true },
    { nyckel: "utgatt", rubrik: "Utgången", typ: "kryss" },
  ];

  const excel = () => void skrivExcel("Produktregister", [{
    namn: "Produkter",
    bredder: [16, 22, 20, 12, 10, 8, 16, 16, 18, 10, 30, 30, 10],
    rader: [kolumner.map((k) => k.rubrik), ...rader.map((r) => kolumner.map((k) => (k.nyckel === "utgatt" ? (r.utgatt ? "Ja" : "") : r[k.nyckel])))],
  }]).catch((e) => visaMeddelande((e as Error).message));

  return (
    <>
      <div className="brodsmula">Verktyg</div>
      <div className="rubrikrad">
        <h1>Produktregister</h1>
        <div className="knappar"><button className="knapp" onClick={excel}>Exportera till Excel</button></div>
      </div>
      <p className="ingress">
        Gemensamt för alla projekt. Produkterna föreslås i komponentens fält <b>Produkt</b> (fabrikat + modell). Väljs en produkt fylls
        komponenttyp och I/O i om de är tomma, och Kraftberäkningen hämtar strömmen (3 faser = samma ström på L1–L3).
        Utgångna produkter föreslås inte men finns kvar i gamla projekt.
        {!kanHantera && " Bara Admin och de som får ändra mallar och kataloger kan ändra registret."}
        {status === "sparar" ? " Sparar…" : status === "osparat" ? " Osparade ändringar…" : ""}
        {reg.info.andradAv && status === "sparat" && <span className="dampad"> Senast ändrat av {reg.info.andradAv}.</span>}
      </p>

      {kanHantera && saknas.length > 0 && (
        <details className="gw-tips produkt-saknas">
          <summary><b>{saknas.length} produkter används i projekten men finns inte i registret</b> – visa och lägg till</summary>
          <p className="dampad liten">Första ordet blir fabrikat, resten modell. Felstavade värden behöver inte läggas till; rätta dem i projektet i stället.</p>
          <ul>
            {saknas.map((n) => <li key={n}><span className="mono">{n}</span> <button className="knapp liten" onClick={() => laggTill([n])}>Lägg till</button></li>)}
          </ul>
          <button className="knapp" onClick={() => laggTill(saknas)}>Lägg till alla {saknas.length}</button>
        </details>
      )}
      {dubbletter > 0 && <p className="dampad liten">{dubbletter} produkter har samma fabrikat och modell som en annan. Ta bort dubbletterna.</p>}

      {lokal === null ? <p className="dampad">Hämtar…</p> : (
        <DataGrid
          rader={rader}
          kolumner={kolumner}
          sokPlatshallare="Sök produkt, fabrikat, komponenttyp …"
          lasläge={!kanHantera}
          onAndra={sattFalt}
          onNy={() => andra({ produkter: [...produkter, tomProdukt()] })}
          onTaBort={(ids) => {
            if (window.confirm(`Ta bort ${ids.length} produkter ur registret? Komponenter som redan har produkten behåller namnet.`))
              andra({ produkter: produkter.filter((p) => !ids.includes(p.id)) });
          }}
        />
      )}
    </>
  );
}
