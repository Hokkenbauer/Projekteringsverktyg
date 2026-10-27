import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { Anteckningar, ListRad, Projekt } from "../../lib/typer";
import { oppnaDokument } from "../../lib/dokumenttema";
import { valtDatum } from "../listor/ListVy";
import { blockHtml } from "../../lib/dokumentBlock";
import { gruppera } from "../kontroller/ProjekteringsegenkontrollVy";

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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => { if (status === "sparat" && p.text?.text) setIntyg(las(p.text.text, p.projekt)); }, [p.text?.text]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const spara = (ny: Intyg) => {
    setIntyg(ny);
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
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

  /** Projekteringsegenkontrollerna i projektet (för bilagan i utskriften). */
  const hamtaEgenkontroller = async () => {
    if (!p.projektId) return [];
    const kontroller = await api<{ id: string; namn: string }[]>(`/api/projekt/${p.projektId}/kontroller?typ=projektering`);
    return Promise.all(kontroller.map(async (k) => ({
      namn: k.namn,
      rader: (await api<ListRad[]>(`/api/projekt/${p.projektId}/listor/kontroll-${k.id}`)).sort((a, b) => a.ordning - b.ordning),
    })));
  };

  /** Utskrift enligt mallen "Projekteringsintyg och egenkontroll": samma rubriker, rutor och tomma rader att fylla i för hand. */
  const skrivUt = async () => {
    const f = window.open("", "_blank");
    if (!f) { alert("Webbläsaren stoppade utskriftsfönstret. Tillåt popup-fönster för sidan."); return; }
    f.document.write("<p style='font-family:Arial'>Förbereder utskriften…</p>");
    let egen: { namn: string; rader: ListRad[] }[] = [];
    if (medEgenkontroll) {
      try { egen = await hamtaEgenkontroller(); } catch { egen = []; }
    }
    const ruta = (b: boolean) => (b ? "✔" : "");
    const fyll = <T,>(lista: T[], minst: number, tom: T) => [...lista, ...Array.from({ length: Math.max(0, minst - lista.length) }, () => tom)];
    const info = ([["Objekt", intyg.objekt], ["Slutkund", intyg.slutkund], ["Beställare", intyg.bestallare],
      ["Projekteringsledare", intyg.projekteringsledare], ["Projektör", intyg.projektor], ["Projektnummer", intyg.projektnummer]] as const)
      .map(([e, v]) => `<tr><th>${e}:</th><td>${esc(v)}</td></tr>`).join("");
    const handlingar = fyll(intyg.handlingar, 6, tomHandling).map((h) =>
      `<tr class="hog"><td>${esc(h.handling)}</td><td>${esc(h.beskrivning)}</td><td>${esc(valtDatum(h.datum))}</td><td>${esc(h.signProjektor)}</td><td>${esc(h.signProjekteringsledare)}</td></tr>`).join("");
    const anvisningar = fyll(intyg.anvisningar, 6, tomAnvisning).map((a) =>
      `<tr><td>${esc(a.dokument)}</td><td>${esc(a.typ)}</td><td>${esc(valtDatum(a.daterad))}</td></tr>`).join("");
    const bilaga = egen.filter((k) => k.rader.length).map((k) => {
      const rader: (string[] | string)[] = [];
      // Punkter som är Ej aktuell tas bara med om man valt det i Projekteringsegenkontrollen; avsnitt och punkter numreras om.
      let medEa = false;
      try { medEa = localStorage.getItem("pek-med-ej-aktuella") === "1"; } catch { /* standard: utan */ }
      let nr = 0;
      for (const a of gruppera(k.rader)) {
        const punkter = medEa ? a.punkter : a.punkter.filter((x) => x.status !== "ea");
        if (!punkter.length) continue;
        nr++;
        if (a.namn) rader.push(`${nr}. ${a.namn}`);
        punkter.forEach((x, i) => rader.push([`${nr}.${i + 1}`, x.text, x.status === "ok" ? "OK" : x.status === "kompl" ? "Kompl." : x.status === "ea" ? "E.A." : "", x.rad.data.ovrigt ?? "", valtDatum(x.rad.data.datum), x.rad.data.sign ?? ""]));
      }
      return `
<h2 class="ny-sida">EGENKONTROLL – ${esc(k.namn.toUpperCase())}</h2>
<p class="not">OK = utförd, Kompl. = komplettering krävs${medEa ? ", E.A. = ej aktuell" : ". Punkter som inte är aktuella är inte med"}. Signering intygar att punkten är kontrollerad.</p>
${blockHtml([{ typ: "tabell", kolumner: ["Nr", "Kontrollpunkt", "Status", "Kommentar", "Datum", "Sign."], bredder: [6, 47, 7, 22, 11, 7], centrera: [2], rader }])}`;
    }).join("");

    oppnaDokument({
      titel: "Projekteringsintyg och egenkontroll", kategori: "Projekteringsintyg", projekt: p.projekt,
      css: `.blk{break-inside:avoid;page-break-inside:avoid}
.not{font-style:italic;margin:-1.5mm 0 2mm}
table.ram{border-collapse:collapse;width:100%}
table.ram th,table.ram td{border:1px solid #000;padding:3px 5px;vertical-align:top;text-align:left}
table.ram thead th{font-weight:700;background:#BFBFBF}
.info th{background:#F2F2F2}
.info{width:66%!important}.info th{width:32%;text-align:right!important;font-weight:700;white-space:nowrap}
.ruta{border:1px solid #000;padding:4px 6px}.ruta b{display:block;margin-bottom:2px}.ruta p{white-space:pre-wrap;margin:0;line-height:1.4}
.omf{min-height:34mm}.avsteg{min-height:22mm}
tr.hog td{height:7.5mm}
.handl th:nth-child(3),.handl td:nth-child(3){width:13%;white-space:nowrap}.handl th:nth-child(4),.handl td:nth-child(4){width:11%}.handl th:nth-child(5),.handl td:nth-child(5){width:15%}
.anv td{height:4.5mm}.anv th:nth-child(3),.anv td:nth-child(3){width:13%}
.risk{width:66%!important}.risk th{text-align:center!important;width:50%}.risk td{height:12mm;text-align:center!important;vertical-align:middle;font-size:14pt}
.mat td:last-child{width:22%;text-align:center!important;vertical-align:middle;font-size:14pt}
.mitt{text-align:center}
.linje{border-bottom:1px solid #000;min-height:6mm;padding-top:4mm;margin-bottom:2mm}
.utford{display:flex;gap:6px;align-items:flex-end;font-weight:700}.utford span{flex:0 0 95mm;border-bottom:1px solid #000;font-weight:400;min-height:5mm}
.sign b{display:block;margin-top:6mm}
.ny-sida{page-break-before:always;margin-top:0}
tr,.ruta{page-break-inside:avoid}
.egen td{font-size:8.5pt}
`,
      kropp: `<table class="ram info">${info}</table>
<h2>Omfattning</h2>
<div class="ruta omf"><b>Projektets omfattning:</b><p>${esc(intyg.omfattning)}</p></div>
<h2>Upprättade handlingar</h2><p class="not">Signering av handling intygar kontroll av handlingen.</p>
<table class="ram handl"><thead><tr><th>Handling</th><th>Beskrivning</th><th>Datum</th><th>Sign.<br>Projektör</th><th>Sign.<br>Projekterings&shy;ledare</th></tr></thead><tbody>${handlingar}</tbody></table>
<div class="blk"><h2>Anvisningar för projektering</h2>
<table class="ram anv"><thead><tr><th>Dokument</th><th>Typ av dokument</th><th>Daterad</th></tr></thead><tbody>${anvisningar}</tbody></table></div>
<div class="blk"><h2>Avsteg i projektering</h2>
<div class="ruta avsteg"><b>Avsteg som har gjorts under projektering:</b><p>${esc(intyg.avsteg)}</p></div></div>
<div class="blk"><h2>Riskanalys för kontrollplan</h2>
<div class="utford">Riskanalys utförd, datum/signatur: <span>${esc(intyg.riskanalysUtford)}</span></div>
<p style="font-weight:700;margin:4mm 0 2mm">Resultat från riskanalys:</p>
<table class="ram risk"><thead><tr><th>Inga risker<br>uppdagade</th><th>Risker uppdagade.<br>Riskanalys bifogas som bilaga</th></tr></thead>
<tbody><tr><td>${ruta(intyg.ingaRisker)}</td><td>${ruta(intyg.riskerUppdagade)}</td></tr></tbody></table></div>
<div class="blk"><h2>Materialval</h2>
<table class="ram mat"><tr><td>${esc(MATERIAL_ENTREPRENOR)}</td><td>${ruta(intyg.materialEntreprenor)}</td></tr>
<tr><td>${esc(MATERIAL_INTYGAT)}</td><td>${ruta(intyg.materialIntygat)}</td></tr></table></div>
<div class="sign" style="page-break-inside:avoid">
<p style="font-weight:700;margin:7mm 0 0">Härmed intygas ovan uppgifter:</p>
<b>Ort / datum</b><div class="linje">${esc(intyg.ortDatum)}</div>
<b>Signatur</b><div class="linje">${esc(intyg.signatur)}</div>
</div>
${bilaga}
`,
    }, f);
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
