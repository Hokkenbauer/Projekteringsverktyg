import { useEffect, useMemo, useRef, useState } from "react";
import { api, hamtaBinar, laddaNer, skicka } from "../../lib/api";

type Fil = { id: string; namn: string; kategori: string; storlek: number; uppladdad: string; uppladdadAv: string };

type Props = { kanHantera: boolean; visaMeddelande: (t: string) => void };

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/** Support: manualer och dokument (PDF) gemensamma för alla, med förhandsvisning. */
export function SupportVy({ kanHantera, visaMeddelande }: Props) {
  const [filer, setFiler] = useState<Fil[] | null>(null);
  const [sok, setSok] = useState("");
  const [vald, setVald] = useState<Fil | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [laddar, setLaddar] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const hamta = () => api<Fil[]>("/api/support").then(setFiler).catch(() => setFiler([]));
  useEffect(() => { void hamta(); }, []);

  // PDF:en hämtas med inloggningen och visas i webbläsarens egen PDF-visare.
  useEffect(() => {
    let lokal: string | null = null;
    setUrl(null);
    if (!vald) return;
    hamtaBinar(`/api/support/${vald.id}/innehall?visa=true`)
      .then((b) => { lokal = URL.createObjectURL(new Blob([b], { type: "application/pdf" })); setUrl(lokal); })
      .catch((e) => visaMeddelande(`Filen kunde inte visas: ${(e as Error).message}`));
    return () => { if (lokal) URL.revokeObjectURL(lokal); };
  }, [vald?.id]);

  const grupper = useMemo(() => {
    const s = sok.trim().toLowerCase();
    const m = new Map<string, Fil[]>();
    for (const f of filer ?? []) {
      if (s && !f.namn.toLowerCase().includes(s) && !f.kategori.toLowerCase().includes(s)) continue;
      const k = f.kategori || "Övrigt";
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "sv"));
  }, [filer, sok]);

  const ladda = async (lista: FileList) => {
    const form = new FormData();
    for (const f of lista) form.append("filer", f, f.name);
    setLaddar(true);
    try {
      const nya = await api<Fil[]>("/api/support", { method: "POST", body: form });
      visaMeddelande(`${nya.length} ${nya.length === 1 ? "fil" : "filer"} uppladdade.`);
      void hamta();
    } catch (e) { visaMeddelande(`Uppladdningen misslyckades: ${(e as Error).message}`); }
    finally { setLaddar(false); }
  };
  const andra = async (f: Fil, falt: "namn" | "kategori") => {
    const v = window.prompt(falt === "namn" ? "Nytt namn:" : "Kategori (t.ex. fabrikat):", f[falt]);
    if (v === null) return;
    try { const ny = await api<Fil>(`/api/support/${f.id}`, { method: "PATCH", body: skicka({ [falt]: v }) }); setFiler((l) => l?.map((x) => (x.id === ny.id ? ny : x)) ?? l); if (vald?.id === f.id) setVald(ny); }
    catch (e) { visaMeddelande((e as Error).message); }
  };
  const taBort = async (f: Fil) => {
    if (!window.confirm(`Ta bort ${f.namn} ur supportbiblioteket för alla?`)) return;
    try { await api(`/api/support/${f.id}`, { method: "DELETE" }); if (vald?.id === f.id) setVald(null); void hamta(); }
    catch (e) { visaMeddelande((e as Error).message); }
  };

  return (
    <>
      <div className="brodsmula">Verktyg</div>
      <div className="rubrikrad">
        <h1>Support</h1>
        <div className="knappar">
          {kanHantera && <button className="knapp" disabled={laddar} onClick={() => input.current?.click()}>{laddar ? "Laddar upp…" : "Ladda upp PDF…"}</button>}
          <input ref={input} type="file" accept=".pdf,application/pdf" multiple hidden onChange={(e) => { if (e.target.files?.length) void ladda(e.target.files); e.target.value = ""; }} />
        </div>
      </div>
      <p className="ingress">
        Manualer och dokument för alla projekt. Kategorin gissas från filnamnet (t.ex. Beckhoff_cx9020.pdf → Beckhoff) och kan ändras.
      </p>
      <div className="textkatalog">
        <aside className="panel katalogpanel">
          <input className="sok" type="search" placeholder="Sök manual" value={sok} onChange={(e) => setSok(e.target.value)} />
          {filer === null ? <span className="dampad liten">Hämtar…</span>
            : filer.length === 0 ? <span className="dampad liten">Biblioteket är tomt.{kanHantera ? " Ladda upp PDF-filerna." : ""}</span>
            : grupper.map(([k, lista]) => (
              <div key={k}>
                <h3>{k}</h3>
                {lista.map((f) => (
                  <div key={f.id} className="katalogrubrikrad">
                    <button className={`katalograd ${vald?.id === f.id ? "aktiv" : ""}`} onClick={() => setVald(f)}>
                      {f.namn} <span className="dampad liten">{mb(f.storlek)}</span>
                    </button>
                    {kanHantera && (
                      <span className="radknappar">
                        <button title="Byt namn" onClick={() => void andra(f, "namn")}>✎</button>
                        <button title="Byt kategori" onClick={() => void andra(f, "kategori")}>#</button>
                        <button title="Ta bort" onClick={() => void taBort(f)}>✕</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
        </aside>
        <section className="panel verktygsyta">
          {!vald ? <p className="tomruta">Välj ett dokument till vänster.</p> : (
            <>
              <div className="textytahuvud">
                <h2>{vald.namn}</h2>
                <span className="grow" />
                <button className="knapp" onClick={() => void laddaNer(`/api/support/${vald.id}/innehall`, `${vald.namn}.pdf`).catch((e) => visaMeddelande((e as Error).message))}>Ladda ner</button>
                {url && <a className="knapp" href={url} target="_blank" rel="noopener">Öppna i ny flik</a>}
              </div>
              {url ? <iframe className="verktygsram" title={vald.namn} src={url} /> : <p className="dampad">Hämtar…</p>}
            </>
          )}
        </section>
      </div>
    </>
  );
}
