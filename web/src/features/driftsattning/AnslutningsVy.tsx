import { useState } from "react";
import { useDokument } from "../../lib/dokument";
import type { ProjektDokument } from "../../lib/typer";

type Konto = { anvandarnamn: string; losenord: string; kommentar: string };
type Enhet = { adress: string; beskrivning: string; konton: Konto[] };
const TOM: Enhet = { adress: "", beskrivning: "", konton: [] };
const las = (d: ProjektDokument): Enhet => { try { return { ...TOM, ...JSON.parse(d.data || "{}") }; } catch { return { ...TOM }; } };

/** Slumpat lösenord utan tecken som är lätta att blanda ihop (0/O, 1/l/I). */
export function nyttLosenord(langd = 16): string {
  const tecken = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!#%&*+-=?";
  const slump = new Uint32Array(langd);
  crypto.getRandomValues(slump);
  return [...slump].map((n) => tecken[n % tecken.length]).join("");
}

type Props = {
  projektId: string;
  grupp: string;
  rubrik: string;
  /** Rollen får se anslutningsinformation (Admin, Projektledare, System). Servern kontrollerar också. */
  far: boolean;
  lasläge: boolean;
  uppdaterad: number;
  visaMeddelande: (t: string) => void;
};

/**
 * Anslutningsinformation: enheter med adress och användarkonton (användarnamn/lösenord).
 * Bara Admin, Projektledare och System ser den. Ingen export, eftersom det är känsligt.
 */
export function AnslutningsVy(p: Props) {
  if (!p.far) {
    return (
      <>
        <div className="brodsmula">{p.grupp}</div>
        <h1>{p.rubrik}</h1>
        <p className="tomruta">Anslutningsinformationen (användarnamn och lösenord) visas bara för Admin, Projektledare och System.</p>
      </>
    );
  }
  return <Innehall {...p} />;
}

function Innehall(p: Props) {
  const dok = useDokument(p.projektId, "anslutning", p.uppdaterad, p.visaMeddelande);
  const [valdId, setValdId] = useState<string | null>(null);
  const [visa, setVisa] = useState<Set<number>>(new Set());
  const lista = [...(dok.lista ?? [])].sort((a, b) => a.namn.localeCompare(b.namn, "sv", { numeric: true }));
  const vald = lista.find((d) => d.id === valdId) ?? lista[0];
  const e = vald ? las(vald) : null;

  const andra = <K extends keyof Enhet>(k: K, v: Enhet[K]) => vald && e && dok.andra(vald.id, JSON.stringify({ ...e, [k]: v }));
  const andraKonto = (i: number, k: keyof Konto, v: string) => e && andra("konton", e.konton.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const ny = async () => {
    const namn = window.prompt("Namn på enheten (t.ex. AS01 DDC, router, HMI):");
    if (!namn?.trim()) return;
    try {
      const d = await dok.skapa(namn.trim(), JSON.stringify({ ...TOM, konton: [{ anvandarnamn: "", losenord: "", kommentar: "" }] }));
      setValdId(d.id); setVisa(new Set());
    } catch (x) { p.visaMeddelande(`Enheten kunde inte skapas: ${(x as Error).message}`); }
  };
  const taBort = async () => {
    if (!vald || !window.confirm(`Ta bort ${vald.namn} med alla konton?`)) return;
    try { await dok.taBort(vald.id); setValdId(null); } catch (x) { p.visaMeddelande((x as Error).message); }
  };
  const kopiera = (t: string) => void navigator.clipboard.writeText(t).then(() => p.visaMeddelande("Kopierat."), () => p.visaMeddelande("Kunde inte kopiera."));

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">{!p.lasläge && <button className="knapp primar" onClick={() => void ny()}>+ Ny enhet</button>}</div>
      </div>
      <p className="ingress">
        Adresser, användarnamn och lösenord till projektets enheter. Syns bara för Admin, Projektledare och System och går inte att exportera.
        Sparas automatiskt{dok.status === "sparar" ? " (sparar…)" : dok.status === "osparat" ? " (osparade ändringar)" : ""}.
      </p>
      <div className="textkatalog">
        <aside className="panel katalogpanel">
          <h3>Enheter</h3>
          {dok.lista === null ? <span className="dampad liten">Hämtar…</span>
            : lista.length === 0 ? <span className="dampad liten">Inga enheter än.</span>
            : lista.map((d) => (
              <button key={d.id} className={`katalograd ${vald?.id === d.id ? "aktiv" : ""}`} onClick={() => { void dok.sparaNu(); setValdId(d.id); setVisa(new Set()); }}>
                {d.namn}<br /><span className="dampad liten mono">{las(d).adress}</span>
              </button>
            ))}
        </aside>
        {!vald || !e ? <p className="tomruta">Inga enheter än.{!p.lasläge && " Klicka på Ny enhet."}</p> : (
          <section className="panel textyta">
            <div className="textytahuvud">
              <input className="mallnamn" value={vald.namn} readOnly={p.lasläge} aria-label="Enhetens namn" onChange={(x) => dok.andra(vald.id, vald.data, x.target.value)} />
              <span className="grow" />
              {!p.lasläge && <button className="knapp fara" onClick={() => void taBort()}>Ta bort enheten</button>}
            </div>
            <div className="riskhuvud">
              <label className="riskfalt"><span>Adress (IP/URL)</span><input className="mono" value={e.adress} readOnly={p.lasläge} onChange={(x) => andra("adress", x.target.value)} /></label>
              <label className="riskfalt"><span>Beskrivning</span><input value={e.beskrivning} readOnly={p.lasläge} onChange={(x) => andra("beskrivning", x.target.value)} /></label>
            </div>
            <h2>Konton</h2>
            <table className="formtabell">
              <thead><tr><th>Användarnamn</th><th>Lösenord</th><th>Kommentar</th><th /></tr></thead>
              <tbody>
                {e.konton.map((k, i) => (
                  <tr key={i}>
                    <td><input className="mono" value={k.anvandarnamn} readOnly={p.lasläge} autoComplete="off" onChange={(x) => andraKonto(i, "anvandarnamn", x.target.value)} /></td>
                    <td>
                      <div className="losenrad">
                        <input className="mono" type={visa.has(i) ? "text" : "password"} value={k.losenord} readOnly={p.lasläge} autoComplete="new-password" onChange={(x) => andraKonto(i, "losenord", x.target.value)} />
                        <button className="knapp liten" title={visa.has(i) ? "Dölj" : "Visa"} onClick={() => setVisa((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; })}>{visa.has(i) ? "Dölj" : "Visa"}</button>
                        <button className="knapp liten" title="Kopiera lösenordet" onClick={() => kopiera(k.losenord)}>Kopiera</button>
                        {!p.lasläge && <button className="knapp liten" title="Skapa ett slumpat lösenord" onClick={() => { andraKonto(i, "losenord", nyttLosenord()); setVisa((s) => new Set(s).add(i)); }}>Nytt</button>}
                      </div>
                    </td>
                    <td><input value={k.kommentar} readOnly={p.lasläge} onChange={(x) => andraKonto(i, "kommentar", x.target.value)} /></td>
                    <td>{!p.lasläge && <button className="knapp liten" title="Ta bort kontot" onClick={() => andra("konton", e.konton.filter((_, j) => j !== i))}>✕</button>}</td>
                  </tr>
                ))}
                {!p.lasläge && <tr><td colSpan={4}><button className="knapp" onClick={() => andra("konton", [...e.konton, { anvandarnamn: "", losenord: "", kommentar: "" }])}>+ Lägg till konto</button></td></tr>}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </>
  );
}
