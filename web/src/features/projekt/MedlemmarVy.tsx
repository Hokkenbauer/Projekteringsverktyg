import { useEffect, useState } from "react";
import { api, skicka } from "../../lib/api";
import { rollNamn, type AnvandarInfo, type Medlem, type Rattigheter } from "../../lib/typer";

type Props = { projektId: string; rattigheter: Rattigheter; visaMeddelande: (t: string) => void };

export function MedlemmarVy({ projektId, rattigheter, visaMeddelande }: Props) {
  const [medlemmar, setMedlemmar] = useState<Medlem[] | null>(null);
  const [alla, setAlla] = useState<AnvandarInfo[]>([]);
  const [vald, setVald] = useState("");
  const kanHantera = rattigheter.hanteraMedlemmar;

  const hamta = () => api<Medlem[]>(`/api/projekt/${projektId}/medlemmar`).then(setMedlemmar).catch((e) => visaMeddelande((e as Error).message));
  useEffect(() => {
    void hamta();
    if (kanHantera) api<AnvandarInfo[]>("/api/anvandare").then(setAlla).catch(() => setAlla([]));
  }, [projektId, kanHantera]);

  const laggTill = async () => {
    if (!vald) return;
    try {
      await api(`/api/projekt/${projektId}/medlemmar`, { method: "POST", body: skicka({ anvandarId: vald }) });
      setVald("");
      await hamta();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const taBort = async (m: Medlem) => {
    try {
      await api(`/api/projekt/${projektId}/medlemmar/${encodeURIComponent(m.anvandarId)}`, { method: "DELETE" });
      await hamta();
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const ejMedlemmar = alla.filter((a) => !medlemmar?.some((m) => m.anvandarId === a.id));

  return (
    <>
      <div className="brodsmula">Projekt</div>
      <h1>Medlemmar</h1>
      <p className="ingress">
        Tekniker och läsare ser bara projekt där de är medlemmar. Admin, projektledare och system ser alla projekt.
        Personen måste ha loggat in i appen minst en gång för att kunna läggas till.
      </p>
      {kanHantera && (
        <div className="filterrad">
          <select aria-label="Välj person" value={vald} onChange={(e) => setVald(e.target.value)}>
            <option value="">Välj person att lägga till…</option>
            {ejMedlemmar.map((a) => <option key={a.id} value={a.id}>{a.namn} ({rollNamn(a.roll)})</option>)}
          </select>
          <button className="knapp primar" disabled={!vald} onClick={laggTill}>Lägg till i projektet</button>
        </div>
      )}
      <section className="panel">
        {medlemmar === null ? <p className="dampad">Hämtar…</p> : medlemmar.length === 0 ? <p className="dampad">Inga medlemmar än.</p> : (
          <table className="enkel">
            <thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th>Tillagd</th>{kanHantera && <th />}</tr></thead>
            <tbody>
              {medlemmar.map((m) => (
                <tr key={m.anvandarId}>
                  <td>{m.namn}</td>
                  <td className="mono">{m.epost}</td>
                  <td>{rollNamn(m.roll)}</td>
                  <td className="dampad">{new Date(m.tillagd).toLocaleDateString("sv-SE")} av {m.tillagdAv}</td>
                  {kanHantera && <td><button className="knapp fara" onClick={() => taBort(m)}>Ta bort</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
