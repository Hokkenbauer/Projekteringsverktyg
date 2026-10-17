import { useEffect, useState } from "react";
import { api, skicka } from "../../lib/api";
import { ROLLER, type AnvandarInfo, type Mig, type Roll, type StatusRubrik } from "../../lib/typer";

/** Administration: användarnas roller och de fasta rubrikerna i Projekt Status. Bara för admin. */
export function AdminVy({ mig, visaMeddelande }: { mig: Mig; visaMeddelande: (t: string) => void }) {
  const [anvandare, setAnvandare] = useState<AnvandarInfo[] | null>(null);
  const [rubriker, setRubriker] = useState<StatusRubrik[]>([]);
  const [nyRubrik, setNyRubrik] = useState("");
  // Bara ägaren kan göra någon till Admin eller ändra en administratör.
  const agare = !!mig.rattigheter.agare;

  const hamta = async () => {
    try {
      const [a, r] = await Promise.all([api<AnvandarInfo[]>("/api/anvandare"), api<StatusRubrik[]>("/api/statusrubriker")]);
      setAnvandare(a);
      setRubriker(r);
    } catch (e) { visaMeddelande((e as Error).message); }
  };
  useEffect(() => { void hamta(); }, []);

  const andra = async (a: AnvandarInfo, val: { roll?: Roll; farSkapaProjekt?: boolean; farAndraMallar?: boolean }, text: string) => {
    try {
      const ny = await api<AnvandarInfo>(`/api/anvandare/${encodeURIComponent(a.id)}/roll`, { method: "PUT", body: skicka(val) });
      setAnvandare((l) => l?.map((x) => (x.id === ny.id ? ny : x)) ?? null);
      visaMeddelande(text);
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
        <h2>Deltagare i Projekteringsverktyget</h2>
        <p className="dampad" style={{ marginTop: 0 }}>
          Alla som loggat in någon gång, och deras roll i <b>hela verktyget</b>. Vad någon får göra i ett visst projekt
          (Projektledare, Tekniker eller Läsare) väljs under Medlemmar i projektet.
          HECO-användare ser alla projekt och kan skapa projekt. Externa deltagare (inbjudna eller gäster från andra företag) ser bara
          projekt där de är medlemmar. Inbjudningar från ett projekt kan aldrig göra någon till Admin.
          Ägarens konto kan inte ändras av någon, och bara ägaren kan utse eller ta bort administratörer.
        </p>
        {anvandare === null ? <p className="dampad">Hämtar…</p> : (
          <table className="enkel">
            <thead><tr><th>Namn</th><th>E-post</th><th>Roll i verktyget</th><th title="Gäller externa; HECO-användare och Admin får alltid">Får skapa projekt</th><th>Får ändra mallar och kataloger</th><th>Senast inloggad</th></tr></thead>
            <tbody>
              {anvandare.map((a) => (
                <tr key={a.id}>
                  <td>{a.namn}{a.id === mig.id && <span className="dampad"> (du)</span>}</td>
                  <td className="mono">{a.epost}</td>
                  <td>
                    {a.agare ? <b title="Verktygets ägare. Kontot kan inte ändras av någon.">Ägare (Admin)</b> : (
                    <select aria-label={`Roll för ${a.namn}`} value={a.roll} title={ROLLER.find((r) => r.id === a.roll)?.text}
                      disabled={!agare && a.roll === "Admin"}
                      onChange={(e) => {
                        const roll = e.target.value as Roll;
                        if (roll === "Admin" && !window.confirm(`Göra ${a.namn} till Admin i hela verktyget? Admin ser och ändrar allt, även användare och mallar.`)) return;
                        void andra(a, { roll }, `${a.namn} är nu ${ROLLER.find((r) => r.id === roll)?.namn}.`);
                      }}>
                      {ROLLER.filter((r) => r.id !== "Admin" || agare || a.roll === "Admin").map((r) => <option key={r.id} value={r.id}>{r.namn}</option>)}
                    </select>)}
                  </td>
                  <td className="mitt">
                    <input type="checkbox" aria-label={`${a.namn} får skapa projekt`} disabled={a.agare || a.roll !== "Extern"}
                      checked={a.roll !== "Extern" || a.farSkapaProjekt}
                      onChange={(e) => void andra(a, { farSkapaProjekt: e.target.checked }, `${a.namn} ${e.target.checked ? "får nu" : "får inte längre"} skapa egna projekt.`)} />
                  </td>
                  <td className="mitt">
                    <input type="checkbox" aria-label={`${a.namn} får ändra mallar och kataloger`} disabled={a.agare || a.roll === "Admin"}
                      checked={a.roll === "Admin" || a.farAndraMallar}
                      onChange={(e) => void andra(a, { farAndraMallar: e.target.checked }, `${a.namn} ${e.target.checked ? "får nu" : "får inte längre"} ändra mallar och kataloger.`)} />
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
