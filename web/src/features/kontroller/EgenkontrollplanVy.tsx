import { useEffect, useMemo, useRef, useState } from "react";
import { DataGrid, type Kolumn } from "../../grid/DataGrid";
import { skrivUtBlock } from "../../lib/dokumentBlock";
import { handlingsdatum, handlingsstatus } from "../../lib/dokumenttema";
import { sparaAllaNu, useFordrojdSparning } from "../../lib/sparning";
import type { Anteckningar, Projekt } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";
import { hamtaUnderlag, type Format, type Underlag } from "../export/handlingar";
import { laddaDokumentUppgifter } from "../projekt/DokumentUppgifter";
import {
  exporteraPlan, lasExportVal, lasPlan, nummerNamn, planDokument, poster, sparaExportVal, STATUSAR, valdaPoster, varde,
  type ExportResultat, type PlanData, type Post, type Uppgift,
} from "./egenkontrollplan";

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

type Rad = { id: string; dokument: string; status: string; benamning: string; datum: string; innehall: string; flik: string; egen: string };

const FORMAT: { id: Format; namn: string }[] = [{ id: "pdf", namn: "PDF" }, { id: "word", namn: "Word" }];
const storlek = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} kB`);
const nyttId = () => `egen:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Projektets data för förteckningen: handlingarna (som i filexporten) och handlingsstatus/datum för förslagen. */
async function hamta(projektId: string): Promise<Underlag> {
  const u = await hamtaUnderlag(projektId);
  await laddaDokumentUppgifter(projektId, u.projekt).catch(() => undefined);
  return u;
}

/**
 * Egenkontrollplan (Projektering → Kontroller) = Förteckning egenkontroller. Standardhandlingarna står i
 * förteckningen från början; status, benämning och datum kan ändras, raderna kan flyttas och egna rader läggas
 * till. Exportera… ger en ZIP med förteckningen och de ikryssade handlingarna numrerade 01_, 02_ …
 */
export function EgenkontrollplanVy(p: Props) {
  const [plan, setPlan] = useState<PlanData>(() => lasPlan(p.text?.text));
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const [underlag, setUnderlag] = useState<Underlag | null>(null);
  const [hamtar, setHamtar] = useState(false);
  const sparning = useFordrojdSparning();

  // Ändringar från andra (livesynk) tas in när det inte finns något osparat här.
  useEffect(() => { if (status === "sparat" && p.text?.text !== undefined) setPlan(lasPlan(p.text.text)); }, [p.text?.text]);

  const uppdatera = async () => {
    setHamtar(true);
    try { setUnderlag(await hamta(p.projektId)); }
    catch (e) { p.visaMeddelande(`Handlingarna kunde inte hämtas: ${(e as Error).message}`); }
    finally { setHamtar(false); }
  };
  useEffect(() => { void uppdatera(); }, [p.projektId]);

  const spara = (ny: PlanData) => {
    setPlan(ny);
    setStatus("osparat");
    sparning.planera(async () => {
      setStatus("sparar");
      try { await p.onSparaText(JSON.stringify(ny)); setStatus("sparat"); }
      catch (e) { setStatus("osparat"); p.visaMeddelande(`Kunde inte spara: ${(e as Error).message}`); }
    }, 800);
  };

  const lista = useMemo(() => (underlag ? poster(underlag, plan) : []), [underlag, plan]);
  const rader: Rad[] = useMemo(() => lista.map((x, i) => ({
    id: x.id, dokument: nummerNamn(i + 1, x.namn), flik: x.flik, innehall: x.info, egen: x.egen ? "ja" : "",
    status: varde(plan, x, "status"), benamning: varde(plan, x, "benamning"), datum: varde(plan, x, "datum"),
  })), [lista, plan]);

  const andra = (r: Rad, nyckel: keyof Rad & string, v: string) => {
    if (p.lasläge) return;
    const falt = nyckel === "dokument" ? "namn" : nyckel;
    if (r.egen) {
      spara({ ...plan, egna: plan.egna.map((e) => (e.id === r.id ? { ...e, [falt]: v } : e)) });
      return;
    }
    if (falt !== "status" && falt !== "benamning" && falt !== "datum") return;
    spara({ ...plan, uppgifter: { ...plan.uppgifter, [r.id]: { ...plan.uppgifter[r.id], [falt]: v } as Uppgift } });
  };
  const ny = () => {
    const id = nyttId();
    spara({ ...plan, ordning: [...lista.map((x) => x.id), id], egna: [...plan.egna, { id, namn: "Ny handling", status: handlingsstatus(), benamning: "", datum: handlingsdatum() }] });
  };
  const taBort = (ids: string[]) => {
    const egna = ids.filter((id) => plan.egna.some((e) => e.id === id));
    if (egna.length < ids.length) p.visaMeddelande("Standardhandlingarna kan inte tas bort. Bocka ur dem när du exporterar i stället.");
    if (egna.length) spara({ ...plan, egna: plan.egna.filter((e) => !egna.includes(e.id)), ordning: plan.ordning.filter((id) => !egna.includes(id)) });
  };
  const flytta = (ids: string[]) => spara({ ...plan, ordning: ids });

  const kolumner: Kolumn<Rad>[] = [
    {
      nyckel: "dokument", rubrik: "Dokumentnamn", typ: "ro", bredd: 250,
      cell: (r) => {
        const e = r.egen && !p.lasläge ? plan.egna.find((x) => x.id === r.id) : null;
        return e
          ? <input type="text" value={e.namn} aria-label="Dokumentnamn" onChange={(x) => andra(r, "dokument", x.target.value)} />
          : <span>{r.dokument}</span>;
      },
    },
    { nyckel: "status", rubrik: "Status", typ: "val", val: STATUSAR, bredd: 80 },
    { nyckel: "benamning", rubrik: "Benämning", typ: "text", fyll: true },
    { nyckel: "datum", rubrik: "Datum", typ: "datum", bredd: 120 },
    { nyckel: "innehall", rubrik: "Innehåll", typ: "ro", bredd: 190 },
    { nyckel: "flik", rubrik: "Finns i", typ: "ro", bredd: 180 },
  ];

  const skrivUt = () => { if (underlag) skrivUtBlock(planDokument(plan, valdaPoster(p.projektId, lista), underlag.projekt)); };

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          <button className="knapp" onClick={() => void uppdatera()} disabled={hamtar} title="Hämta handlingarnas innehåll på nytt">Uppdatera</button>
          <button className="knapp" onClick={skrivUt} disabled={!underlag} title="Skriver ut förteckningen med de handlingar som valdes senast i exporten">Skriv ut / PDF</button>
          <ExportKnapp projektId={p.projektId} />
        </div>
      </div>
      <p className="ingress">
        Förteckning egenkontroller: projektets egenkontrollhandlingar, numrerade i den ordning de lämnas över. Status och datum
        föreslås från projektets handlingsuppgifter och kan ändras per rad. Dra raderna för att ändra ordning och lägg till egna
        rader för handlingar som tas fram utanför verktyget. Med <b>Exportera egenkontroller…</b> kryssar du i handlingarna och
        får förteckningen och dem i en ZIP-fil (00_Förteckning, 01_…, 02_…).
        Allt sparas automatiskt{status === "sparar" ? " (sparar…)" : status === "osparat" ? " (osparade ändringar)" : ""}.
      </p>
      {!underlag ? <p className="dampad">Hämtar handlingarna…</p> : (
        <DataGrid
          rader={rader} kolumner={kolumner} sokPlatshallare="Sök i förteckningen" onAndra={andra} utanLopnummer
          onNy={p.lasläge ? undefined : ny} onTaBort={p.lasläge ? undefined : taBort} onFlytta={p.lasläge ? undefined : flytta}
          lasläge={p.lasläge} tomText="Inga handlingar."
        />
      )}
    </>
  );
}

/** Exportera egenkontroller…: kryssa i handlingarna, välj PDF/Word, få en ZIP numrerad som förteckningen. */
function ExportKnapp({ projektId }: { projektId: string }) {
  const [oppen, setOppen] = useState(false);
  const [lista, setLista] = useState<Post[] | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
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
      const u = await hamta(projektId);
      const pl = lasPlan(u.texter.egenkontrollplan);
      const l = poster(u, pl);
      const v = lasExportVal(projektId);
      setPlan(pl);
      setLista(l);
      setValda(new Set(v ? v.valda.filter((id) => l.some((x) => x.id === id)) : l.map((x) => x.id)));
      setFormat(new Set(v?.format.filter((f) => f === "pdf" || f === "word").length ? v.format : ["pdf"]));
    } catch (e) { setFel(`Handlingarna kunde inte hämtas: ${(e as Error).message}`); }
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
      // Exporten görs av projektets data som de är just nu, i förteckningens ordning.
      const u = await hamta(projektId);
      const pl = lasPlan(u.texter.egenkontrollplan);
      const med = poster(u, pl).filter((x) => valda.has(x.id));
      const r = await exporteraPlan(u, pl, med, formatLista, setForlopp, () => avbryt.current);
      setResultat(r);
      if (!r) setFel("Exporten avbröts. Ingen fil skapades.");
    } catch (e) { setFel(`Exporten misslyckades: ${(e as Error).message}`); }
    finally { setForlopp(null); }
  };

  const stang = () => { if (forlopp) avbryt.current = true; setOppen(false); };
  const med = (lista ?? []).filter((x) => valda.has(x.id));

  return (
    <>
      <button className="knapp primar" onClick={() => void oppna()} title="Välj handlingar och få förteckningen och dem numrerade i en ZIP-fil">Exportera egenkontroller…</button>
      <Dialog titel="Exportera egenkontroller" oppen={oppen} onStang={stang} bred
        fot={forlopp ? <button className="knapp" onClick={() => { avbryt.current = true; }}>Avbryt</button>
          : resultat ? <button className="knapp primar" onClick={() => setOppen(false)}>Stäng</button>
          : (
            <>
              <span className="dampad">{med.length} av {lista?.length ?? 0} valda</span>
              <button className="knapp" onClick={() => setOppen(false)}>Stäng</button>
              <button className="knapp primar" disabled={!med.length || !lista} onClick={() => void starta()}>Skapa ZIP</button>
            </>
          )}>
        {fel && <p className="felruta">{fel}</p>}
        {forlopp && <div className="fexp-forlopp" aria-live="polite"><progress /><p>{forlopp}</p></div>}
        {!forlopp && resultat && (
          <div className="fexp-resultat">
            <p><b>Klart.</b> {resultat.filer} filer ({storlek(resultat.byte)}) laddas ner som en ZIP-fil: 00_Förteckning egenkontroller och
              de valda handlingarna numrerade som i förteckningen. Innehåll.txt listar filerna.</p>
            {resultat.utanFil.length > 0 && <><p><b>I förteckningen men utan fil</b> (bifogas separat):</p><ul>{resultat.utanFil.map((t) => <li key={t}>{t}</li>)}</ul></>}
            {resultat.fel.length > 0 && <><p className="varnfarg"><b>Kunde inte skapas:</b></p><ul>{resultat.fel.map((t) => <li key={t}>{t}</li>)}</ul></>}
            <button className="knapp" onClick={() => setResultat(null)}>Gör en ny export</button>
          </div>
        )}
        {!forlopp && !resultat && (lista === null ? (!fel && <p className="dampad">Sparar osparade ändringar och hämtar handlingarna…</p>) : (
          <>
            <p className="ingress">
              Bocka i de handlingar som ska med. Förteckningen får en rad per vald handling, numrerad i förteckningens ordning,
              och handlingarna följer med som filer med samma nummer. Ditt val sparas till nästa gång.
            </p>
            <div className="fexp-format">
              <b>Format:</b>
              {FORMAT.map((f) => (
                <label key={f.id} className="kryssrad"><input type="checkbox" checked={format.has(f.id)} onChange={() => vaxlaFormat(f.id)} /> {f.namn}</label>
              ))}
              <span className="dampad liten">Driftkort kommer i Word och Kontaktlistan som PDF.</span>
            </div>
            <div className="fexp-knappar">
              <button className="knapp liten" onClick={() => setValda(new Set(lista.map((x) => x.id)))}>Välj alla</button>
              <button className="knapp liten" onClick={() => setValda(new Set(lista.filter((x) => !x.tom).map((x) => x.id)))}>Välj alla med innehåll</button>
              <button className="knapp liten" onClick={() => setValda(new Set())}>Välj ingen</button>
            </div>
            <div className="fexp-lista">
              <fieldset className="fexp-grupp">
                <legend><b>Förteckning egenkontroller</b></legend>
                {lista.map((x) => {
                  const nr = med.indexOf(x);
                  return (
                    <label key={x.id} className={`fexp-rad ${x.tom ? "tom" : ""}`}>
                      <input type="checkbox" checked={valda.has(x.id)} onChange={(e) => vaxla(x.id, e.target.checked)} />
                      <span className="fexp-namn">{nr >= 0 ? nummerNamn(nr + 1, x.namn) : x.namn}<span className="dampad liten"> · {x.flik}</span></span>
                      <span className="fexp-info dampad liten">{x.info}</span>
                      <span className="fexp-filtyp liten">{plan ? varde(plan, x, "status") : ""}</span>
                    </label>
                  );
                })}
              </fieldset>
            </div>
            <p className="dampad liten">
              Tomma listor blir blanka formulär att fylla i för hand. Förhindersanmälan och Underrättelse om hinder blir blanka blanketter
              när inga finns. Handlingar som inte finns i verktyget, och egna rader, står i förteckningen men bifogas separat.
            </p>
          </>
        ))}
      </Dialog>
    </>
  );
}
