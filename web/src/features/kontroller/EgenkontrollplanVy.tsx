import { useEffect, useMemo, useRef, useState } from "react";
import { DataGrid, type Kolumn } from "../../grid/DataGrid";
import { skrivUtBlock } from "../../lib/dokumentBlock";
import { sparaAllaNu, useFordrojdSparning } from "../../lib/sparning";
import type { Anteckningar, Projekt } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";
import { laddaDokumentUppgifter } from "../projekt/DokumentUppgifter";
import type { Format } from "../export/handlingar";
import {
  exporteraPlan, hamtaKontrollUnderlag, lasExportVal, lasPlan, planDokument, poster, sparaExportVal, SKEDEN, varde,
  type ExportResultat, type KontrollUnderlag, type PlanData, type Post, type Uppgift,
} from "./egenkontrollplan";
import { pekMedEa } from "./ProjekteringsegenkontrollVy";

type Props = {
  projektId: string;
  projekt: Projekt | null;
  grupp: string;
  rubrik: string;
  text: Anteckningar | undefined;
  onSparaText: (text: string) => Promise<void>;
  lasläge: boolean;
  visaMeddelande: (t: string) => void;
};

type Rad = { id: string; namn: string; flik: string; skede: string; ansvarig: string; metod: string; status: string; kommentar: string; egen: string };

const FORMAT: { id: Format; namn: string }[] = [{ id: "pdf", namn: "PDF" }, { id: "word", namn: "Word" }];
const storlek = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
const nyttId = () => `egen:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Egenkontrollplan (Projektering → Kontroller): alla projektets egenkontroller i en tabell. Egenkontrollerna i
 * verktyget kommer med automatiskt; egna rader kan läggas till för kontroller som görs utanför verktyget.
 * Exportera egenkontrollplan… ger en ZIP med planen och de ikryssade egenkontrollerna som bilagor.
 */
export function EgenkontrollplanVy(p: Props) {
  const [plan, setPlan] = useState<PlanData>(() => lasPlan(p.text?.text));
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const [underlag, setUnderlag] = useState<KontrollUnderlag | null>(null);
  const [hamtar, setHamtar] = useState(false);
  const sparning = useFordrojdSparning();
  const medEa = pekMedEa();

  // Ändringar från andra (livesynk) tas in när det inte finns något osparat här.
  useEffect(() => { if (status === "sparat" && p.text?.text !== undefined) setPlan(lasPlan(p.text.text)); }, [p.text?.text]);

  const hamta = async () => {
    setHamtar(true);
    try { setUnderlag(await hamtaKontrollUnderlag(p.projektId)); }
    catch (e) { p.visaMeddelande(`Egenkontrollerna kunde inte hämtas: ${(e as Error).message}`); }
    finally { setHamtar(false); }
  };
  useEffect(() => { void hamta(); }, [p.projektId]);

  const spara = (ny: PlanData) => {
    setPlan(ny);
    setStatus("osparat");
    sparning.planera(async () => {
      setStatus("sparar");
      try { await p.onSparaText(JSON.stringify(ny)); setStatus("sparat"); }
      catch (e) { setStatus("osparat"); p.visaMeddelande(`Kunde inte spara: ${(e as Error).message}`); }
    }, 800);
  };

  const lista = useMemo(() => (underlag ? poster(underlag, plan, medEa) : []), [underlag, plan, medEa]);
  const rader: Rad[] = useMemo(() => lista.map((x) => ({
    id: x.id, namn: x.namn, flik: x.flik, status: x.status, egen: x.egen ? "ja" : "",
    skede: varde(plan, x, "skede"), ansvarig: varde(plan, x, "ansvarig"), metod: varde(plan, x, "metod"), kommentar: varde(plan, x, "kommentar"),
  })), [lista, plan]);

  const andra = (r: Rad, nyckel: keyof Rad & string, v: string) => {
    if (p.lasläge) return;
    if (r.egen) {
      spara({ ...plan, egna: plan.egna.map((e) => (e.id === r.id ? { ...e, [nyckel]: v } : e)) });
      return;
    }
    if (nyckel !== "skede" && nyckel !== "ansvarig" && nyckel !== "metod" && nyckel !== "kommentar") return;
    spara({ ...plan, uppgifter: { ...plan.uppgifter, [r.id]: { ...plan.uppgifter[r.id], [nyckel]: v } as Uppgift } });
  };
  const ny = () => spara({ ...plan, egna: [...plan.egna, { id: nyttId(), namn: "Ny egenkontroll", skede: "", ansvarig: "", metod: "", kommentar: "" }] });
  const taBort = (ids: string[]) => {
    const egna = ids.filter((id) => plan.egna.some((e) => e.id === id));
    if (egna.length < ids.length) p.visaMeddelande("Egenkontroller från verktyget kan inte tas bort här. Bocka ur dem när du exporterar planen i stället.");
    if (egna.length) spara({ ...plan, egna: plan.egna.filter((e) => !egna.includes(e.id)) });
  };

  const kolumner: Kolumn<Rad>[] = [
    {
      nyckel: "namn", rubrik: "Egenkontroll", typ: "ro", bredd: 240,
      cell: (r) => (r.egen && !p.lasläge
        ? <input type="text" value={r.namn} aria-label="Egenkontroll" onChange={(e) => andra(r, "namn", e.target.value)} />
        : <span>{r.namn}</span>),
    },
    { nyckel: "flik", rubrik: "Finns i", typ: "ro", bredd: 170 },
    { nyckel: "skede", rubrik: "Skede", typ: "text", forslag: SKEDEN, bredd: 120 },
    { nyckel: "ansvarig", rubrik: "Ansvarig", typ: "text", bredd: 130 },
    { nyckel: "metod", rubrik: "Metod / verifikat", typ: "text", bredd: 210 },
    { nyckel: "status", rubrik: "Status", typ: "ro", bredd: 150 },
    { nyckel: "kommentar", rubrik: "Kommentar", typ: "text", fyll: true },
  ];

  const skrivUt = async () => {
    if (!underlag) return;
    await laddaDokumentUppgifter(p.projektId, underlag.projekt).catch(() => undefined);
    const v = lasExportVal(p.projektId);
    const valda = v ? lista.filter((x) => v.valda.includes(x.id)) : lista.filter((x) => !x.tom);
    skrivUtBlock(planDokument(plan, valda, p.projekt));
  };

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          <button className="knapp" onClick={() => void hamta()} disabled={hamtar} title="Hämta egenkontrollernas status på nytt">Uppdatera status</button>
          <button className="knapp" onClick={() => void skrivUt()} disabled={!underlag} title="Skriver ut förteckningen med de egenkontroller som valdes senast i exporten">Skriv ut / PDF</button>
          <ExportKnapp projektId={p.projektId} plan={plan} medEa={medEa} />
        </div>
      </div>
      <p className="ingress">
        Alla projektets egenkontroller på ett ställe. De som finns i verktyget kommer med automatiskt; fyll i skede, ansvarig,
        metod och kommentar. Lägg till egna rader för kontroller som görs utanför verktyget (t.ex. injustering eller leverantörens provning).
        Med <b>Exportera egenkontrollplan…</b> väljer du vilka egenkontroller som ska med och får planen och dem som bilagor i en ZIP-fil.
        Allt sparas automatiskt{status === "sparar" ? " (sparar…)" : status === "osparat" ? " (osparade ändringar)" : ""}.
      </p>
      <section className="panel riskhuvud">
        <label className="riskfalt"><span>Upprättad av</span>
          <input value={plan.upprattadAv} readOnly={p.lasläge} onChange={(e) => spara({ ...plan, upprattadAv: e.target.value })} /></label>
        <label className="riskfalt"><span>Datum</span>
          <input type="date" value={plan.datum} readOnly={p.lasläge} onChange={(e) => spara({ ...plan, datum: e.target.value })} /></label>
      </section>
      {!underlag ? <p className="dampad">Hämtar egenkontrollerna…</p> : (
        <DataGrid
          rader={rader} kolumner={kolumner} sokPlatshallare="Sök i egenkontrollplanen" onAndra={andra}
          onNy={p.lasläge ? undefined : ny} onTaBort={p.lasläge ? undefined : taBort} lasläge={p.lasläge}
          tomText="Inga egenkontroller i projektet än."
        />
      )}
    </>
  );
}

/** Exportera egenkontrollplan…: kryssa i egenkontrollerna, välj PDF/Word, få en ZIP. */
function ExportKnapp({ projektId, plan, medEa }: { projektId: string; plan: PlanData; medEa: boolean }) {
  const [oppen, setOppen] = useState(false);
  const [lista, setLista] = useState<Post[] | null>(null);
  const [valda, setValda] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<Set<Format>>(new Set(["pdf"]));
  const [forlopp, setForlopp] = useState<string | null>(null);
  const [resultat, setResultat] = useState<ExportResultat | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const avbryt = useRef(false);

  const oppna = async () => {
    setOppen(true); setLista(null); setResultat(null); setFel(null);
    try {
      await sparaAllaNu();
      const u = await hamtaKontrollUnderlag(projektId);
      const l = poster(u, lasPlan(u.texter.egenkontrollplan), medEa);
      const v = lasExportVal(projektId);
      setLista(l);
      setValda(new Set(v ? v.valda.filter((id) => l.some((x) => x.id === id)) : l.filter((x) => !x.tom).map((x) => x.id)));
      setFormat(new Set(v?.format.filter((f) => f === "pdf" || f === "word").length ? v.format : ["pdf"]));
    } catch (e) { setFel(`Egenkontrollerna kunde inte hämtas: ${(e as Error).message}`); }
  };

  const vaxla = (id: string, pa: boolean) => setValda((s) => { const n = new Set(s); if (pa) n.add(id); else n.delete(id); return n; });
  const vaxlaFormat = (f: Format) => setFormat((s) => { const n = new Set(s); if (n.has(f)) { if (n.size > 1) n.delete(f); } else n.add(f); return n; });

  const starta = async () => {
    const formatLista = FORMAT.map((f) => f.id).filter((f) => format.has(f));
    sparaExportVal(projektId, { valda: [...valda], format: formatLista });
    avbryt.current = false;
    setResultat(null); setFel(null);
    setForlopp("Sparar och hämtar projektets senaste data…");
    try {
      await sparaAllaNu();
      // Exporten görs av projektets data som de är just nu, i planens ordning.
      const u = await hamtaKontrollUnderlag(projektId);
      await laddaDokumentUppgifter(projektId, u.projekt).catch(() => undefined);
      const aktuellPlan = lasPlan(u.texter.egenkontrollplan);
      const med = poster(u, aktuellPlan, medEa).filter((x) => valda.has(x.id));
      const r = await exporteraPlan(u, aktuellPlan, med, formatLista, setForlopp, () => avbryt.current);
      setResultat(r);
      if (!r) setFel("Exporten avbröts. Ingen fil skapades.");
    } catch (e) { setFel(`Exporten misslyckades: ${(e as Error).message}`); }
    finally { setForlopp(null); }
  };

  const stang = () => { if (forlopp) avbryt.current = true; setOppen(false); };
  const antal = (lista ?? []).filter((x) => valda.has(x.id)).length;
  const harFil = (lista ?? []).filter((x) => valda.has(x.id) && x.skapa).length;

  return (
    <>
      <button className="knapp primar" onClick={() => void oppna()} title="Välj egenkontroller och få planen och dem som bilagor i en ZIP-fil">Exportera egenkontrollplan…</button>
      <Dialog titel="Exportera egenkontrollplan" oppen={oppen} onStang={stang} bred
        fot={forlopp ? <button className="knapp" onClick={() => { avbryt.current = true; }}>Avbryt</button>
          : resultat ? <button className="knapp primar" onClick={() => setOppen(false)}>Stäng</button>
          : (
            <>
              <span className="dampad">{antal} av {lista?.length ?? 0} valda</span>
              <button className="knapp" onClick={() => setOppen(false)}>Stäng</button>
              <button className="knapp primar" disabled={!antal || !lista} onClick={() => void starta()}>Skapa ZIP</button>
            </>
          )}>
        {fel && <p className="felruta">{fel}</p>}
        {forlopp && <div className="fexp-forlopp" aria-live="polite"><progress /><p>{forlopp}</p></div>}
        {!forlopp && resultat && (
          <div className="fexp-resultat">
            <p><b>Klart.</b> {resultat.filer} filer ({storlek(resultat.byte)}) laddas ner som en ZIP-fil: egenkontrollplanen och
              bilagorna i mappen Bilagor. Innehåll.txt listar filerna.</p>
            {resultat.fel.length > 0 && <><p className="varnfarg"><b>Kunde inte skapas:</b></p><ul>{resultat.fel.map((t) => <li key={t}>{t}</li>)}</ul></>}
            <button className="knapp" onClick={() => setResultat(null)}>Gör en ny export</button>
          </div>
        )}
        {!forlopp && !resultat && (lista === null ? (!fel && <p className="dampad">Sparar osparade ändringar och hämtar egenkontrollerna…</p>) : (
          <>
            <p className="ingress">
              Bocka i de egenkontroller som ska med i egenkontrollplanen. Planen får en rad per vald egenkontroll, och varje
              egenkontroll från verktyget följer med som bilaga ({harFil} {harFil === 1 ? "bilaga" : "bilagor"}). Egna rader står bara i planen.
              Ditt val sparas till nästa gång.
            </p>
            <div className="fexp-format">
              <b>Format:</b>
              {FORMAT.map((f) => (
                <label key={f.id} className="kryssrad"><input type="checkbox" checked={format.has(f.id)} onChange={() => vaxlaFormat(f.id)} /> {f.namn}</label>
              ))}
            </div>
            <div className="fexp-knappar">
              <button className="knapp liten" onClick={() => setValda(new Set(lista.map((x) => x.id)))}>Välj alla</button>
              <button className="knapp liten" onClick={() => setValda(new Set(lista.filter((x) => !x.tom).map((x) => x.id)))}>Välj alla med innehåll</button>
              <button className="knapp liten" onClick={() => setValda(new Set())}>Välj ingen</button>
            </div>
            <div className="fexp-lista">
              <fieldset className="fexp-grupp">
                <legend><b>Egenkontroller</b></legend>
                {lista.map((x) => (
                  <label key={x.id} className={`fexp-rad ${x.tom ? "tom" : ""}`}>
                    <input type="checkbox" checked={valda.has(x.id)} onChange={(e) => vaxla(x.id, e.target.checked)} />
                    <span className="fexp-namn">{x.namn}<span className="dampad liten"> · {x.flik}</span></span>
                    <span className="fexp-info dampad liten">{x.egen ? "bara i planen" : x.status}</span>
                    <span className="fexp-filtyp liten">{varde(plan, x, "skede")}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <p className="dampad liten">
              Projekteringsegenkontrollen tas med {medEa ? "med" : "utan"} ej aktuella punkter (samma val som i fliken Projekteringsegenkontroll).
              Tomma egenkontroller blir blanka formulär att fylla i för hand. Kontroller under Service ingår inte.
            </p>
          </>
        ))}
      </Dialog>
    </>
  );
}

