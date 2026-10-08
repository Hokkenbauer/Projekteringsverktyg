import { useMemo, useRef, useState } from "react";
import { api, skicka } from "../../lib/api";
import { lasExcel, tolkaRubriker } from "../../lib/excelFil";
import { useKatalog } from "../../lib/katalog";
import type { ListRad } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

/** En vara i den gemensamma byggvarudatabasen. */
export type Byggvara = {
  id: string; beskrivning: string; komponent: string; artikelnamn: string; artikelnummer: string;
  fabrikat: string; leverantor: string; bedomning: string;
};
type Databas = { varor: Byggvara[] };
const TOM: Databas = { varor: [] };

const FALT: (keyof Omit<Byggvara, "id">)[] = ["beskrivning", "komponent", "artikelnamn", "artikelnummer", "fabrikat", "leverantor", "bedomning"];

/** Rubriker i Excel-filer (t.ex. export från Sunda Hus) som motsvarar fälten. */
const MONSTER: Record<string, RegExp> = {
  artikelnummer: /artikel ?n(r|ummer)|art\.? ?nr|e-? ?n(r|ummer)|rsk|gtin|ean/,
  artikelnamn: /artikelnamn|produktnamn|produkt|benämning|^namn/,
  fabrikat: /tillverkare|fabrikat|varumärke/,
  leverantor: /leverantör|leverantor/,
  bedomning: /bedömning|bedomning|klassning|klass|status/,
  komponent: /användning|byggdel|varugrupp|kategori|komponent/,
  beskrivning: /beskrivning|kommentar|anmärkning|notering/,
};

const nyckel = (v: Pick<Byggvara, "artikelnummer" | "artikelnamn">) =>
  (v.artikelnummer.trim() || v.artikelnamn.trim()).toLowerCase();

/** Tolkar ett Excel-blad till varor. Rader utan artikelnamn och artikelnummer hoppas över. */
export function excelTillVaror(rader: string[][]): Byggvara[] | null {
  const t = tolkaRubriker(rader, MONSTER);
  if (!t) return null;
  return rader.slice(t.rubrikrad + 1).map((r) => {
    const v = { id: crypto.randomUUID() } as Byggvara;
    for (const f of FALT) v[f] = t.kolumn[f] !== undefined ? (r[t.kolumn[f]!] ?? "").trim() : "";
    return v;
  }).filter((v) => v.artikelnamn || v.artikelnummer);
}

/** Varans fält som rad i projektets lista (Byggvarubedömning eller Sunda Hus). */
function tillRad(lista: string, v: Byggvara): Record<string, string> {
  return lista === "sundahus"
    ? { artikelnamn: v.artikelnamn, artikelnummer: v.artikelnummer, fabrikat: v.fabrikat, leverantor: v.leverantor, bedomning: v.bedomning, anvandning: v.komponent || v.beskrivning, kommentar: "" }
    : { beskrivning: v.beskrivning, komponent: v.komponent, artikelnamn: v.artikelnamn, artikelnummer: v.artikelnummer, fabrikat: v.fabrikat, leverantor: v.leverantor, ovrigt: "" };
}
function franRad(lista: string, d: Record<string, string>): Byggvara {
  return {
    id: crypto.randomUUID(),
    beskrivning: lista === "sundahus" ? "" : d.beskrivning ?? "",
    komponent: lista === "sundahus" ? d.anvandning ?? "" : d.komponent ?? "",
    artikelnamn: d.artikelnamn ?? "", artikelnummer: d.artikelnummer ?? "", fabrikat: d.fabrikat ?? "",
    leverantor: d.leverantor ?? "", bedomning: d.bedomning ?? "",
  };
}

type Props = {
  lista: "byggvarubedomning" | "sundahus";
  projektId: string;
  rader: ListRad[] | undefined;
  lasläge: boolean;
  kanRedigeraKatalog: boolean;
  visaMeddelande: (t: string) => void;
};

/** Knappar och dialog för Byggvarubedömning och Sunda Hus: hämta från byggvarudatabasen och importera Excel. */
export function ByggvaruKnappar(p: Props) {
  const db = useKatalog<Databas>("byggvaror", TOM);
  const [oppen, setOppen] = useState(false);
  const [sok, setSok] = useState("");
  const [valda, setValda] = useState<Set<string>>(new Set());
  const [arbetar, setArbetar] = useState(false);
  const importFil = useRef<HTMLInputElement>(null);
  const dbFil = useRef<HTMLInputElement>(null);

  const varor = db.data?.varor ?? [];
  const synliga = useMemo(() => {
    const s = sok.trim().toLowerCase();
    return !s ? varor : varor.filter((v) => FALT.some((f) => v[f].toLowerCase().includes(s)));
  }, [varor, sok]);
  const iProjektet = useMemo(() => new Set((p.rader ?? []).map((r) => nyckel({ artikelnummer: r.data.artikelnummer ?? "", artikelnamn: r.data.artikelnamn ?? "" }))), [p.rader]);

  const laggTill = async (lista: Byggvara[]) => {
    if (!lista.length) return;
    setArbetar(true);
    try {
      await api(`/api/projekt/${p.projektId}/listor/${p.lista}/flera`, { method: "POST", body: skicka(lista.map((v) => tillRad(p.lista, v))) });
      p.visaMeddelande(`${lista.length} ${lista.length === 1 ? "vara" : "varor"} tillagda.`);
      setValda(new Set());
      setOppen(false);
    } catch (e) { p.visaMeddelande(`Varorna kunde inte läggas till: ${(e as Error).message}`); }
    finally { setArbetar(false); }
  };

  const importeraTillProjektet = async (fil: File) => {
    try {
      const varorIFil = excelTillVaror(await lasExcel(fil));
      if (!varorIFil) { p.visaMeddelande("Hittade inga kända rubriker i filen (t.ex. Artikelnamn, Artikelnummer, Leverantör, Bedömning)."); return; }
      if (!varorIFil.length) { p.visaMeddelande("Filen innehåller inga varor."); return; }
      await laggTill(varorIFil);
    } catch (e) { p.visaMeddelande(`Filen kunde inte läsas: ${(e as Error).message}`); }
  };

  // ---- Databasen (Admin, Projektledare, System) ----
  const sparaDb = async (ny: Byggvara[], klart: string) => {
    try { await db.spara({ varor: ny }); p.visaMeddelande(klart); } catch (e) { p.visaMeddelande((e as Error).message); }
  };
  const slaIhop = (nya: Byggvara[]) => {
    const finns = new Set(varor.map(nyckel));
    const unika = nya.filter((v) => { const k = nyckel(v); if (!k || finns.has(k)) return false; finns.add(k); return true; });
    return unika;
  };
  const importeraTillDb = async (fil: File) => {
    try {
      const nya = excelTillVaror(await lasExcel(fil));
      if (!nya) { p.visaMeddelande("Hittade inga kända rubriker i filen (t.ex. Artikelnamn, Artikelnummer, Leverantör)."); return; }
      const unika = slaIhop(nya);
      await sparaDb([...varor, ...unika], `${unika.length} nya varor i databasen${nya.length > unika.length ? ` (${nya.length - unika.length} fanns redan)` : ""}.`);
    } catch (e) { p.visaMeddelande(`Filen kunde inte läsas: ${(e as Error).message}`); }
  };
  const sparaProjektetsRader = async () => {
    const unika = slaIhop((p.rader ?? []).map((r) => franRad(p.lista, r.data)));
    if (!unika.length) { p.visaMeddelande("Alla projektets varor finns redan i databasen."); return; }
    await sparaDb([...varor, ...unika], `${unika.length} varor från projektet sparade i databasen.`);
  };
  const taBortValda = async () => {
    if (!valda.size || !window.confirm(`Ta bort ${valda.size} varor ur byggvarudatabasen? Det gäller alla projekt.`)) return;
    await sparaDb(varor.filter((v) => !valda.has(v.id)), `${valda.size} varor borttagna ur databasen.`);
    setValda(new Set());
  };

  return (
    <>
      {!p.lasläge && <button className="knapp" onClick={() => setOppen(true)}>Hämta från byggvarudatabasen…</button>}
      {!p.lasläge && p.lista === "sundahus" && (
        <>
          <button className="knapp" onClick={() => importFil.current?.click()}>Importera från Sunda Hus (Excel)…</button>
          <input ref={importFil} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importeraTillProjektet(f); }} />
        </>
      )}
      <Dialog
        titel="Byggvarudatabasen" oppen={oppen} onStang={() => setOppen(false)} bred
        fot={<>
          <span className="dampad">{varor.length} varor i databasen{db.info.andradAv ? ` · senast ändrad av ${db.info.andradAv}` : ""}</span>
          {p.kanRedigeraKatalog && (
            <>
              <button className="knapp" onClick={() => dbFil.current?.click()}>Importera Excel till databasen…</button>
              <button className="knapp" onClick={() => void sparaProjektetsRader()} title="Lägger in projektets varor i databasen så att andra projekt kan hämta dem">Spara projektets varor i databasen</button>
              <button className="knapp fara" disabled={!valda.size} onClick={() => void taBortValda()}>Ta bort valda ur databasen</button>
            </>
          )}
          <button className="knapp primar" disabled={!valda.size || arbetar} onClick={() => void laggTill(varor.filter((v) => valda.has(v.id)))}>
            Lägg till valda i projektet ({valda.size})
          </button>
        </>}
      >
        <input ref={dbFil} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importeraTillDb(f); }} />
        <input className="sok" type="search" placeholder="Sök artikel, fabrikat, leverantör…" value={sok} onChange={(e) => setSok(e.target.value)} style={{ width: "100%", marginBottom: 10 }} autoFocus />
        {db.data === null ? <p className="dampad">Hämtar…</p> : varor.length === 0 ? (
          <p className="tomruta">
            Databasen är tom.{p.kanRedigeraKatalog ? " Importera en Excel-fil med varor, eller spara projektets varor i databasen." : " Be en projektledare att fylla på den."}
          </p>
        ) : (
          <table className="enkel tat valbar">
            <thead><tr><th /><th>Artikelnamn</th><th>Artikelnr</th><th>Fabrikat</th><th>Leverantör</th><th>Komponent</th><th>Bedömning</th></tr></thead>
            <tbody>
              {synliga.slice(0, 500).map((v) => (
                <tr key={v.id} className={iProjektet.has(nyckel(v)) ? "dampad" : ""} onClick={() => setValda((s) => { const n = new Set(s); if (n.has(v.id)) n.delete(v.id); else n.add(v.id); return n; })}>
                  <td><input type="checkbox" checked={valda.has(v.id)} readOnly aria-label={`Välj ${v.artikelnamn}`} /></td>
                  <td>{v.artikelnamn}{iProjektet.has(nyckel(v)) && <span className="chip liten">finns i projektet</span>}</td>
                  <td className="mono">{v.artikelnummer}</td><td>{v.fabrikat}</td><td>{v.leverantor}</td><td>{v.komponent || v.beskrivning}</td><td>{v.bedomning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {synliga.length > 500 && <p className="dampad liten">Visar de första 500. Sök för att hitta fler.</p>}
      </Dialog>
    </>
  );
}
