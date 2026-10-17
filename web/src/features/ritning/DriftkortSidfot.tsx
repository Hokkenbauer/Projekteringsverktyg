import { useEffect, useState } from "react";
import { api, skicka } from "../../lib/api";
import type { Projekt, ProjektDokument } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

/**
 * Projektets gemensamma sidfot för driftkort. Värdena skrivs in i Word-filens sidfot när ett driftkort skapas
 * eller en funktionstext exporteras, och kan skrivas in i alla befintliga driftkort på en gång.
 * Sparas som projektdokument av typen "driftkortsidfot" (JSON). Tomt fält = behåll texten i Word-filen.
 */
export type Sidfot = {
  status: string; datum: string; projektnummer: string; konstruktor: string; kontrollansvarig: string;
  rad1: string; rad2: string; rad3: string;
  /** Valda loggor ur loggbiblioteket, i sidfotens ordning ("" = behåll Word-filens bild). */
  loggor: string[];
};

/** En logga i det gemensamma loggbiblioteket (katalogen "loggor"). */
export type Logga = { id: string; namn: string; typ: string; b: number; h: number; data: string };
const LOGGPLATSER = ["Logga 1 (vänster)", "Logga 2"];

export const STATUSAR = ["ARBETSKOPIA", "GRANSKNINGSHANDLING", "BYGGHANDLING", "RELATIONSHANDLING"];
const TYP = "driftkortsidfot";
const tom: Sidfot = { status: "", datum: "", projektnummer: "", konstruktor: "", kontrollansvarig: "", rad1: "", rad2: "", rad3: "", loggor: ["", ""] };

export async function hamtaLoggor(): Promise<{ lista: Logga[]; version: number }> {
  const k = await api<{ data: string; version: number }>("/api/katalog/loggor");
  let lista: Logga[] = [];
  try { lista = k.data ? (JSON.parse(k.data) as Logga[]) : []; } catch { /* trasig katalog */ }
  return { lista, version: k.version };
}

/** Läser en bildfil som base64 och tar reda på storleken (för att kunna anpassa den i sidfoten). */
export function lasBild(f: File): Promise<Logga> {
  return new Promise((ok, fel) => {
    const r = new FileReader();
    r.onerror = () => fel(new Error(`${f.name} kunde inte läsas.`));
    r.onload = () => {
      const url = String(r.result);
      const im = new Image();
      im.onerror = () => fel(new Error(`${f.name} är ingen bild som går att läsa.`));
      im.onload = () => ok({
        id: Math.random().toString(36).slice(2, 10), namn: f.name.replace(/\.(png|jpe?g)$/i, ""),
        typ: f.type || "image/png", b: im.naturalWidth, h: im.naturalHeight, data: url.slice(url.indexOf(",") + 1),
      });
      im.src = url;
    };
    r.readAsDataURL(f);
  });
}
const idag = () => new Date().toLocaleDateString("sv-SE");

export async function hamtaSidfot(projektId: string): Promise<{ dok: ProjektDokument | null; sidfot: Sidfot }> {
  const lista = await api<ProjektDokument[]>(`/api/projekt/${projektId}/dokument?typ=${TYP}`);
  const dok = lista[0] ?? null;
  let sidfot = tom;
  try { if (dok?.data) sidfot = { ...tom, ...(JSON.parse(dok.data) as Partial<Sidfot>) }; } catch { /* trasig data */ }
  if (!Array.isArray(sidfot.loggor)) sidfot = { ...sidfot, loggor: ["", ""] };
  return { dok, sidfot };
}

/** Kort sammanfattning, t.ex. "BYGGHANDLING · 2026-10-15". */
export const sidfotKort = (s: Sidfot) => [s.status, s.datum].filter(Boolean).join(" · ") || "Inte ifylld";

type Props = {
  projektId: string;
  projekt: Projekt | null;
  oppen: boolean;
  lasläge: boolean;
  onStang: () => void;
  visaMeddelande: (t: string) => void;
  onSparad?: (s: Sidfot) => void;
  /** Får ladda upp och ta bort loggor i det gemensamma biblioteket. */
  kanHanteraLoggor: boolean;
};

export function DriftkortSidfotDialog({ projektId, projekt, oppen, lasläge, onStang, visaMeddelande, onSparad, kanHanteraLoggor }: Props) {
  const [loggor, setLoggor] = useState<Logga[]>([]);
  const [loggVersion, setLoggVersion] = useState(0);
  const [visaBibliotek, setVisaBibliotek] = useState(false);
  const [dok, setDok] = useState<ProjektDokument | null>(null);
  const [s, setS] = useState<Sidfot>(tom);
  const [arbetar, setArbetar] = useState<"" | "sparar" | "uppdaterar">("");
  const [fel, setFel] = useState<string | null>(null);

  useEffect(() => {
    if (!oppen) return;
    setFel(null);
    hamtaLoggor().then((l) => { setLoggor(l.lista); setLoggVersion(l.version); }).catch(() => undefined);
    hamtaSidfot(projektId).then((r) => {
      setDok(r.dok);
      // Förslag från projektet när sidfoten inte är ifylld än.
      setS(r.dok ? r.sidfot : { ...tom, projektnummer: projekt?.nummer ?? "", rad1: [projekt?.nummer, projekt?.namn].filter(Boolean).join(" – ") });
    }).catch((e) => setFel((e as Error).message));
  }, [oppen, projektId, projekt?.nummer, projekt?.namn]);

  const satt = (k: Exclude<keyof Sidfot, "loggor">, v: string) => setS((x) => ({ ...x, [k]: v }));
  const sattLogga = (i: number, id: string) => setS((x) => { const l = [...(x.loggor ?? [])]; while (l.length <= i) l.push(""); l[i] = id; return { ...x, loggor: l }; });

  const sparaLoggor = async (lista: Logga[]) => {
    try {
      const k = await api<{ version: number }>("/api/katalog/loggor", { method: "PUT", body: skicka({ data: JSON.stringify(lista), version: loggVersion }) });
      setLoggor(lista); setLoggVersion(k.version);
    } catch (e) { setFel((e as Error).message); }
  };
  const laddaUpp = async (filer: File[]) => {
    const fel: string[] = [], nya: Logga[] = [];
    for (const f of filer) {
      if (!/\.(png|jpe?g)$/i.test(f.name)) { fel.push(`${f.name}: bara PNG eller JPG (Word visar inte SVG i sidfoten).`); continue; }
      if (f.size > 2 * 1024 * 1024) { fel.push(`${f.name}: större än 2 MB.`); continue; }
      try { nya.push(await lasBild(f)); } catch (e) { fel.push((e as Error).message); }
    }
    if (fel.length) setFel(fel.join(" "));
    if (nya.length) await sparaLoggor([...loggor, ...nya]);
  };

  const spara = async (): Promise<boolean> => {
    const data = JSON.stringify(s);
    try {
      const d = dok
        ? await api<ProjektDokument>(`/api/projekt/${projektId}/dokument/${dok.id}`, { method: "PUT", body: skicka({ data, version: dok.version }) })
        : await api<ProjektDokument>(`/api/projekt/${projektId}/dokument`, { method: "POST", body: skicka({ typ: TYP, namn: "Sidfot för driftkort", data }) });
      setDok(d);
      onSparad?.(s);
      return true;
    } catch (e) {
      setFel((e as Error).message);
      return false;
    }
  };

  const sparaOchStang = async () => {
    setArbetar("sparar");
    if (await spara()) { visaMeddelande("Sidfoten sparad. Den används i nya driftkort och Word-exporter."); onStang(); }
    setArbetar("");
  };

  const uppdateraAlla = async () => {
    setArbetar("uppdaterar");
    try {
      if (!(await spara())) return;
      const r = await api<{ uppdaterade: number; oforandrade: number }>(`/api/projekt/${projektId}/driftkort/sidfot/uppdatera`, { method: "POST" });
      visaMeddelande(r.uppdaterade
        ? `Sidfoten uppdaterad i ${r.uppdaterade} Word-filer i Projektfiler › Driftkort (nya versioner).`
        : "Alla driftkort hade redan den här sidfoten.");
      onStang();
    } catch (e) {
      setFel((e as Error).message);
    } finally {
      setArbetar("");
    }
  };

  const falt = (k: Exclude<keyof Sidfot, "loggor">, etikett: string, platshallare = "Behåll texten i Word-filen") => (
    <label>{etikett}
      <input type="text" value={s[k]} placeholder={platshallare} disabled={lasläge} onChange={(e) => satt(k, e.target.value)} />
    </label>
  );

  return (
    <Dialog
      titel="Sidfot för driftkort" oppen={oppen} onStang={() => { if (!arbetar) onStang(); }}
      fot={<>
        {fel && <span className="felruta liten">{fel}</span>}
        <button className="knapp" disabled={!!arbetar} onClick={onStang}>Avbryt</button>
        {!lasläge && <button className="knapp" disabled={!!arbetar} onClick={() => void uppdateraAlla()}
          title="Sparar och skriver in sidfoten i alla Word-filer i Projektfiler › Driftkort">
          {arbetar === "uppdaterar" ? "Uppdaterar…" : "Spara och uppdatera alla driftkort"}</button>}
        {!lasläge && <button className="knapp primar" disabled={!!arbetar} onClick={() => void sparaOchStang()}>{arbetar === "sparar" ? "Sparar…" : "Spara"}</button>}
      </>}
    >
      <p className="dampad">
        Gäller alla driftkort i projektet. Värdena skrivs in i sidfoten när ett driftkort skapas eller en funktionstext exporteras till Word.
        Tomma fält ändrar inte texten i Word-filen.
      </p>
      <div className="faltrad">
        <span className="falt-etikett">Status</span>
        <div className="knappgrupp" role="radiogroup" aria-label="Status">
          {STATUSAR.map((st) => (
            <button key={st} type="button" role="radio" aria-checked={s.status === st} disabled={lasläge}
              className={`knapp ${s.status === st ? "primar" : ""}`} onClick={() => satt("status", s.status === st ? "" : st)}>{st}</button>
          ))}
        </div>
      </div>
      <div className="faltrad">
        <label>Datum
          <span className="radmed">
            <input type="date" value={s.datum} disabled={lasläge} onChange={(e) => satt("datum", e.target.value)} />
            <button type="button" className="knapp" disabled={lasläge} onClick={() => satt("datum", idag())}>Idag</button>
            {s.datum && <button type="button" className="knapp" disabled={lasläge} onClick={() => satt("datum", "")} title="Behåll datumet i Word-filen">Rensa</button>}
          </span>
        </label>
      </div>
      <div className="faltrad tva">
        {falt("projektnummer", "Projektnummer")}
        {falt("konstruktor", "Konstruktör")}
        {falt("kontrollansvarig", "Kontrollansvarig")}
      </div>
      <div className="faltrad">
        {falt("rad1", "Projekt, rad 1", "T.ex. 12345 – Projektnamn")}
        {falt("rad2", "Rad 2", "T.ex. adress")}
        {falt("rad3", "Rad 3")}
      </div>
      <h3 className="liten-rubrik">Loggor i sidfoten</h3>
      <div className="faltrad">
        {LOGGPLATSER.map((namn, i) => {
          const vald = loggor.find((l) => l.id === (s.loggor ?? [])[i]);
          return (
            <label key={namn} className="loggval">{namn}
              <select value={(s.loggor ?? [])[i] ?? ""} disabled={lasläge} onChange={(e) => sattLogga(i, e.target.value)}>
                <option value="">Behåll Word-filens logga</option>
                {loggor.map((l) => <option key={l.id} value={l.id}>{l.namn}</option>)}
              </select>
              {vald && <img className="loggtumme" alt={vald.namn} src={`data:${vald.typ};base64,${vald.data}`} />}
            </label>
          );
        })}
        <button type="button" className="knapp liten" onClick={() => setVisaBibliotek((v) => !v)}>
          {visaBibliotek ? "Dölj loggbiblioteket" : `Loggbiblioteket (${loggor.length})`}
        </button>
      </div>
      {visaBibliotek && (
        <div className="loggbibliotek">
          {loggor.length === 0 && <p className="dampad liten">Inga loggor ännu.{kanHanteraLoggor ? " Ladda upp PNG- eller JPG-filer nedan." : ""}</p>}
          <div className="loggrutnat">
            {loggor.map((l) => (
              <figure key={l.id}>
                <img alt={l.namn} src={`data:${l.typ};base64,${l.data}`} />
                <figcaption>
                  {kanHanteraLoggor ? (
                    <input type="text" defaultValue={l.namn} aria-label="Namn"
                      onBlur={(e) => { const n = e.target.value.trim(); if (n && n !== l.namn) void sparaLoggor(loggor.map((x) => x.id === l.id ? { ...x, namn: n } : x)); }} />
                  ) : l.namn}
                  {kanHanteraLoggor && <button type="button" className="knapp liten fara" title="Ta bort ur biblioteket"
                    onClick={() => void sparaLoggor(loggor.filter((x) => x.id !== l.id))}>✕</button>}
                </figcaption>
              </figure>
            ))}
          </div>
          {kanHanteraLoggor
            ? <label className="knapp liten">Ladda upp loggor…<input type="file" hidden multiple accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void laddaUpp(f); }} /></label>
            : <p className="dampad liten">Admin, Projektledare och System kan lägga till loggor.</p>}
          <p className="dampad liten">Biblioteket är gemensamt för alla projekt. Loggan anpassas in i samma ruta som Word-filens logga, så att sidfoten behåller sin layout.</p>
        </div>
      )}
    </Dialog>
  );
}
