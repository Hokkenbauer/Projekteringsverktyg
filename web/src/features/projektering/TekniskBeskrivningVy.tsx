import { useEffect, useMemo, useRef, useState } from "react";
import { skrivExcel } from "../../lib/excelFil";
import { useKatalog } from "../../lib/katalog";
import type { Anteckningar, Projekt } from "../../lib/typer";
import { oppnaDokument, tabellHtml } from "../../lib/dokumenttema";

type Kategori = { id: string; namn: string; fragor: string[] };
type FrageKatalog = { kategorier: Kategori[] };
const TOM: FrageKatalog = { kategorier: [] };

/** Projektets svar. Svaren knyts till frågans text, så att de finns kvar om katalogen sorteras om. */
/** ejMed = frågor (texten) som är urbockade och inte ska med i exporten. */
type Svar = { kategorier: Record<string, { med?: boolean; svar?: Record<string, string>; ejMed?: string[] }> };

function las(text: string | undefined): Svar {
  try { if (text) return { kategorier: {}, ...JSON.parse(text) }; } catch { /* börja om */ }
  return { kategorier: {} };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Props = {
  projekt: Projekt | null;
  grupp: string;
  rubrik: string;
  text: Anteckningar | undefined;
  onSparaText: (text: string) => Promise<void>;
  lasläge: boolean;
  kanRedigeraKatalog: boolean;
  visaMeddelande: (t: string) => void;
};

/**
 * Teknisk beskrivning: frågor per kategori ur en gemensam katalog, med projektets svar.
 * Bocka ur kategorier som inte ska med i exporten. Ingen AI-export (beslut).
 */
export function TekniskBeskrivningVy(p: Props) {
  const kat = useKatalog<FrageKatalog>("tekniskbeskrivning", TOM);
  const [svar, setSvar] = useState<Svar>(() => las(p.text?.text));
  const [valdId, setValdId] = useState<string | null>(null);
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const [redigera, setRedigera] = useState<{ namn: string; fragor: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { if (status === "sparat" && p.text?.text) setSvar(las(p.text.text)); }, [p.text?.text]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const kategorier = kat.data?.kategorier ?? [];
  const vald = kategorier.find((k) => k.id === valdId) ?? kategorier[0];
  const med = (id: string) => svar.kategorier[id]?.med !== false;
  const svarPa = (id: string, fraga: string) => svar.kategorier[id]?.svar?.[fraga] ?? "";
  const fragaMed = (id: string, fraga: string) => !(svar.kategorier[id]?.ejMed ?? []).includes(fraga);
  /** Frågorna som ska med i exporten för en kategori. */
  const medFragor = (k: Kategori) => k.fragor.filter((f) => fragaMed(k.id, f));

  const spara = (ny: Svar) => {
    setSvar(ny);
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setStatus("sparar");
      try { await p.onSparaText(JSON.stringify(ny)); setStatus("sparat"); }
      catch (e) { setStatus("osparat"); p.visaMeddelande(`Kunde inte spara: ${(e as Error).message}`); }
    }, 1000);
  };
  const satt = (id: string, andring: { med?: boolean; fraga?: string; varde?: string; fragaMed?: { fraga: string; med: boolean } }) => {
    const k = { ...(svar.kategorier[id] ?? {}) };
    if (andring.med !== undefined) k.med = andring.med;
    if (andring.fragaMed) {
      const ej = new Set(k.ejMed ?? []);
      if (andring.fragaMed.med) ej.delete(andring.fragaMed.fraga); else ej.add(andring.fragaMed.fraga);
      k.ejMed = [...ej];
    }
    if (andring.fraga !== undefined) k.svar = { ...(k.svar ?? {}), [andring.fraga]: andring.varde ?? "" };
    spara({ ...svar, kategorier: { ...svar.kategorier, [id]: k } });
  };

  const besvarade = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of kategorier) m.set(k.id, medFragor(k).filter((f) => svarPa(k.id, f).trim()).length);
    return m;
  }, [kategorier, svar]);

  // Kategorier som är ibockade och har minst en ibockad fråga.
  const ivagMed = kategorier.filter((k) => med(k.id) && medFragor(k).length > 0);

  const excel = () => void skrivExcel(`Teknisk beskrivning ${p.projekt?.nummer ?? ""}`.trim(), [{
    namn: "Teknisk beskrivning",
    bredder: [36, 70, 70],
    rader: [["Kategori", "Fråga", "Svar"], ...ivagMed.flatMap((k) => medFragor(k).map((f) => [k.namn, f, svarPa(k.id, f)]))],
  }]).catch((e) => p.visaMeddelande((e as Error).message));

  const skrivUt = () => {
    oppnaDokument({
      titel: "Teknisk beskrivning", kategori: "Teknisk beskrivning", projekt: p.projekt,
      css: "td{white-space:pre-wrap}table.data td:first-child{width:45%}",
      kropp: ivagMed.map((k) => `<h2>${esc(k.namn)}</h2>${tabellHtml(["Fråga", "Svar"], medFragor(k).map((fr) => [fr, svarPa(k.id, fr)]))}`).join(""),
    });
  };

  // ---- Katalogen ----
  const sparaKatalog = async (ny: FrageKatalog) => {
    try { await kat.spara(ny); return true; } catch (e) { p.visaMeddelande((e as Error).message); return false; }
  };
  const borjaRedigera = () => vald && setRedigera({ namn: vald.namn, fragor: vald.fragor.join("\n") });
  const sparaRedigering = async () => {
    if (!redigera || !vald) return;
    const fragor = redigera.fragor.split("\n").map((f) => f.trim()).filter(Boolean);
    const ny = { kategorier: kategorier.map((k) => (k.id === vald.id ? { ...k, namn: redigera.namn.trim() || k.namn, fragor } : k)) };
    if (await sparaKatalog(ny)) { setRedigera(null); p.visaMeddelande("Kategorin är sparad i katalogen."); }
  };
  const nyKategori = async () => {
    const namn = window.prompt("Namn på den nya kategorin:", `${kategorier.length + 1}. `);
    if (!namn?.trim()) return;
    const id = crypto.randomUUID().replace(/-/g, "");
    if (await sparaKatalog({ kategorier: [...kategorier, { id, namn: namn.trim(), fragor: [] }] })) {
      setValdId(id);
      setRedigera({ namn: namn.trim(), fragor: "" });
    }
  };
  const taBortKategori = async () => {
    if (!vald || !window.confirm(`Ta bort kategorin ${vald.namn} ur katalogen? Det gäller alla projekt.`)) return;
    if (await sparaKatalog({ kategorier: kategorier.filter((k) => k.id !== vald.id) })) { setRedigera(null); setValdId(null); }
  };

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          {p.kanRedigeraKatalog && <button className="knapp" onClick={() => void nyKategori()}>+ Ny kategori</button>}
          <button className="knapp" onClick={excel}>Exportera till Excel</button>
          <button className="knapp" onClick={skrivUt}>Skriv ut / PDF</button>
        </div>
      </div>
      <p className="ingress">
        Svara på frågorna per kategori. Bocka ur hela kategorier eller enstaka frågor som inte är relevanta – de kommer inte med i
        utskrift och Excel. Allt sparas automatiskt
        {status === "sparar" ? " (sparar…)" : status === "osparat" ? " (osparade ändringar)" : ""}.
      </p>

      <div className="textkatalog">
        <aside className="panel katalogpanel">
          <h3>Kategorier</h3>
          {kat.data === null && <span className="dampad liten">Hämtar…</span>}
          {kategorier.map((k) => (
            <div key={k.id} className={`kategorirad ${vald?.id === k.id ? "aktiv" : ""}`}>
              <input type="checkbox" checked={med(k.id)} disabled={p.lasläge} aria-label={`Ta med ${k.namn} i exporten`} onChange={(e) => satt(k.id, { med: e.target.checked })} />
              <button className="katalograd" onClick={() => { setValdId(k.id); setRedigera(null); }}>
                {k.namn} <span className="dampad">{besvarade.get(k.id) ?? 0}/{medFragor(k).length}{medFragor(k).length < k.fragor.length ? ` (${k.fragor.length - medFragor(k).length} urbockade)` : ""}</span>
              </button>
            </div>
          ))}
        </aside>

        <section className="panel textyta">
          {!vald ? <p className="tomruta">Inga kategorier i katalogen än.</p> : redigera ? (
            <>
              <div className="textytahuvud">
                <input className="mallnamn" value={redigera.namn} onChange={(e) => setRedigera({ ...redigera, namn: e.target.value })} aria-label="Kategorins namn" />
                <span className="grow" />
                <button className="knapp" onClick={() => setRedigera(null)}>Avbryt</button>
                <button className="knapp fara" onClick={() => void taBortKategori()}>Ta bort kategorin</button>
                <button className="knapp primar" onClick={() => void sparaRedigering()}>Spara i katalogen</button>
              </div>
              <p className="dampad liten">En fråga per rad. Svar som redan getts i projekt finns kvar så länge frågans text är densamma.</p>
              <textarea className="stortext" value={redigera.fragor} onChange={(e) => setRedigera({ ...redigera, fragor: e.target.value })} />
            </>
          ) : (
            <>
              <div className="textytahuvud">
                <h2>{vald.namn}</h2>
                {!med(vald.id) && <span className="dampad liten">Kategorin är urbockad och kommer inte med i exporten.</span>}
                <span className="grow" />
                {!p.lasläge && vald.fragor.length > 0 && (
                  <button className="knapp" onClick={() => {
                    const allaMed = vald.fragor.every((f) => fragaMed(vald.id, f));
                    const k = { ...(svar.kategorier[vald.id] ?? {}), ejMed: allaMed ? [...vald.fragor] : [] };
                    spara({ ...svar, kategorier: { ...svar.kategorier, [vald.id]: k } });
                  }}>{vald.fragor.every((f) => fragaMed(vald.id, f)) ? "Bocka ur alla frågor" : "Bocka i alla frågor"}</button>
                )}
                {p.kanRedigeraKatalog && <button className="knapp" onClick={borjaRedigera}>Redigera frågorna</button>}
              </div>
              <table className="fragetabell">
                <thead><tr><th className="tb-med" title="Med i utskrift och Excel">Med</th><th>Fråga</th><th>Svar</th></tr></thead>
                <tbody>
                  {vald.fragor.map((f) => (
                    <tr key={f} className={fragaMed(vald.id, f) ? "" : "tb-ej"}>
                      <td className="tb-med">
                        <input type="checkbox" checked={fragaMed(vald.id, f)} disabled={p.lasläge}
                          aria-label={`Ta med frågan i exporten: ${f}`} title={fragaMed(vald.id, f) ? "Bocka ur om frågan inte är relevant" : "Ej med i utskrift och Excel"}
                          onChange={(e) => satt(vald.id, { fragaMed: { fraga: f, med: e.target.checked } })} />
                      </td>
                      <td>{f}</td>
                      <td>
                        <textarea
                          rows={Math.min(6, Math.max(1, svarPa(vald.id, f).split("\n").length))}
                          value={svarPa(vald.id, f)} readOnly={p.lasläge}
                          onChange={(e) => satt(vald.id, { fraga: f, varde: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </>
  );
}
