import { useEffect, useMemo, useRef, useState } from "react";
import type { Anteckningar, ListRad, Projekt } from "../../lib/typer";
import { laddaNerWord, skrivUtBlock, type Block, type BlockDokument } from "../../lib/dokumentBlock";
import { valtDatum } from "../listor/ListVy";
import type { Kontroll } from "./KontrollerVy";

/**
 * Projekteringsegenkontroll som ett ifyllbart formulär: punkterna grupperade i avsnitt, status
 * OK / Ej aktuell med automatisk datum och signatur, kommentar per punkt, framsteg per avsnitt och
 * utskrift (PDF) och Word i dokumenttemat "HECO kombinerad".
 * Raderna är vanliga listrader (lista "kontroll-{id}"), så livesynk och ändringslogg fungerar som i andra listor.
 */

type Punkt = { rad: ListRad; avsnitt: string; text: string; nr: string; status: "ok" | "ea" | "" };
type Avsnitt = { namn: string; nr: number; punkter: Punkt[] };
type Filter = "alla" | "oppna" | "kommentar";

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
  r.data.kontrollerad === "true" ? "ok" : r.data.ejAktuell === "true" ? "ea" : "";

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

type IntygUppgifter = { projekteringsledare: string; projektor: string };

function lasIntyg(t: string | undefined): Record<string, unknown> {
  try { return t ? JSON.parse(t) as Record<string, unknown> : {}; } catch { return {}; }
}

/** Textfält som sparar när man lämnar det (eller trycker Enter), så att varje tangent inte blir en ändring. */
function SparaFalt({ varde, onSpara, placeholder, lasläge, flerrad, etikett }: {
  varde: string; onSpara: (v: string) => void; placeholder?: string; lasläge: boolean; flerrad?: boolean; etikett: string;
}) {
  const [text, setText] = useState(varde);
  const fokus = useRef(false);
  useEffect(() => { if (!fokus.current) setText(varde); }, [varde]);
  const spara = () => { fokus.current = false; if (text.trim() !== varde.trim()) onSpara(text.trim()); };
  const gemensamt = {
    value: text, placeholder, readOnly: lasläge, "aria-label": etikett,
    onFocus: () => { fokus.current = true; },
    onBlur: spara,
  };
  return flerrad
    ? <textarea {...gemensamt} rows={2} onChange={(e) => setText(e.target.value)} />
    : <input type="text" {...gemensamt} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setText(varde); fokus.current = false; } }} />;
}

export function ProjekteringsegenkontrollVy(p: Props) {
  const avsnitt = useMemo(() => gruppera(p.rader ?? []), [p.rader]);
  const alla = avsnitt.flatMap((a) => a.punkter);
  const antalOk = alla.filter((x) => x.status === "ok").length;
  const antalEa = alla.filter((x) => x.status === "ea").length;
  const antalOppna = alla.length - antalOk - antalEa;
  const klarProcent = alla.length ? Math.round(((antalOk + antalEa) / alla.length) * 100) : 0;

  const [filter, setFilter] = useState<Filter>("alla");
  const [redigera, setRedigera] = useState(false);
  const [arbetar, setArbetar] = useState(false);

  // Avsnitt som är helt klara är ihopfällda när kontrollen öppnas.
  const [stangda, setStangda] = useState<Set<string> | null>(null);
  const forbered = useRef<string | null>(null);
  useEffect(() => {
    if (!p.rader || forbered.current === p.kontroll.id) return;
    forbered.current = p.kontroll.id;
    setRedigera(false);
    setStangda(new Set(avsnitt.filter((a) => a.punkter.length && a.punkter.every((x) => x.status)).map((a) => a.namn)));
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
    if (ny === x.status || ny === "") void p.onAndra(x.rad, x.status === "ea" ? "ejAktuell" : "kontrollerad", "false");
    else void p.onAndra(x.rad, ny === "ok" ? "kontrollerad" : "ejAktuell", "true");
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
  const dokument = (): BlockDokument => {
    const ruta = (s: Punkt["status"]) => (s === "ok" ? "OK" : s === "ea" ? "E.A." : "");
    const rader: (string[] | string)[] = [];
    for (const a of avsnitt) {
      const klara = a.punkter.filter((x) => x.status).length;
      if (a.namn) rader.push(`${a.nr}. ${a.namn}${a.punkter.every((x) => x.status === "ea") ? " – ej aktuellt" : ` (${klara} av ${a.punkter.length})`}`);
      for (const x of a.punkter) rader.push([x.nr, x.text, ruta(x.status), x.rad.data.ovrigt ?? "", valtDatum(x.rad.data.datum), x.rad.data.sign ?? ""]);
    }
    const block: Block[] = [
      { typ: "form", rader: [
        ["Objekt", p.projekt?.namn ?? ""], ["Kund", p.projekt?.kund ?? ""], ["Projektnummer", p.projekt?.nummer ?? ""],
        ["Projekteringsledare", uppg.projekteringsledare], ["Projektör", uppg.projektor],
      ] },
      { typ: "rubrik", text: p.kontroll.namn },
      { typ: "text", text: `${antalOk} av ${alla.length} punkter utförda · ${antalEa} ej aktuella · ${antalOppna} öppna. OK = utförd, E.A. = ej aktuell. Signering intygar att punkten är kontrollerad.`, kursiv: true },
      { typ: "tabell", kolumner: ["Nr", "Kontrollpunkt", "Status", "Kommentar", "Datum", "Sign."], bredder: [6, 47, 7, 22, 11, 7], centrera: [2], rader },
    ];
    return { titel: "Projekteringsegenkontroll", kategori: "Egenkontroll", projekt: p.projekt, block };
  };
  const skrivUt = () => { skrivUtBlock(dokument()); };
  const word = async () => {
    setArbetar(true);
    try { await laddaNerWord(dokument(), `Projekteringsegenkontroll ${p.projekt?.nummer ?? ""} ${p.projekt?.namn ?? ""}`.trim()); }
    catch (e) { p.visaMeddelande(`Word-filen kunde inte skapas: ${(e as Error).message}`); }
    finally { setArbetar(false); }
  };

  const synligPunkt = (x: Punkt) => filter === "alla" || (filter === "oppna" ? !x.status : !!(x.rad.data.ovrigt ?? "").trim());

  if (!p.rader) return <p className="dampad">Hämtar…</p>;

  return (
    <div className="pek">
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
            <i className="ea" style={{ width: `${alla.length ? (antalEa / alla.length) * 100 : 0}%` }} />
          </div>
          <span><b>{antalOk}</b> utförda · <b>{antalEa}</b> ej aktuella · <b>{antalOppna}</b> öppna</span>
        </div>
        <div className="pek-filter" role="group" aria-label="Visa">
          {([["alla", "Alla"], ["oppna", `Öppna (${antalOppna})`], ["kommentar", "Med kommentar"]] as const).map(([v, t]) => (
            <button key={v} className={filter === v ? "aktiv" : ""} aria-pressed={filter === v} onClick={() => setFilter(v)}>{t}</button>
          ))}
        </div>
        <div className="knappar">
          <button className="knapp" onClick={() => setStangda(stangda?.size ? new Set() : new Set(avsnitt.map((a) => a.namn)))}>
            {stangda?.size ? "Fäll ut alla" : "Fäll ihop alla"}
          </button>
          {!p.lasläge && <button className={`knapp ${redigera ? "primar" : ""}`} onClick={() => setRedigera((r) => !r)}
            title="Ändra texter, lägg till och ta bort punkter och avsnitt">{redigera ? "Klar med redigering" : "✎ Redigera punkter"}</button>}
          <button className="knapp" onClick={skrivUt} title="Utskrift i HECO:s dokumentmall. Välj Spara som PDF i utskriftsrutan för en PDF.">Skriv ut / PDF</button>
          <button className="knapp" disabled={arbetar} onClick={() => void word()} title="Word-fil i HECO:s dokumentmall">Word</button>
          <button className="knapp" onClick={() => p.onFlik("projekteringsintyg")} title="Egenkontrollen skrivs ut som bilaga till projekteringsintyget">Till projekteringsintyget</button>
        </div>
      </div>

      {alla.length === 0 && <p className="tomruta">Kontrollen har inga punkter än. {!p.lasläge && "Klicka på Redigera punkter och lägg till ett avsnitt."}</p>}

      {avsnitt.map((a) => {
        const synliga = a.punkter.filter(synligPunkt);
        if (!synliga.length && !redigera) return null;
        const klara = a.punkter.filter((x) => x.status).length;
        const allaEa = a.punkter.length > 0 && a.punkter.every((x) => x.status === "ea");
        const stangd = arStangd(a.namn) && !redigera;
        return (
          <section key={a.namn || "-"} className={`pek-avsnitt${allaEa ? " ej-aktuellt" : ""}${klara === a.punkter.length ? " klart" : ""}`}>
            <header>
              <button className="pek-fall" aria-expanded={!stangd} onClick={() => vaxla(a.namn)}>
                <span className="pil" aria-hidden="true">{stangd ? "▸" : "▾"}</span>
                <h2>{a.namn ? `${a.nr}. ${a.namn}` : "Kontrollpunkter"}</h2>
                <span className="pek-rakna">{allaEa ? "Ej aktuellt" : `${klara} / ${a.punkter.length}`}</span>
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
                    <li key={x.rad.id} className={`pek-punkt ${x.status === "ok" ? "s-ok" : x.status === "ea" ? "s-ea" : ""}`}>
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
