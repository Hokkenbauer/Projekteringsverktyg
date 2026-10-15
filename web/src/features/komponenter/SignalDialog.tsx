import { useEffect, useRef, useState } from "react";
import { FUNKTIONER, SNABBTYPER, TYPER, nySignal, sammanfatta, signalnamn, tolka, type Signal } from "../../lib/signaler";
import type { Komponent } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

type Props = {
  komponent: Komponent | null;
  lasläge: boolean;
  onStang: () => void;
  onSpara: (k: Komponent, lista: Signal[]) => void;
};

/**
 * I/O-punkterna för en komponent. Snabbknappar (+DI, +DU …), kortform ("2DI DU AO RTU" + Enter)
 * och en rad per punkt med typ, funktion och beskrivning. Signalnamnet = beteckning + funktion.
 */
export function SignalDialog({ komponent, lasläge, onStang, onSpara }: Props) {
  const [lista, setLista] = useState<Signal[]>([]);
  const [kortform, setKortform] = useState("");
  const kortRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!komponent) return;
    setLista(komponent.signaler.map((s) => ({ ...s })));
    setKortform("");
    window.setTimeout(() => kortRef.current?.focus(), 30);
  }, [komponent?.id]);

  if (!komponent) return null;
  const andrat = JSON.stringify(lista) !== JSON.stringify(komponent.signaler);
  const lagg = (nya: Signal[]) => setLista((l) => [...l, ...nya]);
  const andra = (id: string, falt: keyof Signal, v: string) => setLista((l) => l.map((s) => (s.id === id ? { ...s, [falt]: v } : s)));
  const flytta = (i: number, d: number) => setLista((l) => {
    const j = i + d; if (j < 0 || j >= l.length) return l;
    const k = [...l]; [k[i], k[j]] = [k[j]!, k[i]!]; return k;
  });
  const lasKortform = () => {
    const nya = tolka(kortform, lista);
    if (nya.length) { lagg(nya); setKortform(""); }
  };
  const spara = () => { onSpara(komponent, lista); onStang(); };
  const namn = komponent.beteckning || "komponenten";
  // Samma funktion två gånger ger samma signalnamn.
  const dubletter = new Set(lista.map((s) => s.funktion.trim().toUpperCase()).filter((f, i, a) => f && a.indexOf(f) !== i));

  return (
    <Dialog
      titel={`I/O för ${namn}`} oppen={!!komponent} bred onStang={onStang}
      fot={<>
        <span className="dampad">{sammanfatta(lista) || "Ingen I/O"}</span>
        <button className="knapp" onClick={onStang}>{lasläge ? "Stäng" : "Avbryt"}</button>
        {!lasläge && <button className="knapp primar" disabled={!andrat} onClick={spara}>Spara</button>}
      </>}
    >
      {!lasläge && (
        <div className="faltrad">
          <span className="falt-etikett">Lägg till</span>
          <div className="knappgrupp">
            {SNABBTYPER.map((t) => <button key={t} type="button" className="knapp liten" onClick={() => lagg([nySignal(t, lista)])}>+{t}</button>)}
          </div>
          <input
            ref={kortRef} type="text" className="kortform" value={kortform} placeholder="Kortform, t.ex. 2DI DU AO RTU – tryck Enter"
            onChange={(e) => setKortform(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lasKortform(); } }}
            aria-label="Kortform"
          />
        </div>
      )}
      {lista.length === 0 ? (
        <p className="dampad">Ingen I/O ännu. Klicka på en typ ovan eller skriv kortformen, t.ex. <b>2DI DU AO RTU</b>.</p>
      ) : (
        <div className="grid-ram">
          <table className="grid signaltabell">
            <thead><tr><th>Typ</th><th>Funktion</th><th>Signalnamn</th><th>Beskrivning</th>{!lasläge && <th />}</tr></thead>
            <tbody>
              {lista.map((s, i) => (
                <tr key={s.id}>
                  <td>
                    <select value={s.typ} disabled={lasläge} onChange={(e) => andra(s.id, "typ", e.target.value)} aria-label="Typ">
                      {[...new Set([...TYPER, s.typ])].map((t) => <option key={t}>{t}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="text" value={s.funktion} disabled={lasläge} list={`funk-${s.typ}`} aria-label="Funktion"
                      onChange={(e) => andra(s.id, "funktion", e.target.value.toUpperCase())} />
                  </td>
                  <td className={`mono${dubletter.has(s.funktion.trim().toUpperCase()) ? " varnar" : ""}`}
                    title={dubletter.has(s.funktion.trim().toUpperCase()) ? "Samma funktion finns två gånger – signalnamnen blir lika" : undefined}>
                    <span className="ro-text">{signalnamn(komponent.beteckning, s)}</span>
                  </td>
                  <td><input type="text" value={s.beskrivning} disabled={lasläge} aria-label="Beskrivning" onChange={(e) => andra(s.id, "beskrivning", e.target.value)} /></td>
                  {!lasläge && (
                    <td className="signalknappar">
                      <button type="button" className="knapp liten" title="Flytta upp" disabled={i === 0} onClick={() => flytta(i, -1)}>▲</button>
                      <button type="button" className="knapp liten" title="Flytta ned" disabled={i === lista.length - 1} onClick={() => flytta(i, 1)}>▼</button>
                      <button type="button" className="knapp liten fara" title="Ta bort" onClick={() => setLista((l) => l.filter((x) => x.id !== s.id))}>✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {Object.entries(FUNKTIONER).map(([t, f]) => (
        <datalist key={t} id={`funk-${t}`}>{f.map((x) => <option key={x} value={x} />)}</datalist>
      ))}
      <p className="dampad liten">
        DO och AO skrivs som DU och AU. Funktionen föreslås efter typ och kan ändras fritt. Signalnamnet används i Signallistan,
        funktionstexter och modulbeläggning.
      </p>
    </Dialog>
  );
}
