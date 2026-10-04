import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, skicka } from "../../lib/api";
import type { Anteckningar, ListDef, ListRad, Projekt } from "../../lib/typer";

export type RiskVariant = "projektering" | "produktion";

type Huvud = {
  objekt: string; datum: string; totalentreprenor: string; handlaggare: string; epost: string;
  syfte: string; omfattning: string; metodik: string; riskhantering: string; uppfoljning: string; slutsats: string;
};

const SEKTIONER: [keyof Huvud, string][] = [
  ["syfte", "Syfte"], ["omfattning", "Omfattning"], ["metodik", "Metodik"],
  ["riskhantering", "Riskhanteringsplan"], ["uppfoljning", "Uppföljning och utvärdering"], ["slutsats", "Slutsats"],
];

const METODIK =
  "Riskidentifiering: Risker identifieras genom genomgång av handlingar, platsbesök, erfarenheter från tidigare projekt och samråd med berörda parter.\n" +
  "Riskbedömning: Varje risk bedöms utifrån sannolikhet (1–3) och konsekvens (1–3). Riskvärdet är sannolikhet × konsekvens: 1–2 låg, 3–4 medel, 6–9 hög.\n" +
  "Riskhantering: För varje risk anges åtgärd och ansvarig. Risker med högt riskvärde ska vara åtgärdade innan arbetet påbörjas.";

/** Standardtexter. De kopieras in i projektet första gången och kan sedan skrivas om fritt. */
const STANDARD: Record<RiskVariant, Partial<Huvud>> = {
  projektering: {
    syfte: "Syftet med riskanalysen är att redan i projekteringen identifiera och bedöma risker som kan påverka arbetsmiljö, funktion, kvalitet och tidplan i styr- och övervakningsentreprenaden, så att de kan undvikas eller minimeras i handlingarna.",
    omfattning: "Riskanalysen omfattar projekteringen av styr- och övervakningsanläggningen: apparatskåp, fältutrustning, kabelförläggning och kommunikation mot andra system.",
    metodik: METODIK,
    riskhantering: "Riskminimering: Risker hanteras i första hand genom val av tekniska lösningar och i andra hand genom anvisningar i handlingarna.\nKrisplan: Vid allvarlig händelse kontaktas projektledare och beställare omgående.\nKommunikationsplan: Riskanalysen delges berörda parter och tas upp på projekteringsmöten.",
    uppfoljning: "Riskanalysen följs upp vid projekteringsmöten och revideras när förutsättningarna ändras.",
    slutsats: "Med angivna åtgärder bedöms riskerna i projekteringen vara hanterade på en acceptabel nivå.",
  },
  produktion: {
    syfte: "Syftet med riskanalysen är att identifiera och bedöma arbetsmiljörisker och andra risker i produktionen av styr- och övervakningsentreprenaden, så att olyckor, skador och störningar förebyggs.",
    omfattning: "Riskanalysen omfattar installation, inkoppling, driftsättning och provning av styr- och övervakningsanläggningen på arbetsplatsen.",
    metodik: METODIK,
    riskhantering: "Riskminimering: Arbetet planeras så att risker elimineras eller minskas, rätt utrustning och skyddsutrustning används och personalen har rätt behörighet.\nKrisplan: Vid olycka larmas 112, första hjälpen ges och arbetsledning och beställare kontaktas. Återsamlingsplats enligt arbetsplatsens skyddsplan.\nKommunikationsplan: Riskanalysen gås igenom med all personal innan arbetet påbörjas och vid förändringar.",
    uppfoljning: "Riskanalysen följs upp vid byggmöten och skyddsronder och revideras när arbetsmoment eller förutsättningar ändras.",
    slutsats: "Med angivna åtgärder bedöms riskerna i produktionen vara hanterade på en acceptabel nivå.",
  },
};

const VANLIGA: Record<RiskVariant, Record<string, string>[]> = {
  produktion: [
    { arbetsmoment: "Tunga lyft", risk: "Belastningsskador vid lyft av apparatskåp och material.", sannolikhet: "2", konsekvens: "2", atgard: "Använd lyfthjälpmedel, var två vid tunga lyft." },
    { arbetsmoment: "Arbete på stege", risk: "Fallolycka.", sannolikhet: "2", konsekvens: "3", atgard: "Använd arbetsbock eller ställning där det går. Stegen ska vara hel och förankrad." },
    { arbetsmoment: "Borrning", risk: "Damm, buller och skador på dolda installationer.", sannolikhet: "2", konsekvens: "2", atgard: "Hörsel- och andningsskydd. Kontrollera ritningar och sök efter dolda installationer före borrning." },
    { arbetsmoment: "Nödutrymning", risk: "Personal hittar inte utrymningsvägar eller återsamlingsplats.", sannolikhet: "1", konsekvens: "3", atgard: "Genomgång av arbetsplatsens skyddsplan och utrymningsvägar vid introduktion." },
    { arbetsmoment: "Arbete nära spänning", risk: "Elchock eller ljusbåge.", sannolikhet: "1", konsekvens: "3", atgard: "Arbete enligt ESA. Spänningslöst arbete, kontroll av spänningslöshet och behörig personal." },
    { arbetsmoment: "Tillfälliga elanslutningar", risk: "Elolycka eller brand.", sannolikhet: "1", konsekvens: "3", atgard: "Använd byggcentral med jordfelsbrytare. Kontrollera kablar före användning." },
    { arbetsmoment: "Samarbete med andra entreprenörer", risk: "Arbeten krockar, t.ex. arbete under pågående lyft eller i samma utrymme.", sannolikhet: "2", konsekvens: "2", atgard: "Samordna på byggmöten och följ arbetsplatsens samordningsplan." },
    { arbetsmoment: "Arbete på lift", risk: "Fall, klämskador och påkörning.", sannolikhet: "1", konsekvens: "3", atgard: "Utbildning för liften, fallskydd vid behov och avspärrning runt arbetsområdet." },
  ],
  projektering: [
    { arbetsmoment: "Underlag", risk: "Ofullständiga eller ändrade underlag från andra discipliner ger fel funktion eller I/O-mängd.", sannolikhet: "2", konsekvens: "2", atgard: "Stäm av underlag vid projekteringsmöten och notera förutsättningar i handlingarna." },
    { arbetsmoment: "Samordning", risk: "Placering av givare, ställdon och skåp krockar med andra installationer.", sannolikhet: "2", konsekvens: "2", atgard: "Samordna placeringar i placeringsritningar och vid samordningsmöten." },
    { arbetsmoment: "Åtkomst för service", risk: "Komponenter placeras så att de inte kan nås för service.", sannolikhet: "2", konsekvens: "2", atgard: "Ange åtkomstkrav i handlingarna och kontrollera vid granskning." },
    { arbetsmoment: "Kommunikation", risk: "Integration mot andra system (t.ex. Modbus, BACnet, överordnat system) fungerar inte som tänkt.", sannolikhet: "2", konsekvens: "2", atgard: "Ta fram gränssnittsbeskrivning och adresslistor tidigt." },
    { arbetsmoment: "Brandskydd", risk: "Brandspjällsfunktion och brandlarmsstyrning stämmer inte med brandskyddsbeskrivningen.", sannolikhet: "1", konsekvens: "3", atgard: "Stäm av funktioner mot brandskyddsbeskrivningen och dokumentera i brandspjällstabellen." },
    { arbetsmoment: "Apparatskåp", risk: "Underdimensionerad matning eller värmeutveckling i apparatskåp.", sannolikhet: "1", konsekvens: "3", atgard: "Kraftberäkning per skåp och kontroll av ventilation/temperatur." },
  ],
};

const tom: Huvud = { objekt: "", datum: "", totalentreprenor: "", handlaggare: "", epost: "", syfte: "", omfattning: "", metodik: "", riskhantering: "", uppfoljning: "", slutsats: "" };

function las(text: string | undefined, variant: RiskVariant): Huvud {
  try { if (text) return { ...tom, ...JSON.parse(text) }; } catch { /* börja om */ }
  return { ...tom, ...STANDARD[variant] };
}

type Props = {
  projektId: string;
  projekt: Projekt | null;
  variant: RiskVariant;
  grupp: string;
  rubrik: string;
  text: Anteckningar | undefined;
  onSparaText: (text: string) => Promise<void>;
  def: ListDef | undefined;
  rader: ListRad[] | undefined;
  lasläge: boolean;
  visaMeddelande: (t: string) => void;
  children: ReactNode;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function RiskVy({ projektId, projekt, variant, grupp, rubrik, text, onSparaText, def, rader, lasläge, visaMeddelande, children }: Props) {
  const [huvud, setHuvud] = useState<Huvud>(() => las(text?.text, variant));
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const timer = useRef<number | undefined>(undefined);

  // Ändringar från andra slår igenom om man inte själv har osparat.
  useEffect(() => { if (status === "sparat" && text?.text) setHuvud(las(text.text, variant)); }, [text?.text]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const andra = (falt: keyof Huvud, varde: string) => {
    const ny = { ...huvud, [falt]: varde };
    setHuvud(ny);
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setStatus("sparar");
      try { await onSparaText(JSON.stringify(ny)); setStatus("sparat"); }
      catch (e) { setStatus("osparat"); visaMeddelande(`Kunde inte spara: ${(e as Error).message}`); }
    }, 1000);
  };

  const varden = (rader ?? []).map((r) => {
    const s = Number(r.data.sannolikhet), k = Number(r.data.konsekvens);
    return { r, s, k, v: s && k ? s * k : 0 };
  });

  const laggTillVanliga = async () => {
    if (!def) return;
    try {
      await api(`/api/projekt/${projektId}/listor/${def.id}/flera`, { method: "POST", body: skicka(VANLIGA[variant]) });
      visaMeddelande(`${VANLIGA[variant].length} vanliga risker tillagda. Justera sannolikhet, konsekvens och åtgärd för projektet.`);
    } catch (e) { visaMeddelande((e as Error).message); }
  };

  const skrivUt = () => {
    const f = window.open("", "_blank");
    if (!f) { alert("Webbläsaren stoppade utskriftsfönstret. Tillåt popup-fönster för sidan."); return; }
    const sorterade = [...(rader ?? [])].sort((a, b) => a.ordning - b.ordning);
    const farg = (v: number) => (v >= 6 ? "#C53030" : v >= 3 ? "#D69E2E" : v > 0 ? "#2F855A" : "transparent");
    const matris = [3, 2, 1].map((s) => `<tr><th>${s}</th>${[1, 2, 3].map((k) => {
      const n = varden.filter((x) => x.s === s && x.k === k).length;
      return `<td style="background:${farg(s * k)};color:#fff">${n || ""}</td>`;
    }).join("")}</tr>`).join("");
    f.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>${esc(rubrik)} – ${esc(projekt?.namn ?? "")}</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm; }
body { font-family: Arial, sans-serif; font-size: 10pt; color: #111; }
h1 { font-size: 17pt; color: #1E3450; margin: 0 0 4px; } h2 { font-size: 12pt; color: #1E3450; margin: 16px 0 4px; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
.huvud { display: grid; grid-template-columns: 140px 1fr; gap: 3px 10px; margin: 10px 0; }
.huvud b { color: #444; } p { white-space: pre-wrap; margin: 0; line-height: 1.45; }
table.risk { border-collapse: collapse; width: 100%; font-size: 9pt; } table.risk th { background: #1E3450; color: #fff; text-align: left; padding: 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table.risk td { border-bottom: 1px solid #ccc; padding: 4px; vertical-align: top; } tr { page-break-inside: avoid; }
.v { color: #fff; font-weight: bold; text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
table.matris { border-collapse: collapse; margin-top: 6px; } table.matris td, table.matris th { width: 34px; height: 26px; text-align: center; border: 1px solid #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
footer { margin-top: 18px; font-size: 8pt; color: #666; border-top: 1px solid #ccc; padding-top: 4px; }
</style></head><body>
<h1>${esc(rubrik)}</h1>
<div class="huvud">
<b>Projekt</b><span>${esc([projekt?.namn, projekt?.nummer].filter(Boolean).join(" · "))}</span>
<b>Objekt</b><span>${esc(huvud.objekt)}</span><b>Datum</b><span>${esc(huvud.datum)}</span>
<b>Totalentreprenör</b><span>${esc(huvud.totalentreprenor)}</span>
<b>Handläggare</b><span>${esc([huvud.handlaggare, huvud.epost].filter(Boolean).join(", "))}</span>
</div>
<h2>Inledning</h2><p><b>Syfte.</b> ${esc(huvud.syfte)}</p><p style="margin-top:6px"><b>Omfattning.</b> ${esc(huvud.omfattning)}</p>
<h2>Metodik</h2><p>${esc(huvud.metodik)}</p>
<h2>Riskidentifiering och -bedömning</h2>
<table class="risk"><thead><tr><th>Pos.</th><th>Arbetsmoment</th><th>Risk</th><th>S</th><th>K</th><th>Riskvärde</th><th>Åtgärd</th><th>Ansvarig</th></tr></thead><tbody>
${sorterade.map((r, i) => { const v = Number(r.data.sannolikhet) * Number(r.data.konsekvens) || 0; return `<tr><td>${i + 1}</td><td>${esc(r.data.arbetsmoment ?? "")}</td><td>${esc(r.data.risk ?? "")}</td><td>${esc(r.data.sannolikhet ?? "")}</td><td>${esc(r.data.konsekvens ?? "")}</td><td class="v" style="background:${farg(v)}">${v || ""}</td><td>${esc(r.data.atgard ?? "")}</td><td>${esc(r.data.ansvarig ?? "")}</td></tr>`; }).join("")}
</tbody></table>
<h2>Riskmatris</h2><table class="matris"><tr><th></th><th colspan="3">Konsekvens</th></tr><tr><th>S</th><th>1</th><th>2</th><th>3</th></tr>${matris}</table>
<h2>Riskhanteringsplan</h2><p>${esc(huvud.riskhantering)}</p>
<h2>Uppföljning och utvärdering</h2><p>${esc(huvud.uppfoljning)}</p>
<h2>Slutsats</h2><p>${esc(huvud.slutsats)}</p>
<footer>${esc(projekt?.kund ?? "")} · Utskrivet ${new Date().toLocaleDateString("sv-SE")} från Projekteringsverktyg</footer>
<script>window.onload = () => { window.focus(); window.print(); };</script></body></html>`);
    f.document.close();
  };

  const falt = (k: keyof Huvud, etikett: string, typ = "text") => (
    <label className="riskfalt">
      <span>{etikett}</span>
      <input type={typ} value={huvud[k]} readOnly={lasläge} onChange={(e) => andra(k, e.target.value)} />
    </label>
  );

  return (
    <>
      <div className="brodsmula">{grupp}</div>
      <div className="rubrikrad">
        <h1>{rubrik}</h1>
        <div className="knappar">
          {!lasläge && def && <button className="knapp" onClick={() => void laggTillVanliga()}>Lägg till vanliga risker</button>}
          <button className="knapp" onClick={skrivUt}>Skriv ut / PDF</button>
        </div>
      </div>
      <p className="ingress">
        Fyll i rubrikfälten och riskerna. Standardtexterna kan skrivas om för projektet. Allt sparas automatiskt
        {status === "sparar" ? " (sparar…)" : status === "osparat" ? " (osparade ändringar)" : ""}.
      </p>

      <section className="panel riskhuvud">
        {falt("objekt", "Objekt")}
        {falt("datum", "Datum", "date")}
        {falt("totalentreprenor", "Totalentreprenör")}
        {falt("handlaggare", "Handläggare")}
        {falt("epost", "E-post", "email")}
      </section>

      {children}

      <section className="panel riskmatrisruta">
        <h2>Riskmatris</h2>
        <table className="riskmatris" aria-label="Antal risker per sannolikhet och konsekvens">
          <thead><tr><th>S \ K</th><th>1</th><th>2</th><th>3</th></tr></thead>
          <tbody>
            {[3, 2, 1].map((s) => (
              <tr key={s}><th>{s}</th>{[1, 2, 3].map((k) => {
                const n = varden.filter((x) => x.s === s && x.k === k).length;
                const v = s * k;
                return <td key={k} className={v >= 6 ? "risk-hog" : v >= 3 ? "risk-medel" : "risk-lag"}>{n || ""}</td>;
              })}</tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="risksektioner">
        {SEKTIONER.map(([k, rub]) => (
          <label key={k} className="risksektion">
            <span>{rub}</span>
            <textarea value={huvud[k]} readOnly={lasläge} rows={k === "metodik" || k === "riskhantering" ? 5 : 3} onChange={(e) => andra(k, e.target.value)} />
          </label>
        ))}
      </div>
    </>
  );
}
