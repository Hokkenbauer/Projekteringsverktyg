import { useEffect, useState, type ReactNode } from "react";
import { api, ApiFel, skicka } from "../../lib/api";
import { Dialog } from "../../shell/Dialog";

export type KontrollTyp = "projekt" | "projektering" | "service";
export type Kontroll = {
  id: string; typ: KontrollTyp; namn: string; beskrivning: string; mallNamn: string;
  ordning: number; antal: number; klara: number; andrad: string; andradAv: string;
};
type KontrollMall = { id: string; typ: KontrollTyp; namn: string; beskrivning: string; punkter: string[]; andradAv: string };

type Props = {
  projektId: string;
  typ: KontrollTyp;
  grupp: string;
  rubrik: string;
  valdId: string | null;
  onVald: (id: string | null, kontroll: Kontroll | null) => void;
  /** Räknas upp när kontroller eller deras punkter ändrats. */
  uppdaterad: number;
  skriva: boolean;
  hanteraMallar: boolean;
  visaMeddelande: (t: string) => void;
  /** Tabellen för den valda kontrollen (renderas av listmotorn). */
  children?: ReactNode;
};

const INGRESS: Record<KontrollTyp, string> = {
  projekt: "Kontroller som gäller just det här projektet. Skapa en kontroll från en mall eller börja tom, och bocka i punkterna när de är kontrollerade.",
  projektering: "Egenkontroll av projekteringen. Skapa en kontroll från en mall eller börja tom.",
  service: "Kontroller vid servicebesök. Skapa en kontroll från en mall (t.ex. Servicebesök Beckhoff) eller börja tom.",
};

export function KontrollerVy({ projektId, typ, grupp, rubrik, valdId, onVald, uppdaterad, skriva, hanteraMallar, visaMeddelande, children }: Props) {
  const [kontroller, setKontroller] = useState<Kontroll[] | null>(null);
  const [mallar, setMallar] = useState<KontrollMall[]>([]);
  const [nyOppen, setNyOppen] = useState(false);
  const [mallId, setMallId] = useState("");
  const [namn, setNamn] = useState("");

  const hamta = async () => {
    try {
      const k = await api<Kontroll[]>(`/api/projekt/${projektId}/kontroller?typ=${typ}`);
      setKontroller(k);
      const finns = k.find((x) => x.id === valdId);
      if (!finns) onVald(k[0]?.id ?? null, k[0] ?? null);
      else onVald(finns.id, finns);
    } catch (e) { visaMeddelande((e as Error).message); }
  };
  useEffect(() => { void hamta(); }, [projektId, typ, uppdaterad]);

  const oppnaNy = async () => {
    setNamn(""); setMallId("");
    setNyOppen(true);
    try { setMallar(await api<KontrollMall[]>(`/api/kontrollmallar?typ=${typ}`)); } catch { setMallar([]); }
  };

  const skapa = async () => {
    try {
      const k = await api<Kontroll>(`/api/projekt/${projektId}/kontroller`, {
        method: "POST", body: skicka({ typ, namn: namn.trim() || null, mallId: mallId || null }),
      });
      setNyOppen(false);
      onVald(k.id, k);
      await hamta();
    } catch (e) { visaMeddelande(`Kontrollen kunde inte skapas: ${(e as Error).message}`); }
  };

  const vald = kontroller?.find((k) => k.id === valdId) ?? null;

  const dopOm = async () => {
    if (!vald) return;
    const nytt = window.prompt("Nytt namn på kontrollen:", vald.namn);
    if (!nytt?.trim()) return;
    try { await api(`/api/projekt/${projektId}/kontroller/${vald.id}`, { method: "PATCH", body: skicka({ namn: nytt }) }); await hamta(); }
    catch (e) { visaMeddelande((e as Error).message); }
  };

  const taBort = async () => {
    if (!vald || !window.confirm(`Ta bort kontrollen ${vald.namn} med alla kontrollpunkter?`)) return;
    try { await api(`/api/projekt/${projektId}/kontroller/${vald.id}`, { method: "DELETE" }); onVald(null, null); await hamta(); }
    catch (e) { visaMeddelande((e as Error).message); }
  };

  const sparaSomMall = async () => {
    if (!vald) return;
    const mallnamn = window.prompt("Namn på mallen:", vald.mallNamn || vald.namn);
    if (!mallnamn?.trim()) return;
    const skicka2 = (skrivOver: boolean) => api<{ antal: number }>(`/api/projekt/${projektId}/kontroller/${vald.id}/som-mall`, {
      method: "POST", body: skicka({ namn: mallnamn, skrivOver }),
    });
    try {
      const s = await skicka2(false);
      visaMeddelande(`Mallen ${mallnamn} är sparad med ${s.antal} kontrollpunkter.`);
    } catch (e) {
      if (e instanceof ApiFel && e.status === 409 && window.confirm(`Det finns redan en mall som heter ${mallnamn}. Skriva över den?`)) {
        const s = await skicka2(true);
        visaMeddelande(`Mallen ${mallnamn} är uppdaterad med ${s.antal} kontrollpunkter.`);
      } else if (!(e instanceof ApiFel && e.status === 409)) visaMeddelande((e as Error).message);
    }
  };

  const valdMall = mallar.find((m) => m.id === mallId);

  return (
    <>
      <div className="brodsmula">{grupp}</div>
      <div className="rubrikrad">
        <h1>{rubrik}</h1>
        <div className="knappar">
          {skriva && <button className="knapp primar" onClick={() => void oppnaNy()}>+ Ny kontroll</button>}
          {vald && skriva && <button className="knapp" onClick={() => void dopOm()}>Byt namn</button>}
          {vald && hanteraMallar && <button className="knapp" onClick={() => void sparaSomMall()}>Spara som mall</button>}
          {vald && skriva && <button className="knapp fara" onClick={() => void taBort()}>Ta bort kontroll</button>}
        </div>
      </div>
      <p className="ingress">{INGRESS[typ]}</p>

      {kontroller === null ? <p className="dampad">Hämtar…</p> : kontroller.length === 0 ? (
        <p className="tomruta">Inga kontroller än. {skriva && "Klicka på Ny kontroll för att börja."}</p>
      ) : (
        <div className="kontrollchips" role="tablist" aria-label="Kontroller">
          {kontroller.map((k) => (
            <button
              key={k.id} role="tab" aria-selected={k.id === valdId}
              className={`kontrollchip ${k.id === valdId ? "aktiv" : ""} ${k.antal > 0 && k.klara === k.antal ? "klar" : ""}`}
              onClick={() => onVald(k.id, k)}
            >
              <b>{k.namn}</b>
              <small>{k.klara} av {k.antal} kontrollerade</small>
            </button>
          ))}
        </div>
      )}

      {vald && children}

      <Dialog
        titel="Ny kontroll" oppen={nyOppen} onStang={() => setNyOppen(false)}
        fot={<><button className="knapp" onClick={() => setNyOppen(false)}>Avbryt</button><button className="knapp primar" onClick={() => void skapa()}>Skapa</button></>}
      >
        <div className="faltrad">
          <label>Mall
            <select value={mallId} onChange={(e) => setMallId(e.target.value)}>
              <option value="">Tom kontroll (inga punkter)</option>
              {mallar.map((m) => <option key={m.id} value={m.id}>{m.namn} ({m.punkter.length} punkter)</option>)}
            </select>
          </label>
          <label>Namn
            <input type="text" value={namn} onChange={(e) => setNamn(e.target.value)} placeholder={valdMall?.namn ?? "Ny kontroll"} />
          </label>
        </div>
        {valdMall && (
          <>
            {valdMall.beskrivning && <p className="dampad">{valdMall.beskrivning}</p>}
            <ol className="punktlista">{valdMall.punkter.map((p, i) => <li key={i}>{p}</li>)}</ol>
          </>
        )}
      </Dialog>
    </>
  );
}
