import { useEffect, useState } from "react";
import { api, laddaNer } from "../../lib/api";
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
};

export function Oversikt({ projekt, komponenter, attGora, anteckningar, logg, narvaro, onFlik, egenkontroll, anmarkningar }: OversiktProps) {
  const oppna = attGora.filter((a) => !a.klar);
  const komponentIds = new Set(komponenter.map((k) => k.id));
  const klaraEk = (egenkontroll ?? []).filter((r) => r.komponentId && komponentIds.has(r.komponentId) && r.data.kontrollerad === "true").length;
  const olosta = (anmarkningar ?? []).filter((r) => r.data.atgardad !== "true").length;
  const text = anteckningar?.text.trim() ?? "";

  return (
    <>
      <div className="brodsmula">Projekt</div>
      <h1>{projekt.namn}</h1>
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
