import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Anteckningar, ListRad, Projekt } from "../../lib/typer";
import { laddaNerWord, skrivUtBlock, type Block, type BlockDokument } from "../../lib/dokumentBlock";
import { valtDatum } from "../listor/ListVy";
import { SparaFalt } from "../../shell/SparaFalt";
import type { Kontroll } from "./KontrollerVy";

/**
 * Projekteringsegenkontroll som ett ifyllbart formulär: punkterna grupperade i avsnitt, status
 * OK / Ej aktuell med automatisk datum och signatur, kommentar per punkt, framsteg per avsnitt och
 * utskrift (PDF) och Word i dokumenttemat "HECO kombinerad".
 * Raderna är vanliga listrader (lista "kontroll-{id}"), så livesynk och ändringslogg fungerar som i andra listor.
 */

type Punkt = { rad: ListRad; avsnitt: string; text: string; nr: string; status: "ok" | "kompl" | "ea" | "" };
type Avsnitt = { namn: string; nr: number; punkter: Punkt[] };
type Filter = "alla" | "oppna" | "kompl" | "kommentar";

/** Gamla mallar skrev avsnittet först i texten ("Underlag: Senaste handlingar …"). */
const PREFIX = /^([A-ZÅÄÖ][A-Za-zÅÄÖåäö/ -]{1,28}):\s+(.+)$/s;
const UTAN_AVSNITT = "Övriga punkter";

function avsnittOchText(r: ListRad): [string, string] {
  const avsnitt = (r.data.avsnitt ?? "").trim();
  const text = (r.data.kontrollpunkt ?? "").trim();
  if (avsnitt) return [avsnitt, text];
  const m = PREFIX.exec(text);
  return m ? [m[1]!.trim(), m[2]!.trim()] : ["", text];
}

const statusFor = (r: ListRad): Punkt["status"] =>
  r.data.kontrollerad === "true" ? "ok" : r.data.komplettering === "true" ? "kompl"
    : r.data.ejAktuell === "true" ? "ea" : "";

/** Avklarad punkt: utförd eller ej aktuell. "Komplettering krävs" är inte avklarad. */
export const arKlar = (x: Punkt) => x.status === "ok" || x.status === "ea";

/** Fältet som håller respektive status. */
const FALT: Record<Exclude<Punkt["status"], "">, string> = { ok: "kontrollerad", kompl: "komplettering", ea: "ejAktuell" };

/** Punkter i avsnitt, i den ordning avsnitten först förekommer. */
export function gruppera(rader: ListRad[]): Avsnitt[] {
  const ordnade = [...rader].sort((a, b) => a.ordning - b.ordning);
  const grupper = new Map<string, ListRad[]>();
  for (const r of ordnade) {
    const [a] = avsnittOchText(r);
    const lista = grupper.get(a) ?? [];
    lista.push(r);
    grupper.set(a, lista);
  }
  // Punkter utan avsnitt visas sist om det finns avsnitt, annars som enda grupp.
  const namn = [...grupper.keys()].sort((a, b) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0));
  return namn.map((n, i) => ({
    namn: n || (namn.length > 1 ? UTAN_AVSNITT : ""),
    nr: i + 1,
    punkter: grupper.get(n)!.map((r, j) => {
      const [avsnitt, text] = avsnittOchText(r);
      return { rad: r, avsnitt, text, nr: `${i + 1}.${j + 1}`, status: statusFor(r) };
    }),
  }));
}

/** Genvägar till flikar där punkten görs. */
const GENVAGAR: [RegExp, string, string][] = [
  [/modulbeläggning/i, "modulbelaggning", "Modulbeläggning"],
  [/riskanalys/i, "riskanalys-projektering", "Riskanalys projektering"],
  [/effektlaster|effektberäkning/i, "kraftberakning", "Kraftberäkning"],
  [/brandspjäll/i, "brandspjallstabell", "Brandspjällstabell"],
  [/mätplan|M-bus-mätare/i, "matplan", "Mätplan"],
  [/^Driftkort/i, "funktionstexter", "Funktionstexter"],
  [/installationsritningar|utprickade/i, "placeringsritningar", "Placeringsritningar"],
  [/sunda hus/i, "sunda-hus", "Sunda Hus"],
  [/materialspecifikation/i, "byggvarubedomning", "Byggvarubedömning"],
  [/mot offert/i, "kalkylmangder", "Kalkylmängder"],
  [/kundspecifika krav/i, "kravstallning", "Listad kravställning"],
  [/modbusprotokoll/i, "modbus", "Modbus"],
  [/teknisk beskrivning/i, "teknisk-beskrivning", "Teknisk beskrivning"],
  [/korrekt namnsatta/i, "komponenter", "Komponenter"],
  [/skåpsleverantör/i, "apparatskap", "Apparatskåp"],
];

type Props = {
  projekt: Projekt | null;
  kontroll: Kontroll;
  rader: ListRad[] | undefined;
  lasläge: boolean;
  /** Projekteringsintygets uppgifter (projekteringsledare, projektör) delas med egenkontrollen. */
  intyg: Anteckningar | undefined;
  onSparaIntyg: (text: string) => Promise<void>;
  /** Sparar ett fält på raden och returnerar den sparade raden (null om det misslyckades). */
  onAndra: (rad: ListRad, falt: string, varde: string) => Promise<ListRad | null>;
  onNyaPunkter: (punkter: { avsnitt: string; kontrollpunkt: string }[]) => Promise<void>;
  onTaBort: (ids: string[]) => void;
  onFlik: (flik: string) => void;
  visaMeddelande: (t: string) => void;
};

/** Kolumnbredder (px) som går att dra. Sparas per webbläsare. */
type Bredder = { text: number; kommentar: number };
const STANDARDBREDD: Bredder = { text: 560, kommentar: 320 };
const BREDD_NYCKEL = "pek-kolumnbredder";
const GRANS: Record<keyof Bredder, [number, number]> = { text: [220, 1600], kommentar: [140, 1200] };

function lasBredder(): Bredder {
  try {
    const v = JSON.parse(localStorage.getItem(BREDD_NYCKEL) ?? "{}") as Partial<Bredder>;
    return { text: Number(v.text) || STANDARDBREDD.text, kommentar: Number(v.kommentar) || STANDARDBREDD.kommentar };
  } catch { return { ...STANDARDBREDD }; }
}

/** Handtag i rubrikraden: dra för att ändra kolumnens bredd, dubbelklicka för standardbredd. */
function Handtag({ kolumn, bredder, setBredder }: { kolumn: keyof Bredder; bredder: Bredder; setBredder: (b: Bredder) => void }) {
  const start = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    const x0 = e.clientX, b0 = bredder[kolumn];
    let senast = bredder;
    const [min, max] = GRANS[kolumn];
    const flytta = (ev: PointerEvent) => {
      senast = { ...bredder, [kolumn]: Math.round(Math.min(max, Math.max(min, b0 + ev.clientX - x0))) };
      setBredder(senast);
    };
    const slapp = () => {
      window.removeEventListener("pointermove", flytta);
      window.removeEventListener("pointerup", slapp);
      document.body.classList.remove("pek-drar");
      try { localStorage.setItem(BREDD_NYCKEL, JSON.stringify(senast)); } catch { /* bara bekvämlighet */ }
    };
    document.body.classList.add("pek-drar");
    window.addEventListener("pointermove", flytta);
    window.addEventListener("pointerup", slapp);
  };
  const aterstall = () => {
    const ny = { ...bredder, [kolumn]: STANDARDBREDD[kolumn] };
    setBredder(ny);
    try { localStorage.setItem(BREDD_NYCKEL, JSON.stringify(ny)); } catch { /* bara bekvämlighet */ }
  };
  return <span className="pek-handtag" role="separator" aria-orientation="vertical" title="Dra för att ändra bredd. Dubbelklicka för standardbredd."
    onPointerDown={start} onDoubleClick={aterstall} />;
}

type IntygUppgifter = { projekteringsledare: string; projektor: string };

function lasIntyg(t: string | undefined): Record<string, unknown> {
  try { return t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { return {}; }
}

/** Medtagna i utskriften: Ej aktuell bara om man valt det (sparas per webbläsare, standard utan). */
export function pekMedEa(): boolean {
  try { return localStorage.getItem("pek-med-ej-aktuella") === "1"; } catch { return false; }
}

/** Projekteringsegenkontrollen som dokument (utskrift, PDF och Word). */
export function pekDokument(kontrollNamn: string, listrader: ListRad[], projekt: Projekt | null, intygText: string | undefined, medEa: boolean): BlockDokument {
  const avsnitt = gruppera(listrader);
  const i = lasIntyg(intygText);
  const uppg: IntygUppgifter = { projekteringsledare: String(i.projekteringsledare ?? ""), projektor: String(i.projektor ?? "") };
    // Punkter som är Ej aktuell tas inte med om man inte valt det; avsnitt och punkter numreras om i utskriften.
    const ruta = (s: Punkt["status"]) => (s === "ok" ? "OK" : s === "kompl" ? "Kompl." : s === "ea" ? "E.A." : "");
    const rader: (string[] | string)[] = [];
    let avsnittNr = 0, med = 0, ok = 0, kompl = 0, ea = 0;
    for (const a of avsnitt) {
      const punkter = medEa ? a.punkter : a.punkter.filter((x) => x.status !== "ea");
      if (!punkter.length) continue;
      avsnittNr++;
      const klara = punkter.filter((x) => x.status === "ok").length;
      const helaEa = punkter.every((x) => x.status === "ea");
      if (a.namn) rader.push(`${avsnittNr}. ${a.namn}${helaEa ? " – ej aktuellt" : ` (${klara} av ${punkter.length - punkter.filter((x) => x.status === "ea").length} utförda)`}`);
      punkter.forEach((x, i) => {
        med++;
        if (x.status === "ok") ok++;
        if (x.status === "kompl") kompl++;
        if (x.status === "ea") ea++;
        rader.push([`${avsnittNr}.${i + 1}`, x.text, ruta(x.status), x.rad.data.ovrigt ?? "", valtDatum(x.rad.data.datum), x.rad.data.sign ?? ""]);
      });
    }
    const block: Block[] = [
      { typ: "form", rader: [
        ["Objekt", projekt?.namn ?? ""], ["Kund", projekt?.kund ?? ""], ["Projektnummer", projekt?.nummer ?? ""],
        ["Projekteringsledare", uppg.projekteringsledare], ["Projektör", uppg.projektor],
      ] },
      { typ: "rubrik", text: kontrollNamn },
      { typ: "text", text: medEa
        ? `${ok} av ${med - ea} punkter utförda · ${kompl} kräver komplettering · ${ea} ej aktuella · ${med - ok - kompl - ea} öppna. OK = utförd, Kompl. = komplettering krävs, E.A. = ej aktuell. Signering intygar att punkten är kontrollerad.`
        : `${ok} av ${med} punkter utförda · ${kompl} kräver komplettering · ${med - ok - kompl} öppna. OK = utförd, Kompl. = komplettering krävs. Punkter som inte är aktuella för projektet är inte med. Signering intygar att punkten är kontrollerad.`, kursiv: true },
      { typ: "tabell", kolumner: ["Nr", "Kontrollpunkt", "Status", "Kommentar", "Datum", "Sign."], bredder: [6, 47, 7, 22, 11, 7], centrera: [2], rader },
    ];
    return { titel: "Projekteringsegenkontroll", kategori: "Egenkontroll", projekt: projekt, block };
  }

export function ProjekteringsegenkontrollVy(p: Props) {
  const avsnitt = useMemo(() => gruppera(p.rader ?? []), [p.rader]);
  const alla = avsnitt.flatMap((a) => a.punkter);
  const antalOk = alla.filter((x) => x.status === "ok").length;
  const antalEa = alla.filter((x) => x.status === "ea").length;
  const antalKompl = alla.filter((x) => x.status === "kompl").length;
  const antalOppna = alla.length - antalOk - antalEa - antalKompl;
  const klarProcent = alla.length ? Math.round(((antalOk + antalEa) / alla.length) * 100) : 0;

  const [filter, setFilter] = useState<Filter>("alla");
  const [bredder, setBredder] = useState<Bredder>(lasBredder);
  /** Ta med punkter som är Ej aktuell i utskrift och Word (sparas per webbläsare). */
  const [medEa, setMedEa] = useState<boolean>(() => { try { return localStorage.getItem("pek-med-ej-aktuella") === "1"; } catch { return false; } });
  const vaxlaMedEa = (v: boolean) => { setMedEa(v); try { localStorage.setItem("pek-med-ej-aktuella", v ? "1" : "0"); } catch { /* bara bekvämlighet */ } };
  const [redigera, setRedigera] = useState(false);
  const [arbetar, setArbetar] = useState(false);

  // Avsnitt som är helt klara är ihopfällda när kontrollen öppnas.
  const [stangda, setStangda] = useState<Set<string> | null>(null);
  const forbered = useRef<string | null>(null);
  useEffect(() => {
    if (!p.rader || forbered.current === p.kontroll.id) return;
    forbered.current = p.kontroll.id;
    setRedigera(false);
    setStangda(new Set(avsnitt.filter((a) => a.punkter.length && a.punkter.every(arKlar)).map((a) => a.namn)));
  }, [p.rader, p.kontroll.id]);
  const arStangd = (namn: string) => filter === "alla" && !!stangda?.has(namn);
  const vaxla = (namn: string) => setStangda((s) => {
    const ny = new Set(s ?? []);
    if (ny.has(namn)) ny.delete(namn); else ny.add(namn);
    return ny;
  });

  // ---- Uppgifter i huvudet (delas med Projekteringsintyget) ----
  const intygData = lasIntyg(p.intyg?.text);
  const uppg: IntygUppgifter = {
    projekteringsledare: String(intygData.projekteringsledare ?? ""),
    projektor: String(intygData.projektor ?? ""),
  };
  const sparaUppgift = async (k: keyof IntygUppgifter, v: string) => {
    try { await p.onSparaIntyg(JSON.stringify({ ...lasIntyg(p.intyg?.text), [k]: v })); }
    catch (e) { p.visaMeddelande(`Kunde inte spara: ${(e as Error).message}`); }
  };

  // ---- Status ----
  const sattStatus = (x: Punkt, ny: Punkt["status"]) => {
    if (p.lasläge) return;
    if (ny === x.status || ny === "") { if (x.status) void p.onAndra(x.rad, FALT[x.status], "false"); }
    else void p.onAndra(x.rad, FALT[ny], "true");
  };

  const avsnittEjAktuellt = async (a: Avsnitt) => {
    const oppna = a.punkter.filter((x) => !x.status);
    setArbetar(true);
    try {
      if (oppna.length) await Promise.all(oppna.map((x) => p.onAndra(x.rad, "ejAktuell", "true")));
      else await Promise.all(a.punkter.filter((y) => y.status === "ea").map((x) => p.onAndra(x.rad, "ejAktuell", "false")));
    } finally { setArbetar(false); }
    if (oppna.length) setStangda((s) => new Set(s ?? []).add(a.namn));
  };

  // ---- Redigera punkter ----
  const nyPunkt = async (a: Avsnitt) => {
    const text = window.prompt(`Ny kontrollpunkt i ${a.namn || "kontrollen"}:`);
    if (!text?.trim()) return;
    await p.onNyaPunkter([{ avsnitt: a.punkter[0]?.avsnitt ?? "", kontrollpunkt: text.trim() }]);
  };
  const nyttAvsnitt = async () => {
    const namn = window.prompt("Namn på det nya avsnittet:");
    if (!namn?.trim()) return;
    const text = window.prompt(`Första kontrollpunkten i ${namn.trim()}:`);
    if (!text?.trim()) return;
    await p.onNyaPunkter([{ avsnitt: namn.trim(), kontrollpunkt: text.trim() }]);
  };
  const dopOmAvsnitt = async (a: Avsnitt) => {
    const nytt = window.prompt("Nytt namn på avsnittet:", a.namn);
    if (!nytt?.trim() || nytt.trim() === a.namn) return;
    setArbetar(true);
    try { await Promise.all(a.punkter.map((x) => p.onAndra(x.rad, "avsnitt", nytt.trim()))); }
    finally { setArbetar(false); }
  };
  const taBortPunkt = (x: Punkt) => {
    if (window.confirm(`Ta bort punkt ${x.nr}?\n\n${x.text}`)) p.onTaBort([x.rad.id]);
  };
  const andraText = async (x: Punkt, text: string) => {
    if (!text) { p.visaMeddelande("Kontrollpunkten kan inte vara tom. Ta bort den i stället."); return; }
    let rad: ListRad | null = x.rad;
    // Gamla punkter med avsnittet i texten får avsnittet sparat separat.
    if (!(x.rad.data.avsnitt ?? "").trim() && x.avsnitt) rad = await p.onAndra(x.rad, "avsnitt", x.avsnitt);
    if (rad) await p.onAndra(rad, "kontrollpunkt", text);
  };

  // ---- Utskrift och Word ----
  const dokument = () => pekDokument(p.kontroll.namn, p.rader ?? [], p.projekt, p.intyg?.text, medEa);
  const skrivUt = () => { skrivUtBlock(dokument()); };
  const word = async () => {
    setArbetar(true);
    try { await laddaNerWord(dokument(), `Projekteringsegenkontroll ${p.projekt?.nummer ?? ""} ${p.projekt?.namn ?? ""}`.trim()); }
    catch (e) { p.visaMeddelande(`Word-filen kunde inte skapas: ${(e as Error).message}`); }
    finally { setArbetar(false); }
  };

  const synligPunkt = (x: Punkt) => filter === "alla"
    || (filter === "oppna" ? !arKlar(x) : filter === "kompl" ? x.status === "kompl" : !!(x.rad.data.ovrigt ?? "").trim());

  if (!p.rader) return <p className="dampad">Hämtar…</p>;

  return (
    <div className="pek" style={{ "--pek-text": `${bredder.text}px`, "--pek-kommentar": `${bredder.kommentar}px` } as React.CSSProperties}>
      <section className="pek-huvud">
        <div className="pek-uppg"><span>Objekt</span><b>{p.projekt?.namn || "–"}</b></div>
        <div className="pek-uppg"><span>Kund</span><b>{p.projekt?.kund || "–"}</b></div>
        <label className="pek-uppg"><span>Projekteringsledare</span>
          <SparaFalt etikett="Projekteringsledare" varde={uppg.projekteringsledare} lasläge={p.lasläge} onSpara={(v) => void sparaUppgift("projekteringsledare", v)} />
        </label>
        <label className="pek-uppg"><span>Projektör</span>
          <SparaFalt etikett="Projektör" varde={uppg.projektor} lasläge={p.lasläge} onSpara={(v) => void sparaUppgift("projektor", v)} />
        </label>
        <p className="pek-not">Projekteringsledare och projektör är samma som i Projekteringsintyget.</p>
      </section>

      <div className="pek-verktyg">
        <div className="pek-framsteg" title={`${klarProcent} % avklarat`}>
          <div className="pek-stapel" role="progressbar" aria-valuenow={klarProcent} aria-valuemin={0} aria-valuemax={100}>
            <i className="ok" style={{ width: `${alla.length ? (antalOk / alla.length) * 100 : 0}%` }} />
            <i className="kompl" style={{ width: `${alla.length ? (antalKompl / alla.length) * 100 : 0}%` }} />
            <i className="ea" style={{ width: `${alla.length ? (antalEa / alla.length) * 100 : 0}%` }} />
          </div>
          <span><b>{antalOk}</b> utförda · <b className="kompl">{antalKompl}</b> komplettering krävs · <b>{antalEa}</b> ej aktuella · <b>{antalOppna}</b> öppna</span>
        </div>
        <div className="pek-filter" role="group" aria-label="Visa">
          {([["alla", "Alla"], ["oppna", `Ej klara (${antalOppna + antalKompl})`], ["kompl", `Komplettering (${antalKompl})`], ["kommentar", "Med kommentar"]] as const).map(([v, t]) => (
            <button key={v} className={filter === v ? "aktiv" : ""} aria-pressed={filter === v} onClick={() => setFilter(v)}>{t}</button>
          ))}
        </div>
        <div className="knappar">
          <button className="knapp" onClick={() => setStangda(stangda?.size ? new Set() : new Set(avsnitt.map((a) => a.namn)))}>
            {stangda?.size ? "Fäll ut alla" : "Fäll ihop alla"}
          </button>
          {!p.lasläge && <button className={`knapp ${redigera ? "primar" : ""}`} onClick={() => setRedigera((r) => !r)}
            title="Ändra texter, lägg till och ta bort punkter och avsnitt">{redigera ? "Klar med redigering" : "✎ Redigera punkter"}</button>}
          <label className="kryssrad pek-medea" title="Ta med punkter som är markerade Ej aktuell i utskrift och Word">
            <input type="checkbox" checked={medEa} onChange={(e) => vaxlaMedEa(e.target.checked)} /> Med ej aktuella
          </label>
          <button className="knapp" onClick={skrivUt} title="Utskrift i HECO:s dokumentmall. Välj Spara som PDF i utskriftsrutan för en PDF.">Skriv ut / PDF</button>
          <button className="knapp" disabled={arbetar} onClick={() => void word()} title="Word-fil i HECO:s dokumentmall">Word</button>
          <button className="knapp" onClick={() => p.onFlik("projekteringsintyg")} title="Egenkontrollen skrivs ut som bilaga till projekteringsintyget">Till projekteringsintyget</button>
        </div>
        <div className="pek-kolumner" aria-hidden="true">
          <span className="pek-nr">Nr</span>
          <span>Kontrollpunkt<Handtag kolumn="text" bredder={bredder} setBredder={setBredder} /></span>
          <span>Status</span>
          <span>Kommentar<Handtag kolumn="kommentar" bredder={bredder} setBredder={setBredder} /></span>
          <span className="pek-sign">Sign.</span>
        </div>
      </div>

      {alla.length === 0 && <p className="tomruta">Kontrollen har inga punkter än. {!p.lasläge && "Klicka på Redigera punkter och lägg till ett avsnitt."}</p>}

      {avsnitt.map((a) => {
        const synliga = a.punkter.filter(synligPunkt);
        if (!synliga.length && !redigera) return null;
        const klara = a.punkter.filter(arKlar).length;
        const avsnittKompl = a.punkter.filter((x) => x.status === "kompl").length;
        const allaEa = a.punkter.length > 0 && a.punkter.every((x) => x.status === "ea");
        const stangd = arStangd(a.namn) && !redigera;
        return (
          <section key={a.namn || "-"} className={`pek-avsnitt${allaEa ? " ej-aktuellt" : ""}${klara === a.punkter.length ? " klart" : ""}`}>
            <header>
              <button className="pek-fall" aria-expanded={!stangd} onClick={() => vaxla(a.namn)}>
                <span className="pil" aria-hidden="true">{stangd ? "▸" : "▾"}</span>
                <h2>{a.namn ? `${a.nr}. ${a.namn}` : "Kontrollpunkter"}</h2>
                <span className="pek-rakna">{allaEa ? "Ej aktuellt" : `${klara} / ${a.punkter.length}`}</span>
                {avsnittKompl > 0 && <span className="pek-komplmarke" title="Punkter där komplettering krävs">{avsnittKompl} kompl.</span>}
                <span className="pek-ministapel" aria-hidden="true"><i style={{ width: `${a.punkter.length ? (klara / a.punkter.length) * 100 : 0}%` }} /></span>
              </button>
              {!p.lasläge && (
                <div className="pek-avsnittknappar">
                  {redigera && a.namn && a.namn !== UTAN_AVSNITT && <button className="knapp liten" disabled={arbetar} onClick={() => void dopOmAvsnitt(a)}>Byt namn</button>}
                  {redigera && <button className="knapp liten" onClick={() => void nyPunkt(a)}>+ Punkt</button>}
                  {!redigera && (klara < a.punkter.length || allaEa) && (
                    <button className="knapp liten" disabled={arbetar} onClick={() => void avsnittEjAktuellt(a)}
                      title={allaEa ? "Gör avsnittets punkter öppna igen" : "Markera avsnittets öppna punkter som ej aktuella (t.ex. om disciplinen inte finns i projektet)"}>
                      {allaEa ? "Återställ" : "Ej aktuellt"}
                    </button>
                  )}
                </div>
              )}
            </header>
            {!stangd && (
              <ol className="pek-punkter">
                {(redigera ? a.punkter : synliga).map((x) => {
                  const genvag = GENVAGAR.find(([re]) => re.test(x.text));
                  return (
                    <li key={x.rad.id} className={`pek-punkt ${x.status === "ok" ? "s-ok" : x.status === "kompl" ? "s-kompl" : x.status === "ea" ? "s-ea" : ""}`}>
                      <span className="pek-nr">{x.nr}</span>
                      <div className="pek-text">
                        {redigera
                          ? <SparaFalt etikett={`Text för punkt ${x.nr}`} varde={x.text} flerrad lasläge={p.lasläge} onSpara={(v) => void andraText(x, v)} />
                          : <span>{x.text}</span>}
                        {genvag && !redigera && <button className="pek-genvag" onClick={() => p.onFlik(genvag[1])}>→ {genvag[2]}</button>}
                      </div>
                      {redigera ? (
                        <button className="knapp liten fara pek-tabort" onClick={() => taBortPunkt(x)} title="Ta bort punkten">✕</button>
                      ) : (
                        <>
                          <div className="pek-status" role="group" aria-label={`Status för punkt ${x.nr}`}>
                            <button className={`ok${x.status === "ok" ? " vald" : ""}`} aria-pressed={x.status === "ok"} disabled={p.lasläge}
                              onClick={() => sattStatus(x, "ok")} title="Utförd – datum och signatur fylls i">✓ OK</button>
                            <button className={`kompl${x.status === "kompl" ? " vald" : ""}`} aria-pressed={x.status === "kompl"} disabled={p.lasläge}
                              onClick={() => sattStatus(x, "kompl")} title="Punkten behöver kompletteras – skriv vad i kommentaren">Komplettering krävs</button>
                            <button className={`ea${x.status === "ea" ? " vald" : ""}`} aria-pressed={x.status === "ea"} disabled={p.lasläge}
                              onClick={() => sattStatus(x, "ea")} title="Gäller inte det här projektet">Ej aktuell</button>
                          </div>
                          <div className="pek-kommentar">
                            <SparaFalt etikett={`Kommentar till punkt ${x.nr}`} varde={x.rad.data.ovrigt ?? ""} lasläge={p.lasläge}
                              placeholder={p.lasläge ? "" : "Kommentar"} onSpara={(v) => void p.onAndra(x.rad, "ovrigt", v)} />
                          </div>
                          <span className="pek-sign" title="Signatur och datum">
                            {x.status ? <>{x.rad.data.sign}<small>{valtDatum(x.rad.data.datum)}</small></> : ""}
                          </span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        );
      })}

      {redigera && !p.lasläge && (
        <div className="pek-nyttavsnitt"><button className="knapp" onClick={() => void nyttAvsnitt()}>+ Nytt avsnitt</button></div>
      )}
    </div>
  );
}
