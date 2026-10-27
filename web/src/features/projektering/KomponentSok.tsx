import { useMemo, useState } from "react";
import { api, skicka } from "../../lib/api";
import { KOMPONENTTYP_FOR_KOD, kandaSystem, komponentkoder, komponenterIDriftkort, rumskomponenter, type Kandidat } from "../../lib/funktionstext";
import type { Komponent } from "../../lib/typer";

/** En text att söka i: namn, ren text och systemet för beteckningar utan systemnamn. */
export type Kalla = { id: string; namn: string; text: string; system: string };

type Rad = Kandidat & { kallor: string[]; finns: boolean };

const norm = (s: string) => s.trim().toUpperCase().replace(/_/g, "-");

type Props = {
  projektId: string;
  kallor: Kalla[];
  komponenter: Komponent[];
  lasläge: boolean;
  /** Ändra textens system (sparas i texten). Saknas = bara för den här sökningen. */
  onSattSystem?: (id: string, system: string) => void;
  onNyKomponent?: (k: Komponent) => void;
  visaMeddelande: (t: string) => void;
};

/**
 * Komponenter i en eller flera funktionstexter/driftkort, jämförda med Komponenter.
 * Beteckningar utan systemnamn (GT11) får textens system (LA01-GT11). Det som redan finns läggs inte till.
 */
export function KomponentSok({ projektId, kallor, komponenter, lasläge, onSattSystem, onNyKomponent, visaMeddelande }: Props) {
  const [lokalaSystem, setLokalaSystem] = useState<Record<string, string>>({});
  const systemFor = (k: Kalla) => lokalaSystem[k.id] ?? k.system;
  const [bortvalda, setBortvalda] = useState<Set<string>>(new Set());
  const [ivalda, setIvalda] = useState<Set<string>>(new Set());
  const [arbetar, setArbetar] = useState(false);
  const [visaFinns, setVisaFinns] = useState(false);

  const rader = useMemo(() => {
    const kanda = kandaSystem(komponenter, kallor.map(systemFor));
    const koder = komponentkoder(komponenter);
    const rum = rumskomponenter(komponenter);
    const befintliga = new Set(komponenter.map((k) => norm(k.beteckning)));
    const m = new Map<string, Rad>();
    for (const k of kallor) {
      for (const c of komponenterIDriftkort(k.text, systemFor(k), kanda, koder, rum)) {
        const r = m.get(c.beteckning) ?? { ...c, kallor: [], finns: befintliga.has(c.beteckning) };
        if (!r.kallor.includes(k.namn)) r.kallor.push(k.namn);
        // Säker någonstans = säker.
        if (!c.osaker) r.osaker = false;
        m.set(c.beteckning, r);
      }
    }
    return [...m.values()].sort((a, b) => a.beteckning.localeCompare(b.beteckning, "sv", { numeric: true }));
  }, [kallor, komponenter, lokalaSystem]);

  const nya = rader.filter((r) => !r.finns);
  const finns = rader.filter((r) => r.finns);
  const markerad = (r: Rad) => (r.osaker ? ivalda.has(r.beteckning) : !bortvalda.has(r.beteckning));
  const valda = nya.filter(markerad);
  const vaxla = (r: Rad) => {
    const set = r.osaker ? setIvalda : setBortvalda;
    set((s) => { const n = new Set(s); if (n.has(r.beteckning)) n.delete(r.beteckning); else n.add(r.beteckning); return n; });
  };
  const allaPa = (pa: boolean) => {
    setBortvalda(pa ? new Set() : new Set(nya.filter((r) => !r.osaker).map((r) => r.beteckning)));
    setIvalda(pa ? new Set(nya.filter((r) => r.osaker).map((r) => r.beteckning)) : new Set());
  };

  const typFor = (b: string) => KOMPONENTTYP_FOR_KOD[/^([A-ZÅÄÖ]+)/.exec(b.split("-").at(-1) ?? "")?.[1] ?? ""] ?? "";

  const laggTill = async () => {
    if (!valda.length || !window.confirm(`Lägga till ${valda.length} komponenter i Komponenter?`)) return;
    // Följ projektets sätt att skriva beteckningar (bindestreck eller understreck).
    const understreck = komponenter.filter((k) => k.beteckning.includes("_")).length > komponenter.filter((k) => k.beteckning.includes("-")).length;
    setArbetar(true);
    let n = 0;
    try {
      for (const r of valda) {
        const k = await api<Komponent>(`/api/projekt/${projektId}/komponenter`, {
          method: "POST",
          body: skicka({
            beteckning: understreck ? r.beteckning.replace(/-/g, "_") : r.beteckning, system: r.system,
            komponenttyp: typFor(r.beteckning) || null, beskrivning: `Från ${r.kallor[0] ?? "funktionstext"}`,
          }),
        });
        onNyKomponent?.(k);
        n++;
      }
      visaMeddelande(`${n} komponenter är tillagda i Komponenter.`);
      setBortvalda(new Set()); setIvalda(new Set());
    } catch (e) { visaMeddelande(`${n} tillagda, sedan blev det fel: ${(e as Error).message}`); }
    finally { setArbetar(false); }
  };

  const enKalla = kallor.length === 1;

  return (
    <div className="ksok">
      <div className="ksok-system">
        {!enKalla && (
          <details className="ksok-systemlista">
            <summary>Textens system (för beteckningar utan systemnamn): {kallor.map((k) => systemFor(k) || "–").join(", ")}</summary>
            {kallor.map((k) => (
              <label key={k.id} className="ksok-sysrad">
                <span>{k.namn}</span>
                <input className="mono" value={systemFor(k)} placeholder="t.ex. LA01" readOnly={lasläge}
                  onChange={(e) => setLokalaSystem((s) => ({ ...s, [k.id]: e.target.value.toUpperCase() }))}
                  onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (onSattSystem && v !== k.system) onSattSystem(k.id, v); }} />
              </label>
            ))}
          </details>
        )}
        {enKalla && kallor.map((k) => (
          <label key={k.id} className="ksok-sysrad">
            <span>{enKalla ? "System för beteckningar utan systemnamn" : k.namn}</span>
            <input className="mono" value={systemFor(k)} placeholder="t.ex. LA01" readOnly={lasläge}
              onChange={(e) => setLokalaSystem((s) => ({ ...s, [k.id]: e.target.value.toUpperCase() }))}
              onBlur={(e) => { const v = e.target.value.trim().toUpperCase(); if (onSattSystem && v !== k.system) onSattSystem(k.id, v); }} />
          </label>
        ))}
        <p className="dampad liten">
          Driftkort skriver ofta komponenterna utan system (GT11, SV21, FF01-FAULT). De får textens system: <span className="mono">LA01-GT11</span>.
          Hela beteckningar (KB01-GT41) behålls, signalsuffix som -FAULT och -SP tas bort. Utan system tas bara hela beteckningar med (t.ex. typrum).
        </p>
      </div>

      <p className="ksok-summa">
        <b>{rader.length}</b> komponenter i {enKalla ? "texten" : `${kallor.length} texter`}: <b className="ok">{finns.length} finns redan</b>,{" "}
        <b className={nya.length ? "varnfarg" : ""}>{nya.length} saknas</b> i Komponenter.
      </p>

      {nya.length > 0 && (
        <>
          <table className="ksok-tabell">
            <thead><tr>
              <th><input type="checkbox" aria-label="Välj alla" checked={valda.length === nya.length} disabled={lasläge}
                onChange={(e) => allaPa(e.target.checked)} /></th>
              <th>Beteckning</th><th>I texten</th><th>Komponenttyp (förslag)</th>{!enKalla && <th>Text</th>}
            </tr></thead>
            <tbody>
              {nya.map((r) => (
                <tr key={r.beteckning} className={markerad(r) ? "" : "ej-vald"}>
                  <td><input type="checkbox" checked={markerad(r)} disabled={lasläge} onChange={() => vaxla(r)} aria-label={`Lägg till ${r.beteckning}`} /></td>
                  <td className="mono">{r.beteckning}{r.osaker && <span className="ksok-osaker" title="Kontrollera innan du lägger till: samma kod står med ett annat system i texten (t.ex. GM41 och LA01-GM41), avsnittet har flera system, eller texten beskriver rumskomponenter (typrum)."> osäker</span>}</td>
                  <td className="mono dampad ksok-itexten">{r.iTexten}{r.tolkad && " + system"}</td>
                  <td>{typFor(r.beteckning)}</td>
                  {!enKalla && <td className="dampad liten">{r.kallor.join(", ")}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!lasläge && (
            <button className="knapp primar" disabled={arbetar || !valda.length} onClick={() => void laggTill()}>
              {arbetar ? "Lägger till…" : `Lägg till ${valda.length} markerade i Komponenter`}
            </button>
          )}
        </>
      )}
      {finns.length > 0 && (
        <p className="liten">
          <button className="lank" onClick={() => setVisaFinns((v) => !v)}>{visaFinns ? "Dölj" : "Visa"} de {finns.length} som redan finns</button>
          {visaFinns && <span className="ksok-finns"> {finns.map((r) => <span key={r.beteckning} className="kompchip finns">✓ {r.beteckning}</span>)}</span>}
        </p>
      )}
    </div>
  );
}
