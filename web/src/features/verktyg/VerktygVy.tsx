import { useEffect, useRef, useState } from "react";
import { api, hamtaBinar } from "../../lib/api";

type Uppladdat = { id: string; namn: string; storlek: number; uppladdad: string; uppladdadAv: string };
type Valt = { typ: "inbyggt"; fil: string; namn: string } | { typ: "uppladdat"; id: string; namn: string };

/** Verktygen från dagens program som följer med appen (Ritbord och Resursplanering är egna flikar). */
const INBYGGDA: { fil: string; namn: string; beskrivning: string }[] = [
  { fil: "Terminal_planner_1_9.html", namn: "K-bus / E-bus konfigurationskontroll", beskrivning: "Terminal planner: plintar, ström och kortordning." },
  { fil: "Beckhoff_Boot_Analyzer.html", namn: "Beckhoff Boot Analyzer", beskrivning: "Analysera Boot-mappen från en Beckhoff-PLC." },
  { fil: "TC3_Compare.html", namn: "TC3-Compare", beskrivning: "Jämför två TwinCAT 3-projekt." },
  { fil: "TC3_Static_Analytics_IEC61131_3.html", namn: "Static analytics TwinCAT 3 ST", beskrivning: "Statisk analys av ST-kod enligt IEC 61131-3." },
  { fil: "CSV_Compare.html", namn: "CSV-jämförelse", beskrivning: "Jämför två CSV-filer." },
  { fil: "XML-jamforelse.html", namn: "XML-jämförelse", beskrivning: "Jämför två XML-filer." },
  { fil: "SFP-Berakning.html", namn: "SFP-kalkyl", beskrivning: "Specifik fläkteleffekt." },
  { fil: "kabel-trafo-kalkylator.html", namn: "24VAC dimensionering", beskrivning: "Kabel och transformator för 24 VAC." },
];

/** Verktygen körs avskilda från appen (egen sandlåda), så de kommer inte åt inloggningen. */
const SANDLADA = "allow-scripts allow-downloads allow-popups allow-modals allow-forms";

type Props = { kanHantera: boolean; visaMeddelande: (t: string) => void };

/** HTML-verktyg: verktygen från dagens program och egna uppladdade, öppnas här i appen. */
export function VerktygVy({ kanHantera, visaMeddelande }: Props) {
  const [uppladdade, setUppladdade] = useState<Uppladdat[] | null>(null);
  const [valt, setValt] = useState<Valt | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [helskarm, setHelskarm] = useState(false);
  const fil = useRef<HTMLInputElement>(null);

  const hamta = () => api<Uppladdat[]>("/api/verktyg").then(setUppladdade).catch(() => setUppladdade([]));
  useEffect(() => { void hamta(); }, []);

  useEffect(() => {
    setHtml(null);
    if (valt?.typ !== "uppladdat") return;
    hamtaBinar(`/api/verktyg/${valt.id}`).then((b) => setHtml(new TextDecoder().decode(b))).catch((e) => visaMeddelande(`Verktyget kunde inte hämtas: ${(e as Error).message}`));
  }, [valt]);

  const ladda = async (f: File) => {
    const form = new FormData();
    form.append("fil", f, f.name);
    try {
      await api("/api/verktyg", { method: "POST", body: form });
      visaMeddelande(`${f.name} är tillagt.`);
      void hamta();
    } catch (e) { visaMeddelande(`Verktyget kunde inte läggas till: ${(e as Error).message}`); }
  };
  const taBort = async (u: Uppladdat) => {
    if (!window.confirm(`Ta bort verktyget ${u.namn} för alla?`)) return;
    try { await api(`/api/verktyg/${u.id}`, { method: "DELETE" }); if (valt?.typ === "uppladdat" && valt.id === u.id) setValt(null); void hamta(); }
    catch (e) { visaMeddelande((e as Error).message); }
  };

  return (
    <>
      <div className="brodsmula">Verktyg</div>
      <div className="rubrikrad">
        <h1>HTML-verktyg</h1>
        <div className="knappar">
          {kanHantera && <button className="knapp" onClick={() => fil.current?.click()}>Lägg till verktyg (.html)…</button>}
          <input ref={fil} type="file" accept=".html,.htm" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void ladda(f); }} />
        </div>
      </div>
      <p className="ingress">Fristående verktyg som öppnas här i appen. Verktygen är desamma för alla projekt.</p>
      <div className="textkatalog">
        <aside className="panel katalogpanel">
          <h3>Verktyg</h3>
          {INBYGGDA.map((v) => (
            <button key={v.fil} className={`katalograd ${valt?.typ === "inbyggt" && valt.fil === v.fil ? "aktiv" : ""}`} onClick={() => setValt({ typ: "inbyggt", fil: v.fil, namn: v.namn })}>
              {v.namn}<br /><span className="dampad liten">{v.beskrivning}</span>
            </button>
          ))}
          <h3>Uppladdade</h3>
          {uppladdade === null ? <span className="dampad liten">Hämtar…</span>
            : uppladdade.length === 0 ? <span className="dampad liten">Inga uppladdade verktyg.</span>
            : uppladdade.map((u) => (
              <div key={u.id} className="katalogrubrikrad">
                <button className={`katalograd ${valt?.typ === "uppladdat" && valt.id === u.id ? "aktiv" : ""}`} onClick={() => setValt({ typ: "uppladdat", id: u.id, namn: u.namn })}>
                  {u.namn}<br /><span className="dampad liten">{u.uppladdadAv}</span>
                </button>
                {kanHantera && <span className="radknappar"><button title="Ta bort verktyget" onClick={() => void taBort(u)}>✕</button></span>}
              </div>
            ))}
        </aside>
        <section className={`panel verktygsyta ${helskarm ? "helskarm" : ""}`}>
          {!valt ? <p className="tomruta">Välj ett verktyg till vänster.</p> : (
            <>
              <div className="textytahuvud">
                <h2>{valt.namn}</h2>
                <span className="grow" />
                {valt.typ === "inbyggt" && <a className="knapp" href={`/verktyg/${valt.fil}`} target="_blank" rel="noopener">Öppna i ny flik</a>}
                <button className="knapp" onClick={() => setHelskarm((h) => !h)}>{helskarm ? "Avsluta helskärm" : "Helskärm"}</button>
              </div>
              {valt.typ === "inbyggt"
                ? <iframe key={valt.fil} className="verktygsram" title={valt.namn} sandbox={SANDLADA} src={`/verktyg/${valt.fil}?v=${__BYGGE__}`} />
                : html === null ? <p className="dampad">Hämtar…</p>
                : <iframe key={valt.id} className="verktygsram" title={valt.namn} sandbox={SANDLADA} srcDoc={html} />}
            </>
          )}
        </section>
      </div>
    </>
  );
}
