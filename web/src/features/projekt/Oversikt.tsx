import { useEffect, useRef, useState } from "react";
import { api, ApiFel, laddaNer } from "../../lib/api";
import { Dialog } from "../../shell/Dialog";
import type { Anteckningar, AttGora, Komponent, ListRad, Logg, Narvarande, Projekt } from "../../lib/typer";

const tid = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

type OversiktProps = {
  projekt: Projekt;
  komponenter: Komponent[];
  attGora: AttGora[];
  anteckningar: Anteckningar | null;
  logg: Logg[];
  narvaro: Narvarande[];
  onFlik: (f: string) => void;
  egenkontroll?: ListRad[];
  anmarkningar?: ListRad[];
  /** Projektledare och Admin får komplettera projektet från en importfil. */
  kanKomplettera?: boolean;
  onKompletterat?: () => void;
};

type KompletteringSvar = { rapport: string[]; varningar: string[]; sparad: boolean };

function felText(e: unknown): string {
  const data = e instanceof ApiFel ? (e.data as { errors?: Record<string, string[]> } | undefined) : undefined;
  return data?.errors ? Object.values(data.errors).flat().join(" ") : (e as Error).message;
}

/**
 * Komplettera projekt från importfil: en projektexport (.zip) läses in i DET HÄR projektet.
 * Det som finns känns igen (komponenter på beteckning, skåp och dokument på namn …) och uppdateras, nytt läggs till,
 * inget tas bort. Först visas vad som kommer att hända; inget sparas förrän man bekräftar.
 */
function KompletteraKnapp({ projekt, onKompletterat }: { projekt: Projekt; onKompletterat?: () => void }) {
  const filval = useRef<HTMLInputElement>(null);
  const [fil, setFil] = useState<File | null>(null);
  const [prov, setProv] = useState<KompletteringSvar | null>(null);
  const [klar, setKlar] = useState<KompletteringSvar | null>(null);
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState<string | null>(null);

  const skicka = async (f: File, provkor: boolean) => {
    const form = new FormData();
    form.append("fil", f, f.name);
    return api<KompletteringSvar>(`/api/projekt/${projekt.id}/komplettera?provkor=${provkor}`, { method: "POST", body: form });
  };
  const valj = async (f: File) => {
    setFil(f); setProv(null); setKlar(null); setFel(null); setArbetar(true);
    try { setProv(await skicka(f, true)); }
    catch (e) { setFel(`Filen kunde inte läsas: ${felText(e)}`); }
    finally { setArbetar(false); }
  };
  const genomfor = async () => {
    if (!fil) return;
    setArbetar(true); setFel(null);
    try { setKlar(await skicka(fil, false)); setProv(null); onKompletterat?.(); }
    catch (e) { setFel(`Kompletteringen misslyckades: ${felText(e)}`); }
    finally { setArbetar(false); }
  };
  const stang = () => { if (!arbetar) { setFil(null); setProv(null); setKlar(null); setFel(null); } };
  const visad = klar ?? prov;

  return (
    <>
      <button className="knapp" disabled={arbetar} onClick={() => filval.current?.click()}
        title="Läs in en projektexport (.zip) i det här projektet: befintligt uppdateras, nytt läggs till, inget tas bort">
        Komplettera från fil…
      </button>
      <input ref={filval} type="file" accept=".zip" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void valj(f); }} />
      <Dialog titel={klar ? "Projektet är kompletterat" : "Komplettera projektet från fil"} oppen={!!fil} onStang={stang} bred
        fot={<>
          {!klar && <button className="knapp primar" disabled={arbetar || !prov} onClick={() => void genomfor()}>{arbetar && prov ? "Kompletterar…" : "Komplettera projektet"}</button>}
          <button className="knapp" disabled={arbetar} onClick={stang}>{klar ? "Stäng" : "Avbryt"}</button>
        </>}>
        <p className="dampad">
          <b>{fil?.name}</b> läses in i <b>{projekt.namn}</b>. Komponenter känns igen på beteckning, apparatskåp, funktionstexter
          och ritbordsbilder på namn, att göra på text. Ifyllda uppgifter i filen ersätter projektets, nytt läggs till och ingenting tas bort.
          Allt loggas i ändringsloggen.
        </p>
        {arbetar && !prov && !klar && <p>Läser filen…</p>}
        {visad && <>
          <h3>{klar ? "Det här gjordes" : "Det här kommer att hända"}</h3>
          <ul>{visad.rapport.map((r) => <li key={r}>{r}</li>)}</ul>
          {visad.varningar.length > 0 && <><h3>Att observera</h3><ul>{visad.varningar.map((v) => <li key={v}>{v}</li>)}</ul></>}
        </>}
        {fel && <p className="felruta">{fel}</p>}
      </Dialog>
    </>
  );
}

/**
 * Projektexport: en ZIP med Excel (alla listor), funktionstexter i Word, texter, ritningar,
 * projektfiler och hela projektet maskinläsbart (projekt.json).
 */
function ProjektExportKnapp({ projekt }: { projekt: Projekt }) {
  const [medFiler, setMedFiler] = useState(true);
  const [arbetar, setArbetar] = useState(false);
  const [fel, setFel] = useState<string | null>(null);
  const exportera = async () => {
    setArbetar(true); setFel(null);
    try {
      await laddaNer(`/api/projekt/${projekt.id}/export?filer=${medFiler}`, `Projektexport ${projekt.nummer} ${projekt.namn}.zip`.replace(/\s+/g, " "));
    } catch (e) {
      setFel(`Exporten misslyckades: ${(e as Error).message}`);
    } finally {
      setArbetar(false);
    }
  };
  return (
    <div className="knappar projektexport">
      <label className="kontroll liten" title="PDF-ritningar, driftkort, Word-filer m.m. i Projektfiler. Kan göra filen stor.">
        <input type="checkbox" checked={medFiler} onChange={(e) => setMedFiler(e.target.checked)} /> Med projektfiler
      </label>
      <button className="knapp primar" disabled={arbetar} onClick={() => void exportera()}
        title="Allt viktigt i projektet i en ZIP-fil: Excel med alla listor, funktionstexter i Word, texter, ritningar och projektfiler">
        {arbetar ? "Exporterar…" : "Exportera projektet"}
      </button>
      {fel && <span className="felruta liten">{fel}</span>}
    </div>
  );
}

export function Oversikt({ projekt, komponenter, attGora, anteckningar, logg, narvaro, onFlik, egenkontroll, anmarkningar, kanKomplettera, onKompletterat }: OversiktProps) {
  const oppna = attGora.filter((a) => !a.klar);
  const komponentIds = new Set(komponenter.map((k) => k.id));
  const klaraEk = (egenkontroll ?? []).filter((r) => r.komponentId && komponentIds.has(r.komponentId) && r.data.kontrollerad === "true").length;
  const olosta = (anmarkningar ?? []).filter((r) => r.data.atgardad !== "true").length;
  const text = anteckningar?.text.trim() ?? "";

  return (
    <>
      <div className="brodsmula">Projekt</div>
      <div className="rubrikrad">
        <h1>{projekt.namn}</h1>
        <div className="knappar">
          {kanKomplettera && <KompletteraKnapp projekt={projekt} onKompletterat={onKompletterat} />}
          <ProjektExportKnapp projekt={projekt} />
        </div>
      </div>
      <p className="ingress">
        {[projekt.nummer, projekt.kund, projekt.ansvarig && `Ansvarig ${projekt.ansvarig}`].filter(Boolean).join(" · ")}
      </p>
      <div className="nyckeltal">
        <div className="tal"><span>Komponenter</span><b>{komponenter.length}</b><small>{new Set(komponenter.map((k) => k.system).filter(Boolean)).size} system</small></div>
        <button className="tal klickbar" onClick={() => onFlik("egenkontroll")}>
          <span>Klara egenkontroller</span><b>{egenkontroll ? klaraEk : "…"}</b><small>av {komponenter.length} komponenter</small>
        </button>
        <button className={`tal klickbar ${olosta ? "varning" : ""}`} onClick={() => onFlik("anmarkningsbilaga")}>
          <span>Olösta anmärkningar</span><b>{anmarkningar ? olosta : "…"}</b><small>av {anmarkningar?.length ?? 0} totalt</small>
        </button>
        <div className={`tal ${oppna.length ? "varning" : ""}`}><span>Att göra</span><b>{oppna.length}</b><small>av {attGora.length} kvar</small></div>
        <div className="tal"><span>Inloggade i projektet</span><b>{narvaro.length}</b><small>{narvaro.map((n) => n.namn.split(" ")[0]).join(", ") || "—"}</small></div>
      </div>

      <div className="tva">
        <section className="panel">
          <div className="panelhuvud">
            <h2>Att göra</h2>
            <button className="knapp" onClick={() => onFlik("att-gora")}>Öppna listan</button>
          </div>
          {attGora.length === 0 ? <p className="dampad">Inget i listan än.</p> : (
            <ul className="minilista">
              {[...oppna, ...attGora.filter((a) => a.klar)].slice(0, 8).map((a) => (
                <li key={a.id} className={a.klar ? "klar" : undefined}>
                  <span aria-hidden="true">{a.klar ? "☑" : "☐"}</span>
                  <span>{a.text || "(tom rad)"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <div className="panelhuvud">
            <h2>Anteckningar</h2>
            <button className="knapp" onClick={() => onFlik("anteckningar")}>Öppna anteckningar</button>
          </div>
          {text ? <pre className="utdrag">{text}</pre> : <p className="dampad">Inga anteckningar än.</p>}
        </section>
      </div>

      <section className="panel">
        <div className="panelhuvud">
          <h2>Senaste ändringar</h2>
          <button className="knapp" onClick={() => onFlik("andringslogg")}>Visa hela loggen</button>
        </div>
        <LoggLista logg={logg.slice(0, 8)} />
      </section>
    </>
  );
}

type LoggVyProps = { projektId: string; komponenter: Komponent[]; uppdaterad: number };

/** Ändringsloggen med filter per komponent och fritext, och export till Excel. */
export function LoggVy({ projektId, komponenter, uppdaterad }: LoggVyProps) {
  const [komponent, setKomponent] = useState("");
  const [sok, setSok] = useState("");
  const [logg, setLogg] = useState<Logg[] | null>(null);
  const [laddar, setLaddar] = useState(false);

  const fraga = () => {
    const p = new URLSearchParams({ antal: "500" });
    if (komponent) p.set("entitetId", komponent);
    if (sok.trim()) p.set("sok", sok.trim());
    return p;
  };

  useEffect(() => {
    const t = window.setTimeout(() => {
      api<Logg[]>(`/api/projekt/${projektId}/andringslogg?${fraga()}`).then(setLogg).catch(() => setLogg([]));
    }, 250);
    return () => window.clearTimeout(t);
    // fraga() bygger på komponent och sok
  }, [projektId, komponent, sok, uppdaterad]);

  const exportera = async () => {
    setLaddar(true);
    try {
      const p = fraga();
      p.delete("antal");
      await laddaNer(`/api/projekt/${projektId}/andringslogg/excel?${p}`, "Ändringslogg.xlsx");
    } finally {
      setLaddar(false);
    }
  };

  const sorterade = [...komponenter].sort((a, b) => a.beteckning.localeCompare(b.beteckning, "sv", { numeric: true }));

  return (
    <>
      <div className="brodsmula">Status</div>
      <h1>Ändringslogg</h1>
      <p className="ingress">Varje ändring i projektet sparas med vem, när, före och efter. Filtrera per komponent eller sök på text.</p>
      <div className="filterrad">
        <select aria-label="Komponent" value={komponent} onChange={(e) => setKomponent(e.target.value)}>
          <option value="">Alla ändringar</option>
          {sorterade.map((k) => <option key={k.id} value={k.id}>{k.beteckning || "(namnlös komponent)"}</option>)}
        </select>
        <input type="search" placeholder="Sök på text eller person" aria-label="Sök i loggen" value={sok} onChange={(e) => setSok(e.target.value)} />
        <button className="knapp" onClick={exportera} disabled={laddar}>{laddar ? "Exporterar…" : "Exportera Excel"}</button>
        <span className="antal">{logg ? `${logg.length} händelser` : ""}</span>
      </div>
      <section className="panel">
        {logg === null ? <p className="dampad">Hämtar…</p> : <LoggLista logg={logg} visaForeEfter />}
      </section>
    </>
  );
}

function LoggLista({ logg, visaForeEfter = false }: { logg: Logg[]; visaForeEfter?: boolean }) {
  if (logg.length === 0) return <p className="dampad">Inga ändringar.</p>;
  return (
    <ul className="logg">
      {logg.map((l) => (
        <li key={l.id}>
          <span className="loggtid">{tid(l.tidpunkt)}</span>
          <span><b>{l.anvandarNamn}</b> {l.beskrivning}</span>
          {visaForeEfter && l.falt && (
            <span className="foreefter">
              <del>{l.fore || "(tomt)"}</del> → <ins>{l.efter || "(tomt)"}</ins>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
