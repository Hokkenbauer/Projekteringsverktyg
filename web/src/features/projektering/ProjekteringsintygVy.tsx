import { useEffect, useState } from "react";
import { useFordrojdSparning } from "../../lib/sparning";
import { api } from "../../lib/api";
import type { Anteckningar, ListRad, Projekt } from "../../lib/typer";
import { valtDatum } from "../listor/ListVy";
import { skrivUtBlock, type Block, type BlockDokument, type TabellRad } from "../../lib/dokumentBlock";
import { gruppera, pekMedEa } from "../kontroller/ProjekteringsegenkontrollVy";

type Handling = { handling: string; beskrivning: string; datum: string; signProjektor: string; signProjekteringsledare: string };
type Anvisning = { dokument: string; typ: string; daterad: string };
type Intyg = {
  objekt: string; slutkund: string; bestallare: string; projekteringsledare: string; projektor: string; projektnummer: string;
  omfattning: string; handlingar: Handling[]; anvisningar: Anvisning[]; avsteg: string;
  riskanalysUtford: string; ingaRisker: boolean; riskerUppdagade: boolean;
  materialEntreprenor: boolean; materialIntygat: boolean; ortDatum: string; signatur: string;
};

const MATERIAL_ENTREPRENOR = "I framtagna handlingar framgår det ej vilket material som skall användas och därmed åligger det entreprenören att säkerställa att valt material följer de regler och anvisningar som kravställs i projektet.";
const MATERIAL_INTYGAT = "Härmed intygas att valt material i projekteringen faller inom ramen för de anvisningar som kravställs i projektet.";

const tomHandling: Handling = { handling: "", beskrivning: "", datum: "", signProjektor: "", signProjekteringsledare: "" };
const tomAnvisning: Anvisning = { dokument: "", typ: "", daterad: "" };

function las(text: string | undefined, projekt: Projekt | null): Intyg {
  const grund: Intyg = {
    objekt: projekt?.namn ?? "", slutkund: projekt?.kund ?? "", bestallare: "", projekteringsledare: "", projektor: "",
    projektnummer: projekt?.nummer ?? "", omfattning: "", handlingar: [], anvisningar: [], avsteg: "",
    riskanalysUtford: "", ingaRisker: false, riskerUppdagade: false, materialEntreprenor: false, materialIntygat: false,
    ortDatum: "", signatur: "",
  };
  try { if (text) return { ...grund, ...JSON.parse(text) }; } catch { /* börja om */ }
  return grund;
}

export type Egenkontroll = { namn: string; rader: ListRad[] };

/** Projekteringsegenkontrollerna i projektet (bilagan till intyget). */
export async function hamtaEgenkontroller(projektId: string): Promise<Egenkontroll[]> {
  const kontroller = await api<{ id: string; namn: string }[]>(`/api/projekt/${projektId}/kontroller?typ=projektering`);
  return Promise.all(kontroller.map(async (k) => ({
    namn: k.namn,
    rader: (await api<ListRad[]>(`/api/projekt/${projektId}/listor/kontroll-${k.id}`)).sort((a, b) => a.ordning - b.ordning),
  })));
}

/**
 * Projekteringsintyget som dokument enligt mallen "Projekteringsintyg och egenkontroll": samma rubriker, rutor
 * och tomma rader att fylla i för hand. Projekteringsegenkontrollerna (egen) blir bilaga på egna sidor.
 */
export function intygDokument(text: string | undefined, projekt: Projekt | null, egen: Egenkontroll[], medEa = pekMedEa()): BlockDokument {
  const intyg = las(text, projekt);
  const ruta = (b: boolean) => (b ? "✔" : "");
  const fyll = <T,>(lista: T[], minst: number, tom: T) => [...lista, ...Array.from({ length: Math.max(0, minst - lista.length) }, () => tom)];
  const bilaga = egen.filter((k) => k.rader.length).flatMap((k): Block[] => {
    const rader: TabellRad[] = [];
    // Punkter som är Ej aktuell tas bara med om man valt det i Projekteringsegenkontrollen; avsnitt och punkter numreras om.
    let nr = 0;
    for (const a of gruppera(k.rader)) {
      const punkter = medEa ? a.punkter : a.punkter.filter((x) => x.status !== "ea");
      if (!punkter.length) continue;
      nr++;
      if (a.namn) rader.push(`${nr}. ${a.namn}`);
      punkter.forEach((x, i) => rader.push([`${nr}.${i + 1}`, x.text, x.status === "ok" ? "OK" : x.status === "kompl" ? "Kompl." : x.status === "ea" ? "E.A." : "", x.rad.data.ovrigt ?? "", valtDatum(x.rad.data.datum), x.rad.data.sign ?? ""]));
    }
    return [
      { typ: "sidbrytning" },
      { typ: "rubrik", text: `Egenkontroll – ${k.namn}` },
      { typ: "text", kursiv: true, text: `OK = utförd, Kompl. = komplettering krävs${medEa ? ", E.A. = ej aktuell" : ". Punkter som inte är aktuella är inte med"}. Signering intygar att punkten är kontrollerad.` },
      { typ: "tabell", kolumner: ["Nr", "Kontrollpunkt", "Status", "Kommentar", "Datum", "Sign."], bredder: [6, 47, 7, 22, 11, 7], centrera: [2], rader },
    ];
  });
  return {
    titel: "Projekteringsintyg och egenkontroll", kategori: "Projekteringsintyg", projekt,
    block: [
      { typ: "form", bredd: 66, etikettBredd: 34, rader: [["Objekt:", intyg.objekt], ["Slutkund:", intyg.slutkund], ["Beställare:", intyg.bestallare],
        ["Projekteringsledare:", intyg.projekteringsledare], ["Projektör:", intyg.projektor], ["Projektnummer:", intyg.projektnummer]] },
      { typ: "rubrik", text: "Omfattning" },
      { typ: "rutor", rader: [[{ etikett: "Projektets omfattning:", varde: intyg.omfattning, hojd: 34 }]] },
      { typ: "rubrik", text: "Upprättade handlingar" },
      { typ: "text", text: "Signering av handling intygar kontroll av handlingen.", kursiv: true },
      { typ: "tabell", kolumner: ["Handling", "Beskrivning", "Datum", "Sign. Projektör", "Sign. Projekterings\u00ADledare"], bredder: [20, 38, 12, 13, 17], radhojd: 7.5,
        rader: fyll(intyg.handlingar, 6, tomHandling).map((h) => [h.handling, h.beskrivning, valtDatum(h.datum), h.signProjektor, h.signProjekteringsledare]) },
      { typ: "rubrik", text: "Anvisningar för projektering" },
      { typ: "tabell", kolumner: ["Dokument", "Typ av dokument", "Daterad"], bredder: [44, 43, 13], radhojd: 5.5,
        rader: fyll(intyg.anvisningar, 6, tomAnvisning).map((a) => [a.dokument, a.typ, valtDatum(a.daterad)]) },
      { typ: "rubrik", text: "Avsteg i projektering" },
      { typ: "rutor", rader: [[{ etikett: "Avsteg som har gjorts under projektering:", varde: intyg.avsteg, hojd: 22 }]] },
      { typ: "rubrik", text: "Riskanalys för kontrollplan" },
      { typ: "rutor", rader: [[{ etikett: "Riskanalys utförd, datum/signatur:", varde: intyg.riskanalysUtford, hojd: 11 }]] },
      { typ: "text", text: "Resultat från riskanalys:", fet: true },
      { typ: "tabell", kolumner: ["Inga risker uppdagade", "Risker uppdagade. Riskanalys bifogas som bilaga"], bredder: [50, 50], bredd: 66, centrera: [0, 1], radhojd: 12,
        rader: [[ruta(intyg.ingaRisker), ruta(intyg.riskerUppdagade)]] },
      { typ: "rubrik", text: "Materialval" },
      { typ: "tabell", kolumner: ["", ""], utanRubrik: true, bredder: [80, 20], centrera: [1],
        rader: [[MATERIAL_ENTREPRENOR, ruta(intyg.materialEntreprenor)], [MATERIAL_INTYGAT, ruta(intyg.materialIntygat)]] },
      { typ: "luft", mm: 5 },
      { typ: "text", text: "Härmed intygas ovan uppgifter:", fet: true },
      { typ: "rutor", rader: [[{ etikett: "Ort / datum", varde: intyg.ortDatum, hojd: 12 }], [{ etikett: "Signatur", varde: intyg.signatur, hojd: 12 }]] },
      ...bilaga,
    ],
  };
}

type Props = {
  projektId?: string;
  projekt: Projekt | null;
  grupp: string;
  rubrik: string;
  text: Anteckningar | undefined;
  onSparaText: (text: string) => Promise<void>;
  lasläge: boolean;
  visaMeddelande: (t: string) => void;
};

/** Projekteringsintyg: ett formulär per projekt. Utskrift/PDF enligt mallen Projekteringsintyg och egenkontroll, med projekteringsegenkontrollen som bilaga. */
export function ProjekteringsintygVy(p: Props) {
  const [intyg, setIntyg] = useState<Intyg>(() => las(p.text?.text, p.projekt));
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const sparning = useFordrojdSparning();

  useEffect(() => { if (status === "sparat" && p.text?.text) setIntyg(las(p.text.text, p.projekt)); }, [p.text?.text]);
  
  const spara = (ny: Intyg) => {
    setIntyg(ny);
    setStatus("osparat");
    sparning.planera(async () => {
      setStatus("sparar");
      try { await p.onSparaText(JSON.stringify(ny)); setStatus("sparat"); }
      catch (e) { setStatus("osparat"); p.visaMeddelande(`Kunde inte spara: ${(e as Error).message}`); }
    }, 1000);
  };
  const andra = <K extends keyof Intyg>(k: K, v: Intyg[K]) => spara({ ...intyg, [k]: v });

  const falt = (k: "objekt" | "slutkund" | "bestallare" | "projekteringsledare" | "projektor" | "projektnummer" | "riskanalysUtford" | "ortDatum" | "signatur", etikett: string) => (
    <label className="riskfalt">
      <span>{etikett}</span>
      <input value={intyg[k]} readOnly={p.lasläge} onChange={(e) => andra(k, e.target.value)} />
    </label>
  );

  const tabell = <T extends Handling | Anvisning>(lista: T[], nyckel: "handlingar" | "anvisningar", kolumner: [keyof T & string, string, string?][], tom: T) => (
    <table className="formtabell">
      <thead><tr>{kolumner.map(([k, r]) => <th key={k}>{r}</th>)}{!p.lasläge && <th />}</tr></thead>
      <tbody>
        {lista.map((rad, i) => (
          <tr key={i}>
            {kolumner.map(([k, , typ]) => (
              <td key={k}>
                <input type={typ ?? "text"} value={String(rad[k] ?? "")} readOnly={p.lasläge}
                  onChange={(e) => andra(nyckel, lista.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) as Intyg[typeof nyckel])} />
              </td>
            ))}
            {!p.lasläge && <td><button className="knapp liten" title="Ta bort raden" onClick={() => andra(nyckel, lista.filter((_, j) => j !== i) as Intyg[typeof nyckel])}>✕</button></td>}
          </tr>
        ))}
        {!p.lasläge && (
          <tr><td colSpan={kolumner.length + 1}>
            <button className="knapp" onClick={() => andra(nyckel, [...lista, { ...tom }] as Intyg[typeof nyckel])}>+ Lägg till rad</button>
          </td></tr>
        )}
      </tbody>
    </table>
  );

  const [medEgenkontroll, setMedEgenkontroll] = useState(true);

  /** Utskrift enligt mallen "Projekteringsintyg och egenkontroll", med projekteringsegenkontrollen som bilaga om den är vald. */
  const skrivUt = async () => {
    const f = window.open("", "_blank");
    if (!f) { alert("Webbläsaren stoppade utskriftsfönstret. Tillåt popup-fönster för sidan."); return; }
    f.document.write("<p style='font-family:Arial'>Förbereder utskriften…</p>");
    await sparning.nu();
    let egen: Egenkontroll[] = [];
    if (medEgenkontroll && p.projektId) {
      try { egen = await hamtaEgenkontroller(p.projektId); } catch { egen = []; }
    }
    skrivUtBlock(intygDokument(JSON.stringify(intyg), p.projekt, egen), f);
  };

  const kryss = (k: "ingaRisker" | "riskerUppdagade" | "materialEntreprenor" | "materialIntygat", text: string) => (
    <label className="kryssrad">
      <input type="checkbox" checked={intyg[k]} disabled={p.lasläge} onChange={(e) => andra(k, e.target.checked)} />
      <span>{text}</span>
    </label>
  );

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          <label className="kryssrad" title="Projekteringsegenkontrollerna (under Kontroller) skrivs ut som bilaga efter intyget">
            <input type="checkbox" checked={medEgenkontroll} onChange={(e) => setMedEgenkontroll(e.target.checked)} /> Med projekteringsegenkontroll
          </label>
          <button className="knapp" onClick={() => void skrivUt()}>Skriv ut / PDF</button>
        </div>
      </div>
      <p className="ingress">
        Ett intyg per projekt. Objekt, slutkund och projektnummer hämtas från projektet första gången. Allt sparas automatiskt
        {status === "sparar" ? " (sparar…)" : status === "osparat" ? " (osparade ändringar)" : ""}.
      </p>
      <div className="intyg">
        <section className="panel riskhuvud">
          {falt("objekt", "Objekt")}
          {falt("slutkund", "Slutkund")}
          {falt("bestallare", "Beställare")}
          {falt("projektnummer", "Projektnummer")}
          {falt("projekteringsledare", "Projekteringsledare")}
          {falt("projektor", "Projektör")}
        </section>
        <section className="panel">
          <h2>Omfattning</h2>
          <label className="risksektion"><span>Projektets omfattning</span>
            <textarea rows={4} value={intyg.omfattning} readOnly={p.lasläge} onChange={(e) => andra("omfattning", e.target.value)} /></label>
        </section>
        <section className="panel">
          <h2>Upprättade handlingar</h2>
          <p className="dampad liten">Signering av handling intygar kontroll av handlingen.</p>
          {tabell(intyg.handlingar, "handlingar", [["handling", "Handling"], ["beskrivning", "Beskrivning"], ["datum", "Datum", "date"], ["signProjektor", "Sign. Projektör"], ["signProjekteringsledare", "Sign. Projekteringsledare"]], tomHandling)}
        </section>
        <section className="panel">
          <h2>Anvisningar för projektering</h2>
          {tabell(intyg.anvisningar, "anvisningar", [["dokument", "Dokument"], ["typ", "Typ av dokument"], ["daterad", "Daterad", "date"]], tomAnvisning)}
        </section>
        <section className="panel">
          <h2>Avsteg i projektering</h2>
          <label className="risksektion"><span>Avsteg som har gjorts under projektering</span>
            <textarea rows={3} value={intyg.avsteg} readOnly={p.lasläge} onChange={(e) => andra("avsteg", e.target.value)} /></label>
        </section>
        <section className="panel">
          <h2>Riskanalys för kontrollplan</h2>
          {falt("riskanalysUtford", "Riskanalys utförd, datum/signatur")}
          {kryss("ingaRisker", "Inga risker uppdagade")}
          {kryss("riskerUppdagade", "Risker uppdagade. Riskanalys bifogas som bilaga")}
        </section>
        <section className="panel">
          <h2>Materialval</h2>
          {kryss("materialEntreprenor", MATERIAL_ENTREPRENOR)}
          {kryss("materialIntygat", MATERIAL_INTYGAT)}
        </section>
        <section className="panel riskhuvud">
          <p className="helrad">Härmed intygas ovan uppgifter</p>
          {falt("ortDatum", "Ort / datum")}
          {falt("signatur", "Signatur")}
        </section>
      </div>
    </>
  );
}
