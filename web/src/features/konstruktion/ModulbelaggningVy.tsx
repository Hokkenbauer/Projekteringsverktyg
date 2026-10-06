import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiFel, laddaNer, skicka } from "../../lib/api";
import type { Komponent, Korttyp, ModulKort, Modulbelaggning, Projekt, Skap } from "../../lib/typer";
import { Dialog } from "../../shell/Dialog";

const MAX_MA = 2000;
const tal = (v: number) => v.toLocaleString("sv-SE", { maximumFractionDigits: 3 });
const nyttId = () => Math.random().toString(36).slice(2, 10);

export function lasModuler(json: string): Modulbelaggning {
  try {
    const m = JSON.parse(json || "{}") as Partial<Modulbelaggning>;
    return {
      cpu1: m.cpu1 ?? "",
      kort: (m.kort ?? []).map((k) => ({ ...k, id: k.id || nyttId(), kanaler: k.kanaler ?? [] })),
    };
  } catch {
    return { cpu1: "", kort: [] };
  }
}

/** Textfärg som syns mot kortets färg. */
function textFor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#000";
  const n = parseInt(m[1]!, 16);
  const lum = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#000" : "#fff";
}

type Props = {
  projektId: string;
  projekt: Projekt | null;
  skap: Skap;
  allaSkap: Skap[];
  komponenter: Komponent[];
  lasläge: boolean;
  onSparat: (s: Skap) => void;
  onKonflikt: () => void;
  visaMeddelande: (t: string) => void;
};

/**
 * Modulbeläggning, som i dagens program: CPU1 först, sedan I/O-kort (M1, M2 …) i placeringsordning.
 * Signaler (komponenter med signaltyp) dras från listan till vänster till en kanal. Kopplad kanal blir grön,
 * samma komponent på flera kanaler (i vilket skåp som helst) blir röd. Total bredd och ström räknas löpande
 * mot 2000 mA per PLC. Kanalerna pekar bara på komponentens Id; beteckning, typ och beskrivning hämtas
 * alltid från Komponenter.
 */
export function ModulbelaggningVy({ projektId, projekt, skap, allaSkap, komponenter, lasläge, onSparat, onKonflikt, visaMeddelande }: Props) {
  const [m, setM] = useState<Modulbelaggning>(() => lasModuler(skap.moduler));
  const [status, setStatus] = useState<"sparat" | "osparat" | "sparar">("sparat");
  const [sok, setSok] = useState("");
  const [baraOkopplade, setBaraOkopplade] = useState(false);
  const [dialog, setDialog] = useState(false);
  const [markerad, setMarkerad] = useState<{ kort: string; kanal: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const version = useRef(skap.version);
  const senast = useRef(skap.moduler);

  // Ändringar från andra (eller byte av skåp) slår igenom när man inte har osparat.
  useEffect(() => {
    version.current = skap.version;
    if (status !== "osparat" && skap.moduler !== senast.current) {
      setM(lasModuler(skap.moduler));
      senast.current = skap.moduler;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skap.id, skap.version, skap.moduler]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const andra = (ny: Modulbelaggning) => {
    if (lasläge) return;
    setM(ny);
    setStatus("osparat");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void spara(ny), 700);
  };

  const spara = async (ny: Modulbelaggning) => {
    const json = JSON.stringify(ny);
    setStatus("sparar");
    try {
      const s = await api<Skap>(`/api/projekt/${projektId}/skap/${skap.id}/moduler`, {
        method: "PUT", body: skicka({ moduler: json, version: version.current }),
      });
      version.current = s.version;
      senast.current = s.moduler;
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

  // ---- Signaler ----
  const komponentPerId = useMemo(() => new Map(komponenter.map((k) => [k.id, k])), [komponenter]);
  const anvandning = useMemo(() => {
    // Räknar kopplingar i alla skåp, med det här skåpets osparade läge.
    const antal = new Map<string, number>();
    for (const s of allaSkap) {
      const mod = s.id === skap.id ? m : lasModuler(s.moduler);
      for (const k of mod.kort) for (const c of k.kanaler) if (c.komponentId) antal.set(c.komponentId, (antal.get(c.komponentId) ?? 0) + 1);
    }
    return antal;
  }, [allaSkap, skap.id, m]);

  const signaler = useMemo(() => komponenter
    .filter((k) => k.signaltyp.trim())
    .map((k) => ({ k, anvand: (anvandning.get(k.id) ?? 0) > 0 }))
    .sort((a, b) => Number(a.anvand) - Number(b.anvand) || a.k.beteckning.localeCompare(b.k.beteckning, "sv", { numeric: true })),
  [komponenter, anvandning]);
  const q = sok.trim().toLowerCase();
  const synliga = signaler.filter((s) => (!baraOkopplade || !s.anvand)
    && (!q || s.k.beteckning.toLowerCase().includes(q) || s.k.signaltyp.toLowerCase().includes(q) || s.k.beskrivning.toLowerCase().includes(q)));
  const okopplade = signaler.filter((s) => !s.anvand).length;

  // ---- Kort ----
  const koppla = (kortId: string, kanal: number, komponentId: string, franKort?: string, franKanal?: number) => {
    const ny: Modulbelaggning = {
      ...m,
      kort: m.kort.map((k) => {
        let kanaler = k.kanaler;
        if (franKort === k.id && franKanal !== undefined) {
          kanaler = kanaler.map((c, i) => (i === franKanal ? { information: c.information } : c));
        }
        if (k.id === kortId) kanaler = kanaler.map((c, i) => (i === kanal ? { ...c, komponentId } : c));
        return kanaler === k.kanaler ? k : { ...k, kanaler };
      }),
    };
    andra(ny);
  };
  const kopplaLoss = (kortId: string, kanal: number) =>
    andra({ ...m, kort: m.kort.map((k) => (k.id === kortId ? { ...k, kanaler: k.kanaler.map((c, i) => (i === kanal ? {} : c)) } : k)) });
  const sattInfo = (kortId: string, kanal: number, information: string) =>
    andra({ ...m, kort: m.kort.map((k) => (k.id === kortId ? { ...k, kanaler: k.kanaler.map((c, i) => (i === kanal ? { ...c, information } : c)) } : k)) });
  const flytta = (i: number, steg: number) => {
    const kort = [...m.kort];
    const j = i + steg;
    if (j < 0 || j >= kort.length) return;
    [kort[i], kort[j]] = [kort[j]!, kort[i]!];
    andra({ ...m, kort });
  };
  const taBortKort = (i: number) => {
    const k = m.kort[i]!;
    if (!window.confirm(`Ta bort kortet M${i + 1} (${k.beskrivning})?`)) return;
    andra({ ...m, kort: m.kort.filter((_, x) => x !== i) });
  };
  const rensaAlla = () => {
    if (!m.kort.length || !window.confirm(`Ta bort alla ${m.kort.length} kort i ${skap.namn}?`)) return;
    andra({ ...m, kort: [] });
  };

  // Delete på markerad kanal kopplar loss den (som i dagens program).
  useEffect(() => {
    const tangent = (e: KeyboardEvent) => {
      if (!markerad || lasläge) return;
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); kopplaLoss(markerad.kort, markerad.kanal); }
    };
    window.addEventListener("keydown", tangent);
    return () => window.removeEventListener("keydown", tangent);
  });

  const totalBredd = m.kort.reduce((s, k) => s + (Number(k.breddMm) || 0), 0);
  const totalMa = m.kort.reduce((s, k) => s + (Number(k.stromMa) || 0), 0);

  const skrivUt = () => {
    const f = window.open("", "_blank");
    if (!f) { alert("Tillåt popup-fönster för sidan för att kunna skriva ut."); return; }
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const kortHtml = m.kort.map((k, i) => `
      <table><thead><tr><th colspan="5" style="background:${esc(k.farg)};color:${textFor(k.farg)}">M${i + 1} &nbsp; ${esc(k.beskrivning)} &nbsp; [${tal(k.stromMa)} mA ${tal(k.breddMm)} mm]</th></tr>
      ${k.kanaler.length ? "<tr><th>Kanal</th><th>Beteckning</th><th>Komponent</th><th>Beskrivning</th><th>Information</th></tr>" : ""}</thead>
      <tbody>${k.kanaler.map((c, j) => { const kp = c.komponentId ? komponentPerId.get(c.komponentId) : undefined;
        return `<tr><td>M${i + 1}:${j + 1}</td><td>${esc(kp?.beteckning ?? "")}</td><td>${esc(kp?.komponenttyp ?? "")}</td><td>${esc(kp?.beskrivning ?? "")}</td><td>${esc(c.information ?? "")}</td></tr>`; }).join("")}</tbody></table>`).join("");
    f.document.write(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>Modulbeläggning ${esc(skap.namn)}</title><style>
      @page{size:A4;margin:14mm} body{font-family:Arial,sans-serif;font-size:9.5pt}
      h1{font-size:15pt;color:#1E3450;margin:0} .h{display:flex;justify-content:space-between;border-bottom:2px solid #1E3450;padding-bottom:6px;margin-bottom:10px}
      table{border-collapse:collapse;width:100%;margin-bottom:8px;page-break-inside:avoid} th,td{border:1px solid #bbb;padding:3px 5px;text-align:left}
      th{-webkit-print-color-adjust:exact;print-color-adjust:exact;background:#eee} .cpu{font-weight:bold;margin-bottom:8px}
      .sum{margin-top:10px;font-weight:bold}</style></head><body>
      <div class="h"><h1>Modulbeläggning ${esc(skap.namn)}</h1><div>${esc(projekt?.namn ?? "")}<br>${esc([projekt?.nummer, projekt?.kund].filter(Boolean).join(" · "))}</div></div>
      <div class="cpu">CPU1: ${esc(m.cpu1)}</div>${kortHtml}
      <div class="sum">Totalt: ${tal(totalBredd)} mm &nbsp; | &nbsp; ${tal(totalMa)} / ${tal(MAX_MA)} mA</div>
      <script>window.onload=()=>{window.focus();window.print();}</script></body></html>`);
    f.document.close();
  };

  return (
    <div className="modulyta">
      <aside className="signalpanel">
        <h3>Signaler <span className="dampad">(dra till kanal)</span></h3>
        <input className="sok" type="search" placeholder="Sök signal" value={sok} onChange={(e) => setSok(e.target.value)} />
        <label className="kryssrad"><input type="checkbox" checked={baraOkopplade} onChange={(e) => setBaraOkopplade(e.target.checked)} /> Visa bara okopplade</label>
        <div className="dampad liten">{okopplade} av {signaler.length} okopplade</div>
        <ul className="signallista">
          {synliga.map(({ k, anvand }) => (
            <li
              key={k.id} draggable={!lasläge} className={anvand ? "anvand" : undefined}
              onDragStart={(e) => { e.dataTransfer.setData("text/komponent", k.id); e.dataTransfer.effectAllowed = "copyMove"; }}
              title={[k.komponenttyp, k.beskrivning].filter(Boolean).join(" – ")}
            >
              {anvand && <span aria-label="kopplad">✓</span>}
              <span className="mono">{k.beteckning || "(utan beteckning)"}</span>
              <span className="dampad">{k.signaltyp}</span>
            </li>
          ))}
          {signaler.length === 0 && <li className="dampad">Inga komponenter med signaltyp. Fyll i Signaltyp i Komponenter.</li>}
        </ul>
      </aside>

      <section className="modulinnehall">
        <div className="verktygsrad">
          {!lasläge && <button className="knapp primar" onClick={() => setDialog(true)}>+ Lägg till I/O-kort</button>}
          <button className="knapp" onClick={skrivUt}>Skriv ut / PDF</button>
          <button className="knapp" onClick={() => void laddaNer(`/api/projekt/${projektId}/skap/${skap.id}/moduler/excel`, "Modulbeläggning.xlsx").catch((e) => visaMeddelande((e as Error).message))}>Exportera Excel</button>
          {!lasläge && <button className="knapp fara" disabled={!m.kort.length} onClick={rensaAlla}>Rensa alla</button>}
          <span className="dampad liten">{status === "sparar" ? "Sparar…" : status === "osparat" ? "Osparade ändringar" : "Sparat"}</span>
        </div>

        <div className="cpurad">
          <span className="cpu">CPU1</span>
          <input type="text" value={m.cpu1} readOnly={lasläge} placeholder="Beskrivning av PLC, t.ex. CX9020"
            onChange={(e) => andra({ ...m, cpu1: e.target.value })} />
        </div>

        {m.kort.length === 0 && <p className="tomruta">Inga I/O-kort än. Klicka på Lägg till I/O-kort.</p>}
        {m.kort.map((k, i) => {
          const fg = textFor(k.farg);
          return (
            <div key={k.id} className="modulkort">
              <div className="kortrubrik" style={{ background: k.farg, color: fg }}>
                <b>M{i + 1}</b>
                <span className="spec">{k.beskrivning} &nbsp; [{tal(k.stromMa)} mA &nbsp; {tal(k.breddMm)} mm]</span>
                {!lasläge && (
                  <>
                    <button style={{ color: fg }} disabled={i === 0} onClick={() => flytta(i, -1)} aria-label="Flytta upp">▲</button>
                    <button style={{ color: fg }} disabled={i === m.kort.length - 1} onClick={() => flytta(i, 1)} aria-label="Flytta ned">▼</button>
                    <button style={{ color: fg }} onClick={() => taBortKort(i)} aria-label="Ta bort kortet">✕</button>
                  </>
                )}
              </div>
              {k.kanaler.length > 0 && (
                <table className="kanaler">
                  <thead><tr><th>Kanal</th><th>Beteckning</th><th>Komponent</th><th>Beskrivning</th><th>Information</th><th aria-label="Koppla loss" /></tr></thead>
                  <tbody>
                    {k.kanaler.map((c, j) => {
                      const kp = c.komponentId ? komponentPerId.get(c.komponentId) : undefined;
                      const dubbel = c.komponentId ? (anvandning.get(c.komponentId) ?? 0) > 1 : false;
                      const saknas = c.komponentId && !kp;
                      const klass = [c.komponentId ? (dubbel ? "dubbel" : "kopplad") : "", markerad?.kort === k.id && markerad.kanal === j ? "markerad" : ""].join(" ").trim();
                      return (
                        <tr
                          key={j} className={klass || undefined}
                          onClick={() => setMarkerad({ kort: k.id, kanal: j })}
                          onDragOver={(e) => { if (!lasläge) { e.preventDefault(); e.currentTarget.classList.add("over"); } }}
                          onDragLeave={(e) => e.currentTarget.classList.remove("over")}
                          onDrop={(e) => {
                            e.preventDefault(); e.currentTarget.classList.remove("over");
                            const id = e.dataTransfer.getData("text/komponent");
                            const fran = e.dataTransfer.getData("text/kanal");
                            if (!id) return;
                            if (fran) { const [fk, fc] = fran.split("|"); koppla(k.id, j, id, fk, Number(fc)); }
                            else koppla(k.id, j, id);
                          }}
                          title={dubbel ? "Samma komponent är kopplad på flera kanaler" : undefined}
                        >
                          <td className="mono">M{i + 1}:{j + 1}</td>
                          <td
                            className="mono" draggable={!!c.komponentId && !lasläge}
                            onDragStart={(e) => { e.dataTransfer.setData("text/komponent", c.komponentId!); e.dataTransfer.setData("text/kanal", `${k.id}|${j}`); e.dataTransfer.effectAllowed = "move"; }}
                          >{saknas ? "(borttagen komponent)" : kp?.beteckning ?? ""}</td>
                          <td>{kp?.komponenttyp ?? ""}</td>
                          <td>{kp?.beskrivning ?? ""}</td>
                          <td className="info">
                            <input type="text" value={c.information ?? ""} readOnly={lasläge} aria-label={`Information M${i + 1}:${j + 1}`}
                              onChange={(e) => sattInfo(k.id, j, e.target.value)} />
                          </td>
                          <td className="smal">
                            {c.komponentId && !lasläge && <button className="lossknapp" onClick={(e) => { e.stopPropagation(); kopplaLoss(k.id, j); }} aria-label="Koppla loss" title="Koppla loss">×</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

        <div className={`modulsumma ${totalMa > MAX_MA ? "over" : ""}`}>
          Totalt: {tal(totalBredd)} mm &nbsp;|&nbsp; {tal(totalMa)} / {tal(MAX_MA)} mA
          {totalMa > MAX_MA && " – för hög ström för en PLC"}
        </div>
      </section>

      <KortDialog
        oppen={dialog} onStang={() => setDialog(false)}
        onLaggTill={(mall, antal) => {
          const nya: ModulKort[] = Array.from({ length: antal }, () => ({
            ...mall, id: nyttId(), kanaler: Array.from({ length: mall.antalKanaler }, () => ({})),
          }));
          andra({ ...m, kort: [...m.kort, ...nya] });
          setDialog(false);
        }}
      />
    </div>
  );
}

/** Lägg till I/O-kort: välj korttyp (fyller i resten) eller fyll i själv, och hur många likadana kort. */
function KortDialog({ oppen, onStang, onLaggTill }: {
  oppen: boolean; onStang: () => void;
  onLaggTill: (kort: Omit<ModulKort, "id" | "kanaler">, antal: number) => void;
}) {
  const [typer, setTyper] = useState<Korttyp[]>([]);
  const [typId, setTypId] = useState("");
  const [f, setF] = useState({ beskrivning: "", antalKanaler: 8, farg: "#FFD700", bredd: "12", strom: "0" });
  const [antal, setAntal] = useState(1);

  useEffect(() => { if (oppen) api<Korttyp[]>("/api/korttyper").then(setTyper).catch(() => setTyper([])); }, [oppen]);

  const valj = (id: string) => {
    setTypId(id);
    const t = typer.find((x) => x.id === id);
    if (t) setF({ beskrivning: t.beskrivning || t.namn, antalKanaler: t.antalKanaler, farg: t.farg, bredd: String(t.breddMm).replace(".", ","), strom: String(t.stromMa).replace(".", ",") });
  };
  const num = (v: string) => Number(v.replace(",", ".")) || 0;

  return (
    <Dialog
      titel="Lägg till I/O-kort" oppen={oppen} onStang={onStang}
      fot={<>
        <button className="knapp" onClick={onStang}>Avbryt</button>
        <button className="knapp primar" disabled={!f.beskrivning.trim()} onClick={() => onLaggTill({ beskrivning: f.beskrivning.trim(), antalKanaler: f.antalKanaler, farg: f.farg, breddMm: num(f.bredd), stromMa: num(f.strom) }, Math.max(1, antal))}>Lägg till</button>
      </>}
    >
      <div className="kortformular">
        <label>Korttyp
          <select value={typId} onChange={(e) => valj(e.target.value)}>
            <option value="">Egen…</option>
            {typer.map((t) => <option key={t.id} value={t.id}>{t.namn} – {t.antalKanaler} kanaler</option>)}
          </select>
        </label>
        <label>Beskrivning<input type="text" value={f.beskrivning} onChange={(e) => setF({ ...f, beskrivning: e.target.value })} /></label>
        <label>Antal kanaler<input type="number" min={0} max={64} value={f.antalKanaler} onChange={(e) => setF({ ...f, antalKanaler: Math.max(0, Math.min(64, num(e.target.value))) })} /></label>
        <label>Färg<span className="fargval"><input type="color" value={f.farg} onChange={(e) => setF({ ...f, farg: e.target.value })} /><input type="text" value={f.farg} onChange={(e) => setF({ ...f, farg: e.target.value })} /></span></label>
        <label>Bredd (mm)<input type="text" inputMode="decimal" value={f.bredd} onChange={(e) => setF({ ...f, bredd: e.target.value })} /></label>
        <label>Ström (mA)<input type="text" inputMode="decimal" value={f.strom} onChange={(e) => setF({ ...f, strom: e.target.value })} /></label>
        <label>Antal kort<input type="number" min={1} max={64} value={antal} onChange={(e) => setAntal(Math.max(1, Math.min(64, num(e.target.value))))} /></label>
        <p className="dampad liten">Kort som tillför ström till slingan kan ha negativ ström, då dras den av från summan.</p>
      </div>
    </Dialog>
  );
}
