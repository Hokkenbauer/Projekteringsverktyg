import { useEffect, useState } from "react";
import { api, skicka } from "../../lib/api";
import { ROLLER, type AnvandarInfo, type Mig, type Roll, type StatusRubrik } from "../../lib/typer";

/** Administration: användarnas roller och de fasta rubrikerna i Projekt Status. Bara för admin. */
export function AdminVy({ mig, visaMeddelande }: { mig: Mig; visaMeddelande: (t: string) => void }) {
  const [anvandare, setAnvandare] = useState<AnvandarInfo[] | null>(null);
  const [rubriker, setRubriker] = useState<StatusRubrik[]>([]);
  const [nyRubrik, setNyRubrik] = useState("");

  const hamta = async () => {
    try {
      const [a, r] = await Promise.all([api<AnvandarInfo[]>("/api/anvandare"), api<StatusRubrik[]>("/api/statusrubriker")]);
      setAnvandare(a);
      setRubriker(r);
    } catch (e) { visaMeddelande((e as Error).message); }
  };
  useEffect(() => { void hamta(); }, []);

  const bytRoll = async (a: AnvandarInfo, roll: Roll) => {
    try {
      const ny = await api<AnvandarInfo>(`/api/anvandare/${encodeURIComponent(a.id)}/roll`, { method: "PUT", body: skicka({ roll }) });
      setAnvandare((l) => l?.map((x) => (x.id === ny.id ? ny : x)) ?? null);
      visaMeddelande(`${a.namn} är nu ${ROLLER.find((r) => r.id === roll)?.namn}.`);
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const sparaRubrik = async (r: StatusRubrik, namn: string, ordning: number) => {
    try {
      const ny = await api<StatusRubrik>(`/api/statusrubriker/${r.id}`, { method: "PUT", body: skicka({ namn, ordning }) });
      setRubriker((l) => l.map((x) => (x.id === ny.id ? ny : x)).sort((a, b) => a.ordning - b.ordning));
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const flytta = async (index: number, steg: -1 | 1) => {
    const a = rubriker[index], b = rubriker[index + steg];
    if (!a || !b) return;
    await sparaRubrik(a, a.namn, b.ordning);
    await sparaRubrik(b, b.namn, a.ordning);
  };

  const laggTillRubrik = async () => {
    if (!nyRubrik.trim()) return;
    try {
      const r = await api<StatusRubrik>("/api/statusrubriker", { method: "POST", body: skicka({ namn: nyRubrik }) });
      setRubriker((l) => [...l, r]);
      setNyRubrik("");
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const taBortRubrik = async (r: StatusRubrik) => {
    try {
      await api(`/api/statusrubriker/${r.id}`, { method: "DELETE" });
      setRubriker((l) => l.filter((x) => x.id !== r.id));
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  return (
    <main className="startsida">
      <div className="brodsmula">Administration</div>
      <h1>Användare och arbetsmetod</h1>

      <section className="panel">
        <h2>Användare och roller</h2>
        <p className="dampad" style={{ marginTop: 0 }}>
          Alla som loggat in någon gång. Nya användare blir Tekniker. Externa personer bjuds först in som gäster i
          Microsoft 365 (Entra), och dyker upp här när de loggat in.
        </p>
        {anvandare === null ? <p className="dampad">Hämtar…</p> : (
          <table className="enkel">
            <thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th>Senast inloggad</th></tr></thead>
            <tbody>
              {anvandare.map((a) => (
                <tr key={a.id}>
                  <td>{a.namn}{a.id === mig.id && <span className="dampad"> (du)</span>}</td>
                  <td className="mono">{a.epost}</td>
                  <td>
                    <select aria-label={`Roll för ${a.namn}`} value={a.roll} onChange={(e) => bytRoll(a, e.target.value as Roll)}>
                      {ROLLER.map((r) => <option key={r.id} value={r.id}>{r.namn}</option>)}
                    </select>
                  </td>
                  <td className="dampad">{new Date(a.senastInloggad).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Fasta rubriker i Projekt Status</h2>
        <p className="dampad" style={{ marginTop: 0 }}>Företagets arbetsmetod. Gäller alla projekt. Underrubriker läggs till i varje projekt.</p>
        <ul className="rubriklista">
          {rubriker.map((r, i) => (
            <li key={r.id}>
              <input aria-label="Rubrikens namn" defaultValue={r.namn} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== r.namn) void sparaRubrik(r, e.target.value, r.ordning); }} />
              <button className="ikonknapp" title="Flytta upp" disabled={i === 0} onClick={() => flytta(i, -1)}>↑</button>
              <button className="ikonknapp" title="Flytta ner" disabled={i === rubriker.length - 1} onClick={() => flytta(i, 1)}>↓</button>
              <button className="ikonknapp" title="Ta bort rubriken" onClick={() => taBortRubrik(r)}>✕</button>
            </li>
          ))}
        </ul>
        <form className="ny-underrubrik" onSubmit={(e) => { e.preventDefault(); void laggTillRubrik(); }}>
          <input placeholder="Ny rubrik" aria-label="Ny rubrik" value={nyRubrik} onChange={(e) => setNyRubrik(e.target.value)} />
          <button className="knapp" disabled={!nyRubrik.trim()}>Lägg till rubrik</button>
        </form>
      </section>
    </main>
  );
}
