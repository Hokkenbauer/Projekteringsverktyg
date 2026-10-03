import type { Komponent, Logg, Narvarande, Projekt } from "../../lib/typer";

const tid = (iso: string) =>
  new Date(iso).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });

export function Oversikt({ projekt, komponenter, logg, narvaro, onFlik }: {
  projekt: Projekt; komponenter: Komponent[]; logg: Logg[]; narvaro: Narvarande[]; onFlik: (f: string) => void;
}) {
  const system = new Set(komponenter.map((k) => k.system).filter(Boolean)).size;
  const utanTyp = komponenter.filter((k) => !k.komponenttyp).length;

  return (
    <>
      <div className="brodsmula">Projekt</div>
      <h1>{projekt.namn}</h1>
      <p className="ingress">
        {[projekt.nummer, projekt.kund, projekt.ansvarig && `Ansvarig ${projekt.ansvarig}`].filter(Boolean).join(" · ")}
      </p>
      <div className="nyckeltal">
        <div className="tal"><span>Komponenter</span><b>{komponenter.length}</b><small>{system} system</small></div>
        <div className={`tal ${utanTyp ? "varning" : ""}`}><span>Saknar komponenttyp</span><b>{utanTyp}</b><small>att komplettera</small></div>
        <div className="tal"><span>I projektet nu</span><b>{narvaro.length}</b><small>{narvaro.map((n) => n.namn.split(" ")[0]).join(", ") || "—"}</small></div>
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

export function LoggVy({ logg }: { logg: Logg[] }) {
  return (
    <>
      <div className="brodsmula">Status</div>
      <h1>Ändringslogg</h1>
      <p className="ingress">Varje ändring i projektet sparas med vem, när, före och efter. De senaste 100 visas.</p>
      <section className="panel"><LoggLista logg={logg} visaForeEfter /></section>
    </>
  );
}

function LoggLista({ logg, visaForeEfter = false }: { logg: Logg[]; visaForeEfter?: boolean }) {
  if (logg.length === 0) return <p className="dampad">Inga ändringar än.</p>;
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
