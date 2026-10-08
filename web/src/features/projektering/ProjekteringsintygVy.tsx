import { useEffect, useRef, useState } from "react";
import type { Anteckningar, Projekt } from "../../lib/typer";

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
  projekt: Projekt | null;
  grupp: string;
  rubrik: string;
  text: Anteckningar | undefined;
  onSparaText: (text: string) => Promise<void>;
  lasläge: boolean;
  visaMeddelande: (t: string) => void;
};

/** Projekteringsintyg: ett formulär per projekt, utskrift/PDF. */
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

  const skrivUt = () => {
    const f = window.open("", "_blank");
    if (!f) { alert("Webbläsaren stoppade utskriftsfönstret. Tillåt popup-fönster för sidan."); return; }
    const ruta = (b: boolean) => `<span class="ruta">${b ? "✔" : ""}</span>`;
    const rad = (e: string, v: string) => `<b>${esc(e)}</b><span>${esc(v)}</span>`;
    f.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Projekteringsintyg – ${esc(intyg.objekt)}</title>
<style>@page{size:A4;margin:16mm 14mm 18mm}body{font-family:Arial,sans-serif;font-size:10pt;color:#111}
h1{font-size:18pt;color:#1E3450;margin:0 0 10px;border-bottom:2px solid #1E3450;padding-bottom:6px}h2{font-size:12pt;color:#1E3450;margin:16px 0 6px}
.huvud{display:grid;grid-template-columns:150px 1fr 150px 1fr;gap:4px 10px}.huvud b{color:#444}
p{white-space:pre-wrap;margin:0;line-height:1.45}table{border-collapse:collapse;width:100%;font-size:9pt}
th{background:#1E3450;color:#fff;text-align:left;padding:4px;-webkit-print-color-adjust:exact;print-color-adjust:exact}td{border-bottom:1px solid #ccc;padding:4px;vertical-align:top}
.ruta{display:inline-block;width:13px;height:13px;border:1px solid #333;text-align:center;line-height:13px;font-size:10px;margin-right:8px;vertical-align:middle}
.kryss{display:flex;gap:6px;margin:6px 0;align-items:flex-start}.not{color:#555;font-size:9pt;margin-bottom:4px}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:24px}.sign div{border-top:1px solid #333;padding-top:4px}</style></head><body>
<h1>Projekteringsintyg</h1>
<div class="huvud">${rad("Objekt:", intyg.objekt)}${rad("Slutkund:", intyg.slutkund)}${rad("Beställare:", intyg.bestallare)}${rad("Projektnummer:", intyg.projektnummer)}${rad("Projekteringsledare:", intyg.projekteringsledare)}${rad("Projektör:", intyg.projektor)}</div>
<h2>Omfattning</h2><p>${esc(intyg.omfattning)}</p>
<h2>Upprättade handlingar</h2><p class="not">Signering av handling intygar kontroll av handlingen.</p>
<table><thead><tr><th>Handling</th><th>Beskrivning</th><th>Datum</th><th>Sign. Projektör</th><th>Sign. Projekteringsledare</th></tr></thead><tbody>
${intyg.handlingar.map((h) => `<tr><td>${esc(h.handling)}</td><td>${esc(h.beskrivning)}</td><td>${esc(h.datum)}</td><td>${esc(h.signProjektor)}</td><td>${esc(h.signProjekteringsledare)}</td></tr>`).join("")}</tbody></table>
<h2>Anvisningar för projektering</h2>
<table><thead><tr><th>Dokument</th><th>Typ av dokument</th><th>Daterad</th></tr></thead><tbody>
${intyg.anvisningar.map((a) => `<tr><td>${esc(a.dokument)}</td><td>${esc(a.typ)}</td><td>${esc(a.daterad)}</td></tr>`).join("")}</tbody></table>
<h2>Avsteg i projektering</h2><p class="not">Avsteg som har gjorts under projektering:</p><p>${esc(intyg.avsteg)}</p>
<h2>Riskanalys för kontrollplan</h2><p>Riskanalys utförd, datum/signatur: ${esc(intyg.riskanalysUtford)}</p>
<div class="kryss">${ruta(intyg.ingaRisker)}<span>Inga risker uppdagade</span></div>
<div class="kryss">${ruta(intyg.riskerUppdagade)}<span>Risker uppdagade. Riskanalys bifogas som bilaga</span></div>
<h2>Materialval</h2>
<div class="kryss">${ruta(intyg.materialEntreprenor)}<span>${esc(MATERIAL_ENTREPRENOR)}</span></div>
<div class="kryss">${ruta(intyg.materialIntygat)}<span>${esc(MATERIAL_INTYGAT)}</span></div>
<p style="margin-top:18px">Härmed intygas ovan uppgifter</p>
<div class="sign"><div>Ort / datum: ${esc(intyg.ortDatum)}</div><div>Signatur: ${esc(intyg.signatur)}</div></div>
<script>window.onload=()=>{window.focus();window.print();};</script></body></html>`);
    f.document.close();
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
        <div className="knappar"><button className="knapp" onClick={skrivUt}>Skriv ut / PDF</button></div>
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
