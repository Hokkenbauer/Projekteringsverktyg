import { useEffect, useRef, useState } from "react";
import { api, ApiFel, skicka } from "../../lib/api";
import type { Komponent, Projekt, Skap } from "../../lib/typer";

/** Samma värden som dagens program (DATA\DropDowns\ApparatskapLedningsfarg). */
const LEDNINGSFARGER = ["Röd", "Violett", "Svart", "Ljusblå", "Orange", "Brun", "Grå", "Vit", "Gul/Grön", "Blå", "Grön", "Gul"];

const FARGER: [string, string, string][] = [
  ["DI", "DI – Digitalingång", "Röd"], ["DO", "DO – Digitalutgång", "Röd"],
  ["AI", "AI – Analogingång", "Violett"], ["AO", "AO – Analogutgång", "Violett"],
  ["FrammandeSpanning", "Främmande spänning", "Orange"], ["230VManover", "230V manöver", "Svart"],
  ["L1", "L1", "Svart"], ["L2", "L2", "Svart"], ["L3", "L3", "Svart"],
  ["Neutralledare", "Neutralledare (N)", "Ljusblå"], ["400V", "400V", "Svart"], ["JordPE", "Jord (PE)", "Gul/Grön"],
  ["24VDCPlus", "24VDC+", "Röd"], ["24VDCMinus", "24VDC–", "Brun"],
  ["24VACG", "24VAC (G)", "Grå"], ["24VACG0", "24VAC (G0)", "Vit"], ["BussKommunikation", "Buss/kommunikation", "Violett"],
];

/** De 41 fasta komponenttyperna från dagens program. */
const KOMPONENTER = [
  "Överspänningsskydd", "Personskyddsautomat", "Belysning", "Spänningsaggregat 24VDC", "Manöversäkringar 24VAC",
  "Reservutrymme DIN", "Mellanreläer", "H/O/A Omkopplare i front", "Dioder i front", "Nödstopp i front", "Lyftöglor",
  "Signalomvandlare", "Dupline", "Modbusgateway", "Switch 8-p", "DIN-PC", "PC-hylla", "Lås", "Fläkt", "Termostat kyla",
  "Värmeelement", "Fasbrottsrelä", "Finskydd 24VDC", "Vägguttag", "Transformator 24VAC", "Reservutrymme plint",
  "Reservutrymme säkringar", "Brandrelä", "Serviceomkopplare i front", "Lamptryckknapp i front", "Panel-PC / HMI i front",
  "Elmätare", "SIOX-Axccess", "M-busgateway", "Switch 5-p", "Kontroll rökdetektorer", "Signaltorn", "Dörrhållare",
  "Nätverksuttag", "Filter", "Termostat värme",
];

const SPEC: [string, string][] = [
  ["matt", "Apparatskåpsmått"], ["ansluts", "Ansluts ovan/underifrån"], ["kapsling", "Kapslingsklass"],
  ["dorrar", "Dörrar (enkel/dubbel)"], ["material", "Material på apparatskåp"],
];

type Formular = {
  beteckning: string; placering: string; beskrivning: string;
  farger: Record<string, string>;
  komponenter: Record<string, { vald: boolean; info: string }>;
  spec: Record<string, string>;
  ovrigt: string;
};

function lasFormular(s: Skap): Formular {
  let d: Partial<Formular> = {};
  try { d = JSON.parse(s.data || "{}"); } catch { /* tomt */ }
  return {
    beteckning: s.beteckning, placering: s.placering, beskrivning: s.beskrivning,
    farger: { ...Object.fromEntries(FARGER.map(([k, , st]) => [k, st])), ...(d.farger ?? {}) },
    komponenter: d.komponenter ?? {},
    spec: d.spec ?? {},
    ovrigt: d.ovrigt ?? "",
  };
}

type Props = {
  projektId: string;
  projekt: Projekt | null;
  skap: Skap;
  komponenter: Komponent[];
  lasläge: boolean;
  onSparat: (s: Skap) => void;
  onKonflikt: () => void;
  visaMeddelande: (t: string) => void;
};

/** Apparatskåp: grundinformation, ledningsfärger, komponenter i skåpet, specifikation och övrigt. Sparas automatiskt. */
export function ApparatskapVy({ projektId, projekt, skap, komponenter, lasläge, onSparat, onKonflikt, visaMeddelande }: Props) {
  const [f, setF] = useState<Formular>(() => lasFormular(skap));
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const timer = useRef<number | undefined>(undefined);
  const version = useRef(skap.version);
  const senast = useRef(skap.data + skap.beteckning + skap.placering + skap.beskrivning);

  useEffect(() => {
    version.current = skap.version;
    const nu = skap.data + skap.beteckning + skap.placering + skap.beskrivning;
    if (status !== "osparat" && nu !== senast.current) { setF(lasFormular(skap)); senast.current = nu; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skap.id, skap.version]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const andra = (ny: Formular) => {
    if (lasläge) return;
    setF(ny);
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void spara(ny), 900);
  };

  const spara = async (ny: Formular) => {
    setStatus("sparar");
    const data = JSON.stringify({ farger: ny.farger, komponenter: ny.komponenter, spec: ny.spec, ovrigt: ny.ovrigt });
    try {
      const s = await api<Skap>(`/api/projekt/${projektId}/skap/${skap.id}`, {
        method: "PUT",
        body: skicka({ namn: skap.namn, beteckning: ny.beteckning, placering: ny.placering, beskrivning: ny.beskrivning, data, version: version.current }),
      });
      version.current = s.version;
      senast.current = s.data + s.beteckning + s.placering + s.beskrivning;
      setStatus("sparat");
      onSparat(s);
    } catch (e) {
      setStatus("sparat");
      if (e instanceof ApiFel && e.status === 409) {
        visaMeddelande("Någon annan ändrade skåpet samtidigt. Deras version visas nu; gör om din senaste ändring.");
        senast.current = "";
        onKonflikt();
      } else visaMeddelande(`Kunde inte spara: ${(e as Error).message}`);
    }
  };

  const bet = f.beteckning.trim().toLowerCase();
  const anslutna = bet ? komponenter.filter((k) => k.anslutsTill.trim().toLowerCase() === bet) : [];
  const valda = KOMPONENTER.filter((n) => f.komponenter[n]?.vald);

  const skrivUt = () => {
    const w = window.open("", "_blank");
    if (!w) { alert("Tillåt popup-fönster för sidan för att kunna skriva ut."); return; }
    const esc = (t: string) => (t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const rad = (a: string, b: string) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`;
    w.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Apparatskåp ${esc(skap.namn)}</title><style>
      @page{size:A4;margin:14mm} body{font-family:Arial,sans-serif;font-size:10pt} h1{font-size:15pt;color:#1E3450;margin:0}
      h2{font-size:11.5pt;color:#1E3450;border-bottom:1px solid #bbb;margin:14px 0 4px} .h{display:flex;justify-content:space-between;border-bottom:2px solid #1E3450;padding-bottom:6px}
      table{border-collapse:collapse;width:100%} th{text-align:left;width:40%;font-weight:normal;color:#555;padding:2px 4px} td{padding:2px 4px}
      .tva{columns:2;column-gap:20px} p{white-space:pre-wrap;margin:0}</style></head><body>
      <div class="h"><h1>Apparatskåp ${esc(skap.namn)}</h1><div>${esc(projekt?.namn ?? "")}<br>${esc([projekt?.nummer, projekt?.kund].filter(Boolean).join(" · "))}</div></div>
      <h2>Grundinformation</h2><table>${rad("Beteckning", f.beteckning)}${rad("Placering", f.placering)}${rad("Beskrivning", f.beskrivning)}</table>
      <h2>Ledningsfärger</h2><div class="tva"><table>${FARGER.map(([k, n]) => rad(n, f.farger[k] ?? "")).join("")}</table></div>
      <h2>Komponenter i skåpet</h2><table>${valda.length ? valda.map((n) => rad(n, f.komponenter[n]?.info ?? "")).join("") : "<tr><td>Inga valda.</td></tr>"}</table>
      <h2>Skåpspecifikation</h2><table>${SPEC.map(([k, n]) => rad(n, f.spec[k] ?? "")).join("")}</table>
      <h2>Övrigt</h2><p>${esc(f.ovrigt)}</p>
      <script>window.onload=()=>{window.focus();window.print();}</script></body></html>`);
    w.document.close();
  };

  const falt = (etikett: string, varde: string, satt: (v: string) => void, lang = false) => (
    <label key={etikett} className={`skapfalt ${lang ? "lang" : ""}`}>
      <span>{etikett}</span>
      {lang
        ? <textarea rows={3} value={varde} readOnly={lasläge} onChange={(e) => satt(e.target.value)} />
        : <input type="text" value={varde} readOnly={lasläge} onChange={(e) => satt(e.target.value)} />}
    </label>
  );

  return (
    <div className="skapformular">
      <div className="verktygsrad">
        <button className="knapp" onClick={skrivUt}>Skriv ut / PDF</button>
        <span className="dampad liten">{status === "sparar" ? "Sparar…" : status === "osparat" ? "Osparade ändringar" : "Sparat"}</span>
      </div>

      <section className="panel">
        <h2>Grundinformation</h2>
        <div className="skapgrid">
          {falt("Beteckning", f.beteckning, (v) => andra({ ...f, beteckning: v }))}
          {falt("Placering", f.placering, (v) => andra({ ...f, placering: v }))}
          {falt("Beskrivning", f.beskrivning, (v) => andra({ ...f, beskrivning: v }), true)}
        </div>
        <p className="dampad liten">
          {bet
            ? `${anslutna.length} komponenter har "Ansluts till" = ${f.beteckning}${anslutna.length ? ": " + anslutna.slice(0, 12).map((k) => k.beteckning).join(", ") + (anslutna.length > 12 ? " …" : "") : "."}`
            : "Fyll i skåpets beteckning så visas vilka komponenter som är anslutna till skåpet (fältet Ansluts till i Komponenter)."}
        </p>
      </section>

      <section className="panel">
        <h2>Ledningsfärger</h2>
        <div className="skapgrid tre">
          {FARGER.map(([k, n]) => (
            <label key={k} className="skapfalt">
              <span>{n}</span>
              <select value={f.farger[k] ?? ""} disabled={lasläge} onChange={(e) => andra({ ...f, farger: { ...f.farger, [k]: e.target.value } })}>
                {[...new Set([f.farger[k] ?? "", ...LEDNINGSFARGER])].filter(Boolean).map((v) => <option key={v}>{v}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Komponenter i skåpet <span className="dampad liten">({valda.length} valda)</span></h2>
        <div className="skapkomponenter">
          {KOMPONENTER.map((n) => {
            const v = f.komponenter[n] ?? { vald: false, info: "" };
            return (
              <div key={n} className={`skapkomp ${v.vald ? "vald" : ""}`}>
                <label><input type="checkbox" checked={v.vald} disabled={lasläge}
                  onChange={(e) => andra({ ...f, komponenter: { ...f.komponenter, [n]: { ...v, vald: e.target.checked } } })} /> {n}</label>
                <input type="text" value={v.info} readOnly={lasläge} placeholder="Information" aria-label={`Information ${n}`}
                  onChange={(e) => andra({ ...f, komponenter: { ...f.komponenter, [n]: { ...v, info: e.target.value, vald: v.vald || e.target.value !== "" } } })} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>Skåpspecifikation</h2>
        <div className="skapgrid">
          {SPEC.map(([k, n]) => falt(n, f.spec[k] ?? "", (v) => andra({ ...f, spec: { ...f.spec, [k]: v } })))}
        </div>
      </section>

      <section className="panel">
        <h2>Övrigt</h2>
        <textarea className="skaptext" rows={4} value={f.ovrigt} readOnly={lasläge} onChange={(e) => andra({ ...f, ovrigt: e.target.value })} />
      </section>
    </div>
  );
}
