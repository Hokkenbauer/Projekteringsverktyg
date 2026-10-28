import { useMemo, useRef, useState } from "react";
import { Dialog } from "../../shell/Dialog";
import { sparaAllaNu } from "../../lib/sparning";
import type { Projekt } from "../../lib/typer";
import { zip } from "../../lib/zip";
import { laddaDokumentUppgifter } from "../projekt/DokumentUppgifter";
import { FORMAT, formatFor, handlingar, hamtaUnderlag, rentNamn, type Fil, type Format, type Handling } from "./handlingar";

type Val = { valda: string[]; format: Format[] };
const nyckel = (projektId: string) => `pv.filexport.${projektId}`;

function lasVal(projektId: string): Val | null {
  try {
    const v = JSON.parse(localStorage.getItem(nyckel(projektId)) ?? "null") as Val | null;
    return v && Array.isArray(v.valda) && Array.isArray(v.format) ? v : null;
  } catch { return null; }
}
function sparaVal(projektId: string, v: Val) {
  try { localStorage.setItem(nyckel(projektId), JSON.stringify(v)); } catch { /* bara bekvämlighet */ }
}

const storlek = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);

type Forlopp = { nr: number; antal: number; text: string };
type Resultat = { filer: number; byte: number; noteringar: string[]; fel: string[]; avbrutet: boolean };

/**
 * Filexport: alla utskrivbara handlingar i en lista med kryssrutor. Varje vald handling blir egna filer (PDF, Word,
 * Excel) i en ZIP med mappar som i menyn. Senaste valet sparas per projekt och webbläsare.
 */
export function FilexportKnapp({ projekt }: { projekt: Projekt }) {
  const [oppen, setOppen] = useState(false);
  const [lista, setLista] = useState<Handling[] | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [valda, setValda] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<Set<Format>>(new Set(["pdf"]));
  const [forlopp, setForlopp] = useState<Forlopp | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const avbryt = useRef(false);

  const oppna = async () => {
    setOppen(true); setLista(null); setFel(null); setResultat(null); setForlopp(null);
    try {
      // Det som väntar på att sparas (t.ex. en text man just skrev) sparas först.
      await sparaAllaNu();
      const l = handlingar(await hamtaUnderlag(projekt.id));
      const v = lasVal(projekt.id);
      setLista(l);
      setValda(new Set(v ? v.valda.filter((id) => l.some((h) => h.id === id)) : l.filter((h) => h.standard !== false).map((h) => h.id)));
      setFormat(new Set(v?.format.length ? v.format : ["pdf"]));
    } catch (e) { setFel(`Projektets data kunde inte hämtas: ${(e as Error).message}`); }
  };

  const grupper = useMemo(() => {
    const m = new Map<string, Handling[]>();
    for (const h of lista ?? []) {
      const grupp = h.mapp.split("/")[0]!;
      m.set(grupp, [...(m.get(grupp) ?? []), h]);
    }
    return [...m.entries()];
  }, [lista]);

  const vaxla = (ids: string[], pa: boolean) => setValda((s) => {
    const n = new Set(s);
    for (const id of ids) { if (pa) n.add(id); else n.delete(id); }
    return n;
  });
  const vaxlaFormat = (f: Format) => setFormat((s) => {
    const n = new Set(s);
    if (n.has(f)) { if (n.size > 1) n.delete(f); } else n.add(f);
    return n;
  });

  const valdaHandlingar = (lista ?? []).filter((h) => valda.has(h.id));

  const starta = async () => {
    if (!valdaHandlingar.length) return;
    const formatLista = FORMAT.map((f) => f.id).filter((f) => format.has(f));
    sparaVal(projekt.id, { valda: [...valda], format: formatLista });
    avbryt.current = false;
    setResultat(null);
    setForlopp({ nr: 0, antal: valdaHandlingar.length, text: "Sparar och hämtar projektets senaste data…" });
    const noteringar: string[] = [];
    const felLista: string[] = [];
    const filer: Fil[] = [];
    try {
      await sparaAllaNu();
      // Exporten görs av projektets data som den är just nu (inte det som visades när dialogen öppnades).
      const u = await hamtaUnderlag(projekt.id);
      await laddaDokumentUppgifter(projekt.id, u.projekt).catch(() => undefined);
      const aktuella = handlingar(u).filter((h) => valda.has(h.id));
      const ctx = { avbrutet: () => avbryt.current, notera: (t: string) => noteringar.push(t) };
      for (let i = 0; i < aktuella.length; i++) {
        if (avbryt.current) break;
        const h = aktuella[i]!;
        setForlopp({ nr: i, antal: aktuella.length, text: `Skapar ${h.namn}…` });
        try {
          filer.push(...await h.skapa(formatFor(h, formatLista), ctx));
          if (!h.format.some((f) => formatLista.includes(f)))
            noteringar.push(`${h.namn} finns bara som ${h.format.map((f) => FORMAT.find((x) => x.id === f)!.namn).join(" och ")}.`);
        } catch (e) { felLista.push(`${h.namn}: ${(e as Error).message}`); }
        // Låt webbläsaren rita om mellan handlingarna.
        await new Promise((ok) => window.setTimeout(ok, 0));
      }
      if (avbryt.current) {
        setForlopp(null);
        setResultat({ filer: 0, byte: 0, noteringar: [], fel: [], avbrutet: true });
        return;
      }
      setForlopp({ nr: aktuella.length, antal: aktuella.length, text: "Packar ZIP-filen…" });

      // Samma namn två gånger (t.ex. två skåp med samma namn) får (2), (3) …
      const anvanda = new Set<string>();
      const unika = filer.map((f) => {
        let namn = f.namn;
        for (let n = 2; anvanda.has(namn.toLowerCase()); n++) namn = f.namn.replace(/(\.[^./]+)$/, ` (${n})$1`);
        anvanda.add(namn.toLowerCase());
        return { ...f, namn };
      });
      const idag = new Date().toLocaleDateString("sv-SE");
      const rad = "\r\n";
      const innehall = [
        `Handlingar – ${[u.projekt.nummer, u.projekt.namn].filter(Boolean).join(" ")}`,
        `Skapad ${new Date().toLocaleString("sv-SE")} i Projekteringsverktyget.`,
        "",
        ...(felLista.length ? ["KUNDE INTE SKAPAS:", ...felLista.map((t) => `  - ${t}`), ""] : []),
        ...(noteringar.length ? ["ATT KONTROLLERA:", ...noteringar.map((t) => `  - ${t}`), ""] : []),
        `FILER (${unika.length}):`,
        ...unika.map((f) => `  ${f.namn}`),
      ].join(rad);
      const data = zip([...unika, { namn: "Innehåll.txt", data: `﻿${innehall}` }]);
      const blob = new Blob([data as BlobPart], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${rentNamn(`Handlingar ${u.projekt.nummer} ${u.projekt.namn} ${idag}`)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setResultat({ filer: unika.length, byte: data.length, noteringar, fel: felLista, avbrutet: false });
    } catch (e) {
      setResultat({ filer: 0, byte: 0, noteringar, fel: [...felLista, (e as Error).message], avbrutet: false });
    } finally {
      setForlopp(null);
    }
  };

  /** Stängs dialogen medan exporten pågår avbryts den. */
  const stang = () => {
    if (forlopp) avbryt.current = true;
    setOppen(false);
  };

  const arbetar = !!forlopp;
  const formatText = (h: Handling) => formatFor(h, FORMAT.map((f) => f.id).filter((f) => format.has(f)))
    .map((f) => FORMAT.find((x) => x.id === f)!.namn).join(" · ");

  return (
    <>
      <button className="knapp" onClick={() => void oppna()}
        title="Välj handlingar (listor, kontroller, intyg, ritningar, driftkort …) och få dem som egna PDF-, Word- och Excel-filer i en ZIP">
        Filexport…
      </button>
      <Dialog titel="Filexport – handlingar" oppen={oppen} onStang={stang} bred
        fot={resultat && !resultat.avbrutet && !arbetar ? (
          <button className="knapp primar" onClick={() => setOppen(false)}>Stäng</button>
        ) : arbetar ? (
          <button className="knapp" onClick={() => { avbryt.current = true; }}>Avbryt</button>
        ) : (
          <>
            <span className="dampad">{valdaHandlingar.length} av {lista?.length ?? 0} valda</span>
            <button className="knapp" onClick={() => setOppen(false)}>Stäng</button>
            <button className="knapp primar" disabled={!valdaHandlingar.length || !lista} onClick={() => void starta()}>Skapa ZIP</button>
          </>
        )}>
        {fel && <p className="felruta">{fel}</p>}
        {arbetar && forlopp && (
          <div className="fexp-forlopp" aria-live="polite">
            <progress max={forlopp.antal} value={forlopp.nr} />
            <p>{forlopp.text} <span className="dampad">({Math.min(forlopp.nr + 1, forlopp.antal)} av {forlopp.antal})</span></p>
            <p className="dampad liten">Ritningar och många filer kan ta en stund. Du kan fortsätta arbeta i projektet i en annan flik; exporten använder data som de var när den startade.</p>
          </div>
        )}
        {!arbetar && resultat && (
          <div className="fexp-resultat">
            {resultat.avbrutet ? <p>Exporten avbröts. Ingen fil skapades.</p> : resultat.filer > 0 ? (
              <p><b>Klart.</b> {resultat.filer} filer ({storlek(resultat.byte)}) laddas ner som en ZIP-fil. Innehåll.txt i ZIP-filen listar filerna.</p>
            ) : <p className="felruta">Ingen fil kunde skapas.</p>}
            {resultat.fel.length > 0 && <><p className="varnfarg"><b>Kunde inte skapas:</b></p><ul>{resultat.fel.map((t) => <li key={t}>{t}</li>)}</ul></>}
            {resultat.noteringar.length > 0 && <><p><b>Att kontrollera:</b></p><ul>{resultat.noteringar.map((t) => <li key={t}>{t}</li>)}</ul></>}
            {!resultat.avbrutet && <button className="knapp" onClick={() => setResultat(null)}>Gör en ny export</button>}
          </div>
        )}
        {!arbetar && !resultat && !fel && (lista === null ? <p className="dampad">Sparar osparade ändringar och hämtar projektets handlingar…</p> : (
          <>
            <p className="ingress">
              Bocka i de handlingar som ska med. Varje handling blir en egen fil i valda format, i mappar som i menyn, och allt
              packas i en ZIP-fil. Osparade ändringar sparas först. Ditt val sparas till nästa gång.
            </p>
            <div className="fexp-format">
              <b>Format:</b>
              {FORMAT.map((f) => (
                <label key={f.id} className="kryssrad"><input type="checkbox" checked={format.has(f.id)} onChange={() => vaxlaFormat(f.id)} /> {f.namn}</label>
              ))}
              <span className="dampad liten">Finns en handling inte i valt format blir den det format den har (t.ex. driftkort i Word, ritningar som PDF).</span>
            </div>
            <div className="fexp-knappar">
              <button className="knapp liten" onClick={() => setValda(new Set(lista.map((h) => h.id)))}>Välj alla</button>
              <button className="knapp liten" onClick={() => setValda(new Set(lista.filter((h) => !h.tom).map((h) => h.id)))}>Välj alla med innehåll</button>
              <button className="knapp liten" onClick={() => setValda(new Set())}>Välj ingen</button>
            </div>
            <div className="fexp-lista">
              {grupper.map(([grupp, h]) => {
                const alla = h.every((x) => valda.has(x.id));
                const nagon = h.some((x) => valda.has(x.id));
                return (
                  <fieldset key={grupp} className="fexp-grupp">
                    <legend>
                      <label className="kryssrad">
                        <input type="checkbox" checked={alla} ref={(el) => { if (el) el.indeterminate = nagon && !alla; }}
                          onChange={(e) => vaxla(h.map((x) => x.id), e.target.checked)} />
                        <b>{grupp.replace(/^\d+ /, "")}</b>
                      </label>
                    </legend>
                    {h.map((x) => (
                      <label key={x.id} className={`fexp-rad ${x.tom ? "tom" : ""}`}>
                        <input type="checkbox" checked={valda.has(x.id)} onChange={(e) => vaxla([x.id], e.target.checked)} />
                        <span className="fexp-namn">{x.namn}{x.mapp.includes("/") && <span className="dampad liten"> · {x.mapp.split("/").slice(1).join(" / ")}</span>}</span>
                        <span className="fexp-info dampad liten">{x.info}</span>
                        <span className="fexp-filtyp liten">{formatText(x)}</span>
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </div>
            <p className="dampad liten">
              Service ingår inte. Anslutningsinformation (lösenord) exporteras aldrig. Tomma handlingar blir blanka formulär att fylla i för hand.
            </p>
          </>
        ))}
      </Dialog>
    </>
  );
}
