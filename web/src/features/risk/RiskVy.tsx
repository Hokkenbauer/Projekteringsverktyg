import { useEffect, useState, type ReactNode } from "react";
import { useFordrojdSparning } from "../../lib/sparning";
import { api, skicka } from "../../lib/api";
import type { Anteckningar, ListDef, ListRad, Projekt } from "../../lib/typer";
import { skrivUtBlock, type BlockDokument, type Cell } from "../../lib/dokumentBlock";

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

const riskFarg = (v: number) => (v >= 6 ? "#C53030" : v >= 3 ? "#D69E2E" : v > 0 ? "#2F855A" : undefined);

/** Riskanalysen som dokument (utskrift, PDF och Word): rubrikfält, texter, riskerna och riskmatrisen. */
export function riskDokument(rubrik: string, variant: RiskVariant, text: string | undefined, rader: ListRad[], projekt: Projekt | null): BlockDokument {
  const huvud = las(text, variant);
  const sorterade = [...rader].sort((a, b) => a.ordning - b.ordning);
  const varden = sorterade.map((r) => ({ s: Number(r.data.sannolikhet), k: Number(r.data.konsekvens) }));
  const matris: Cell[][] = [3, 2, 1].map((s) => [{ text: String(s), fet: true, mitt: true, fyll: "#BFBFBF" }, ...[1, 2, 3].map((k): Cell => {
    const n = varden.filter((x) => x.s === s && x.k === k).length;
    return { text: n ? String(n) : "", fyll: riskFarg(s * k), farg: "#FFFFFF", fet: true, mitt: true };
  })]);
  return {
    titel: rubrik, kategori: "Riskanalys", projekt,
    block: [
      { typ: "form", rader: [
        ["Projekt", [projekt?.namn, projekt?.nummer].filter(Boolean).join(" · ")], ["Objekt", huvud.objekt], ["Datum", huvud.datum],
        ["Totalentreprenör", huvud.totalentreprenor], ["Handläggare", [huvud.handlaggare, huvud.epost].filter(Boolean).join(", ")],
      ] },
      { typ: "rubrik", text: "Inledning" },
      { typ: "text", text: `Syfte. ${huvud.syfte}` },
      { typ: "text", text: `Omfattning. ${huvud.omfattning}` },
      { typ: "rubrik", text: "Metodik" },
      { typ: "text", text: huvud.metodik },
      { typ: "rubrik", text: "Riskidentifiering och -bedömning" },
      { typ: "tabell", kolumner: ["Pos.", "Arbetsmoment", "Risk", "S", "K", "Riskvärde", "Åtgärd", "Ansvarig"],
        bredder: [5, 15, 23, 4, 4, 10, 27, 12], centrera: [3, 4, 5],
        rader: sorterade.map((r, i) => {
          const v = Number(r.data.sannolikhet) * Number(r.data.konsekvens) || 0;
          return [String(i + 1), r.data.arbetsmoment ?? "", r.data.risk ?? "", r.data.sannolikhet ?? "", r.data.konsekvens ?? "",
            { text: v ? String(v) : "", fyll: riskFarg(v), farg: v ? "#FFFFFF" : undefined, fet: true, mitt: true }, r.data.atgard ?? "", r.data.ansvarig ?? ""];
        }) },
      { typ: "rubrik", text: "Riskmatris" },
      { typ: "text", text: "Antal risker per sannolikhet (S, rader) och konsekvens (K, kolumner).", kursiv: true },
      { typ: "tabell", kolumner: ["S \\ K", "1", "2", "3"], bredder: [25, 25, 25, 25], bredd: 32, centrera: [0, 1, 2, 3], radhojd: 7, rader: matris },
      { typ: "rubrik", text: "Riskhanteringsplan" },
      { typ: "text", text: huvud.riskhantering },
      { typ: "rubrik", text: "Uppföljning och utvärdering" },
      { typ: "text", text: huvud.uppfoljning },
      { typ: "rubrik", text: "Slutsats" },
      { typ: "text", text: huvud.slutsats },
    ],
  };
}

export function RiskVy({ projektId, projekt, variant, grupp, rubrik, text, onSparaText, def, rader, lasläge, visaMeddelande, children }: Props) {
  const [huvud, setHuvud] = useState<Huvud>(() => las(text?.text, variant));
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const sparning = useFordrojdSparning();

  // Ändringar från andra slår igenom om man inte själv har osparat.
  useEffect(() => { if (status === "sparat" && text?.text) setHuvud(las(text.text, variant)); }, [text?.text]);
  
  const andra = (falt: keyof Huvud, varde: string) => {
    const ny = { ...huvud, [falt]: varde };
    setHuvud(ny);
    setStatus("osparat");
    sparning.planera(async () => {
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

  const skrivUt = () => skrivUtBlock(riskDokument(rubrik, variant, JSON.stringify(huvud), rader ?? [], projekt));

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
            <textarea value={huvud[k]} readOnly={lasläge} rows={10} onChange={(e) => andra(k, e.target.value)} />
          </label>
        ))}
      </div>
    </>
  );
}
