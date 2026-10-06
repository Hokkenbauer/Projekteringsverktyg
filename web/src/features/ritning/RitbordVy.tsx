import { useEffect, useRef, useState } from "react";
import { api, ApiFel, skicka } from "../../lib/api";
import type { Projekt } from "../../lib/typer";
import { temaForVerktyg } from "./tema";

type BildInfo = { id: string; namn: string; ordning: number; version: number; andrad: string; andradAv: string };
type Bild = { id: string; namn: string; data: string; version: number };

/** Funktioner som ritbordet (iframen) anropar. Se public/ritbord/ritbord.html. */
type Vard = {
  redo: () => void;
  spara: (data: string) => Promise<"ok" | "konflikt" | "fel" | "lasläge">;
  sparaInstallningar: (data: string) => Promise<boolean>;
  kanInstallningar: boolean;
};

type Verktyg = Window & {
  rbLadda?: (json: string | null, namn: string) => void;
  rbSparaNu?: () => Promise<void>;
  rbInstallningar?: (json: string | null) => void;
  rbTema?: (t: Record<string, string | boolean>) => void;
};

type Props = {
  projektId: string;
  projekt: Projekt | null;
  lasläge: boolean;
  kanInstallningar: boolean;
  /** Räknas upp när någon annan ändrat i ritbordet. */
  uppdaterad: number;
  visaMeddelande: (t: string) => void;
};

/**
 * Ritbord: ritverktyget för SCADA-bakgrunder/flödesbilder från dagens HTML-verktyg, inbäddat.
 * Varje projekt kan ha flera bilder. Bilderna sparas automatiskt; kundstandarder, symboler och
 * mallar är gemensamma för alla.
 */
export function RitbordVy(p: Props) {
  const ram = useRef<HTMLIFrameElement>(null);
  const [bilder, setBilder] = useState<BildInfo[] | null>(null);
  const [valdId, setValdId] = useState<string | null>(null);
  const [helskarm, setHelskarm] = useState(false);
  const redo = useRef(false);
  const version = useRef(0);
  const laddad = useRef<string | null>(null);
  const props = useRef(p);
  props.current = p;
  const valdRef = useRef(valdId);
  valdRef.current = valdId;

  const verktyg = () => ram.current?.contentWindow as Verktyg | null | undefined;

  const hamtaLista = async (): Promise<BildInfo[]> => {
    const lista = await api<BildInfo[]>(`/api/projekt/${p.projektId}/ritbord`);
    setBilder(lista);
    return lista;
  };

  const oppna = async (id: string) => {
    const v = verktyg();
    if (!v?.rbLadda || !redo.current) return;
    if (laddad.current && laddad.current !== id) await v.rbSparaNu?.();
    try {
      const b = await api<Bild>(`/api/projekt/${p.projektId}/ritbord/${id}`);
      version.current = b.version;
      laddad.current = id;
      v.rbLadda(b.data || null, b.namn);
      setValdId(id);
    } catch (e) {
      props.current.visaMeddelande(`Bilden kunde inte hämtas: ${(e as Error).message}`);
    }
  };

  const nyBild = async (namn?: string) => {
    try {
      const b = await api<BildInfo>(`/api/projekt/${p.projektId}/ritbord`, { method: "POST", body: skicka({ namn: namn ?? "" }) });
      await hamtaLista();
      await oppna(b.id);
    } catch (e) {
      props.current.visaMeddelande(`Bilden kunde inte skapas: ${(e as Error).message}`);
    }
  };

  const start = async () => {
    const v = verktyg();
    if (!v) return;
    v.rbTema?.(temaForVerktyg());
    try {
      const inst = await api<{ data: string | null }>("/api/ritbord/installningar");
      v.rbInstallningar?.(inst.data);
    } catch { /* grundinställningarna duger */ }
    const lista = await hamtaLista().catch(() => [] as BildInfo[]);
    if (lista.length) await oppna(valdRef.current && lista.some((b) => b.id === valdRef.current) ? valdRef.current : lista[0]!.id);
    else if (!props.current.lasläge) await nyBild("Bild 1");
  };

  useEffect(() => {
    const vard: Vard = {
      redo: () => { if (!redo.current) { redo.current = true; void start(); } },
      spara: async (data) => {
        const id = laddad.current;
        if (!id) return "fel";
        if (props.current.lasläge) return "lasläge";
        try {
          const r = await api<BildInfo>(`/api/projekt/${p.projektId}/ritbord/${id}`, { method: "PUT", body: skicka({ data, version: version.current }) });
          version.current = r.version;
          setBilder((l) => l?.map((b) => (b.id === r.id ? r : b)) ?? l);
          return "ok";
        } catch (e) {
          if (e instanceof ApiFel && e.status === 409) {
            props.current.visaMeddelande("Någon annan sparade bilden samtidigt. Deras version visas nu; gör om din senaste ändring.");
            laddad.current = null;
            void oppna(id);
            return "konflikt";
          }
          return "fel";
        }
      },
      sparaInstallningar: async (data) => {
        try { await api("/api/ritbord/installningar", { method: "PUT", body: skicka({ data }) }); return true; }
        catch (e) { props.current.visaMeddelande((e as Error).message); return false; }
      },
      kanInstallningar: p.kanInstallningar,
    };
    (window as unknown as { rbVard?: Vard }).rbVard = vard;
    return () => { void verktyg()?.rbSparaNu?.(); redo.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.projektId]);

  // Ritbordet följer webbappens tema.
  useEffect(() => {
    const skickaTema = () => { if (redo.current) verktyg()?.rbTema?.(temaForVerktyg()); };
    const obs = new MutationObserver(skickaTema);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    return () => obs.disconnect();
  }, []);

  // Någon annan har ändrat: uppdatera listan, och bilden om det var den som är öppen.
  useEffect(() => {
    if (p.uppdaterad === 0 || !redo.current) return;
    void (async () => {
      const lista = await hamtaLista().catch(() => null);
      const id = laddad.current;
      if (!lista || !id) return;
      const info = lista.find((b) => b.id === id);
      if (!info) { laddad.current = null; if (lista[0]) await oppna(lista[0].id); else setValdId(null); return; }
      if (info.version !== version.current) { laddad.current = null; await oppna(id); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.uppdaterad]);

  const vald = bilder?.find((b) => b.id === valdId);

  const bytNamn = async () => {
    if (!vald) return;
    const nytt = window.prompt("Nytt namn på bilden:", vald.namn);
    if (!nytt?.trim()) return;
    try {
      await api(`/api/projekt/${p.projektId}/ritbord/${vald.id}`, { method: "PATCH", body: skicka({ namn: nytt }) });
      await hamtaLista();
    } catch (e) { p.visaMeddelande((e as Error).message); }
  };

  const taBort = async () => {
    if (!vald || !window.confirm(`Ta bort bilden ${vald.namn}? Det går inte att ångra.`)) return;
    try {
      await api(`/api/projekt/${p.projektId}/ritbord/${vald.id}`, { method: "DELETE" });
      laddad.current = null;
      const lista = await hamtaLista();
      if (lista[0]) await oppna(lista[0].id);
      else { setValdId(null); if (!p.lasläge) await nyBild("Bild 1"); }
    } catch (e) { p.visaMeddelande((e as Error).message); }
  };

  return (
    <div className={`ritningsyta ${helskarm ? "helskarm" : ""}`}>
      <div className="ritningshuvud">
        <h1>Ritbord</h1>
        <span
          className="hjalp" tabIndex={0}
          title="Rita SCADA-bakgrunder och flödesbilder. Varje projekt kan ha flera bilder, och de sparas automatiskt. Exportera färdig bild som SVG eller PDF uppe till höger i ritbordet."
        >?</span>
        <select
          aria-label="Välj bild" value={valdId ?? ""} disabled={!bilder?.length}
          onChange={(e) => void oppna(e.target.value)}
        >
          {(bilder ?? []).map((b) => <option key={b.id} value={b.id}>{b.namn}</option>)}
        </select>
        {!p.lasläge && <button className="knapp" onClick={() => { const n = window.prompt("Namn på den nya bilden:", `Bild ${(bilder?.length ?? 0) + 1}`); if (n !== null) void nyBild(n); }}>+ Ny bild</button>}
        {!p.lasläge && vald && <button className="knapp" onClick={() => void bytNamn()}>Byt namn</button>}
        {!p.lasläge && vald && <button className="knapp fara" onClick={() => void taBort()}>Ta bort</button>}
        {p.lasläge && <span className="dampad">Endast läsning</span>}
        <span className="grow" />
        {vald && <span className="dampad liten">Ändrad av {vald.andradAv}</span>}
        <button className="knapp" onClick={() => setHelskarm((h) => !h)}>{helskarm ? "Avsluta helskärm" : "Helskärm"}</button>
      </div>
      <iframe
        ref={ram} className="ritningsram" src={`/ritbord/ritbord.html?v=${__BYGGE__}`} title="Ritbord"
        onLoad={() => { if (!redo.current) (window as unknown as { rbVard?: Vard }).rbVard?.redo(); }}
      />
    </div>
  );
}
