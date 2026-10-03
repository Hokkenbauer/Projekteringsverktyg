import { useEffect, useState, type FormEvent } from "react";
import { api, skicka } from "../../lib/api";
import type { Projekt } from "../../lib/typer";

export function ProjektLista({ onOppna }: { onOppna: (id: string) => void }) {
  const [projekt, setProjekt] = useState<Projekt[] | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [nytt, setNytt] = useState({ namn: "", nummer: "", kund: "" });
  const [sparar, setSparar] = useState(false);

  useEffect(() => {
    api<Projekt[]>("/api/projekt").then(setProjekt).catch((e) => setFel(String(e.message ?? e)));
  }, []);

  const skapa = async (e: FormEvent) => {
    e.preventDefault();
    if (!nytt.namn.trim()) return;
    setSparar(true);
    try {
      const p = await api<Projekt>("/api/projekt", { method: "POST", body: skicka(nytt) });
      onOppna(p.id);
    } catch (err) {
      setFel(String((err as Error).message));
    } finally {
      setSparar(false);
    }
  };

  return (
    <main className="startsida">
      <div className="brodsmula">Projekteringsverktyg</div>
      <h1>Projekt</h1>
      {fel && <p className="felruta">Det gick inte att hämta projekten: {fel}</p>}

      <section className="panel">
        <h2>Nytt projekt</h2>
        <form className="nytt-projekt" onSubmit={skapa}>
          <label>Projektnamn<input required value={nytt.namn} onChange={(e) => setNytt({ ...nytt, namn: e.target.value })} placeholder="Kv. Lärkan 4 – Ombyggnad ventilation" /></label>
          <label>Projektnummer<input value={nytt.nummer} onChange={(e) => setNytt({ ...nytt, nummer: e.target.value })} placeholder="P-2026-118" /></label>
          <label>Kund<input value={nytt.kund} onChange={(e) => setNytt({ ...nytt, kund: e.target.value })} /></label>
          <button className="knapp primar" disabled={sparar || !nytt.namn.trim()}>{sparar ? "Skapar…" : "Skapa projekt"}</button>
        </form>
      </section>

      <section className="panel">
        <h2>Alla projekt</h2>
        {projekt === null && !fel && <p className="dampad">Hämtar…</p>}
        {projekt?.length === 0 && <p className="dampad">Inga projekt än. Skapa det första ovan.</p>}
        {!!projekt?.length && (
          <ul className="projektlista">
            {projekt.map((p) => (
              <li key={p.id}>
                <button onClick={() => onOppna(p.id)}>
                  <b>{p.namn}</b>
                  <span>{[p.nummer, p.kund].filter(Boolean).join(" · ") || "—"}</span>
                  <span className="dampad">{p.antalKomponenter} komponenter · skapat av {p.skapadAv}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
