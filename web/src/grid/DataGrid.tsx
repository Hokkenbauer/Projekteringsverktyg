import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Den gemensamma tabellmotorn. Varje flik som är en tabell beskriver bara sina kolumner;
 * sök, sortering, markering, ny rad, borttagning och redigering i cellen finns här.
 */

export type Kolumn<T> = {
  nyckel: keyof T & string;
  rubrik: string;
  /** ro = visas men ändras inte här (t.ex. uppgifter som hämtas från Komponenter, eller löpnummer). */
  typ: "text" | "val" | "kryss" | "datum" | "ro";
  val?: string[];
  mono?: boolean;
  bredd?: number;
  /** Kolumnen tar allt utrymme som blir över. */
  fyll?: boolean;
  /** För typ text: förslag som visas medan man skriver (fritt värde går ändå). */
  forslag?: string[];
  /** Egen cell (t.ex. en knapp som öppnar en ruta). Sökning och sortering använder fortfarande värdet i nyckel. */
  cell?: (rad: T) => ReactNode;
};

export type Blink = { radId: string; nyckel: string; farg: string; tid: number };

type Rad = { id: string };

type Props<T extends Rad> = {
  rader: T[];
  kolumner: Kolumn<T>[];
  sokPlatshallare: string;
  onAndra: (rad: T, nyckel: keyof T & string, varde: string) => void;
  onNy?: () => void;
  onTaBort?: (ids: string[]) => void;
  blinkar?: Blink[];
  verktyg?: ReactNode;
  /** Läsläge: inga ändringar, inga knappar för ny rad eller borttagning. */
  lasläge?: boolean;
  /** Text som visas när tabellen är tom. */
  tomText?: string;
  /** Returnerar en varningstext för en cell (cellen markeras röd), annars undefined. */
  cellVarning?: (rad: T, nyckel: string) => string | undefined;
  /** Extra CSS-klass för en cell, t.ex. färg efter riskvärde. */
  cellKlass?: (rad: T, nyckel: string) => string | undefined;
  /** Visar en informationsknapp först på varje rad. */
  onInfo?: (rad: T) => void;
  /** Rad som ska visas och markeras en stund (t.ex. efter länk från Komponentinformation). */
  fokusId?: string | null;
  /** Knappar som gäller markerade rader (visas i verktygsraden). */
  markeradeVerktyg?: (ids: string[]) => ReactNode;
  /** Raderna går att flytta (dra i handtaget eller pilarna). Får hela den nya ordningen som id:n. */
  onFlytta?: (ids: string[]) => void;
  /** Rubrik på kolumnen med markeringsrutor (t.ex. "För utskrift"). */
  markeraRubrik?: string;
  /** Anropas när markeringen ändras. */
  onMarkerade?: (ids: string[]) => void;
};

export function DataGrid<T extends Rad>({
  rader, kolumner, sokPlatshallare, onAndra, onNy: nyIn, onTaBort: taBortIn, blinkar = [], verktyg, lasläge = false, tomText, cellVarning, cellKlass, markeradeVerktyg, onInfo, fokusId, onFlytta: flyttaIn, markeraRubrik, onMarkerade,
}: Props<T>) {
  const ram = useRef<HTMLDivElement>(null);
  const onNy = lasläge ? undefined : nyIn;
  const onTaBort = lasläge ? undefined : taBortIn;
  const [sok, setSok] = useState("");
  const [sortering, setSortering] = useState<{ nyckel: string; riktning: 1 | -1 } | null>(null);
  const [markerade, setMarkerade] = useState<Set<string>>(new Set());
  const [drar, setDrar] = useState<string | null>(null);
  // Kolumnbredder som användaren dragit fram (sparas per tabell i webbläsaren). null = automatiska bredder.
  const breddNyckel = `pv.kolumner.${kolumner.map((k) => k.nyckel).join(",")}`;
  const [bredder, setBredder] = useState<Record<string, number> | null>(() => {
    try { const v = localStorage.getItem(breddNyckel); return v ? JSON.parse(v) as Record<string, number> : null; } catch { return null; }
  });
  const tabell = useRef<HTMLTableElement>(null);
  const andrar = useRef<{ nyckel: string; startX: number; startB: number; alla: Record<string, number> } | null>(null);
  const borjaAndraBredd = (e: React.PointerEvent, nyckel: string) => {
    e.preventDefault(); e.stopPropagation();
    // Första gången: mät alla kolumner som de ser ut nu, så att bara den dragna ändras.
    const alla: Record<string, number> = { ...(bredder ?? {}) };
    tabell.current?.querySelectorAll<HTMLTableCellElement>("thead th").forEach((th) => {
      const k = th.dataset.kol; if (k && alla[k] === undefined) alla[k] = Math.round(th.getBoundingClientRect().width);
    });
    andrar.current = { nyckel, startX: e.clientX, startB: alla[nyckel] ?? 120, alla };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setBredder(alla);
  };
  const flyttaBredd = (e: React.PointerEvent) => {
    const a = andrar.current; if (!a) return;
    const ny = Math.max(40, Math.round(a.startB + e.clientX - a.startX));
    a.alla = { ...a.alla, [a.nyckel]: ny };
    setBredder(a.alla);
  };
  const slappBredd = () => {
    const a = andrar.current; if (!a) return;
    andrar.current = null;
    try { localStorage.setItem(breddNyckel, JSON.stringify(a.alla)); } catch { /* bara bekvämlighet */ }
  };
  const aterstallBredder = () => { setBredder(null); try { localStorage.removeItem(breddNyckel); } catch { /* */ } };
  const [over, setOver] = useState<{ id: string; fore: boolean } | null>(null);
  // Flytta går bara när listan visas i sin egen ordning (ingen sökning eller sortering).
  const harFlytta = !!flyttaIn && !lasläge;
  const kanFlytta = harFlytta && !sok && !sortering;
  const flytta = (id: string, malIndex: number) => {
    const ids = rader.map((r) => r.id);
    const fran = ids.indexOf(id);
    if (fran < 0) return;
    ids.splice(fran, 1);
    const till = Math.max(0, Math.min(ids.length, malIndex > fran ? malIndex - 1 : malIndex));
    ids.splice(till, 0, id);
    if (ids.some((x, i) => x !== rader[i]!.id)) flyttaIn?.(ids);
  };

  const synliga = useMemo(() => {
    let lista = rader;
    if (sok) {
      const q = sok.toLowerCase();
      lista = lista.filter((r) => kolumner.some((k) => String(r[k.nyckel] ?? "").toLowerCase().includes(q)));
    }
    if (sortering) {
      const { nyckel, riktning } = sortering;
      lista = [...lista].sort(
        (a, b) =>
          String((a as Record<string, unknown>)[nyckel] ?? "").localeCompare(
            String((b as Record<string, unknown>)[nyckel] ?? ""), "sv", { numeric: true },
          ) * riktning,
      );
    }
    return lista;
  }, [rader, kolumner, sok, sortering]);

  // Rad i fokus: rensa sökningen om den döljer raden och scrolla fram den.
  useEffect(() => {
    if (!fokusId) return;
    if (!synliga.some((r) => r.id === fokusId) && rader.some((r) => r.id === fokusId)) setSok("");
    const t = window.setTimeout(() => {
      ram.current?.querySelector(`tr[data-rad="${CSS.escape(fokusId)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fokusId, rader.length]);

  // Markerade rader som inte längre finns (t.ex. borttagna av någon annan) släpps.
  useEffect(() => {
    setMarkerade((m) => {
      const ids = new Set(rader.map((r) => r.id));
      const kvar = new Set([...m].filter((id) => ids.has(id)));
      return kvar.size === m.size ? m : kvar;
    });
  }, [rader]);

  useEffect(() => { onMarkerade?.([...markerade]); }, [markerade]); // eslint-disable-line react-hooks/exhaustive-deps

  const vaxla = (id: string) =>
    setMarkerade((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const sortera = (nyckel: string) =>
    setSortering((s) => (s?.nyckel === nyckel ? { nyckel, riktning: (s.riktning * -1) as 1 | -1 } : { nyckel, riktning: 1 }));

  return (
    <div className="grid-yta">
      <div className="verktygsrad">
        <input
          className="sok" type="search" placeholder={sokPlatshallare} aria-label="Sök"
          value={sok} onChange={(e) => setSok(e.target.value)}
        />
        {onNy && <button className="knapp primar" onClick={onNy}>+ Ny rad</button>}
        {onTaBort && (
          <button
            className="knapp fara" disabled={markerade.size === 0}
            onClick={() => { onTaBort([...markerade]); setMarkerade(new Set()); }}
          >
            Ta bort markerade{markerade.size ? ` (${markerade.size})` : ""}
          </button>
        )}
        {markeradeVerktyg?.([...markerade])}
        {verktyg}
        {harFlytta && !kanFlytta && (
          <button className="knapp" onClick={() => { setSok(""); setSortering(null); }} title="Rader kan bara flyttas när listan visas i egen ordning">Visa egen ordning</button>
        )}
        <span className="antal">
          {synliga.length === rader.length ? `${rader.length} rader` : `${synliga.length} av ${rader.length} rader`}
        </span>
      </div>
      {kolumner.filter((k) => k.forslag?.length).map((k) => (
        <datalist key={k.nyckel} id={forslagId(k.forslag!)}>
          {k.forslag!.map((v) => <option key={v} value={v} />)}
        </datalist>
      ))}
      <div className="grid-ram" ref={ram}>
        <table
          ref={tabell} className={`grid ${bredder ? "fasta" : ""}`}
          style={bredder ? { width: Object.values(bredder).reduce((a, b) => a + b, 0) + 36 * ((kanFlytta ? 1 : 0) + (onTaBort ? 1 : 0) + (onInfo ? 1 : 0)), minWidth: 0 } : undefined}
        >
          <thead>
            <tr>
              {kanFlytta && <th className="smal" aria-label="Flytta" />}
              {onTaBort && (markeraRubrik
                ? <th className="smal markera-rubrik" title="Bocka i raderna som ska med i utskriften">{markeraRubrik}</th>
                : <th className="smal" aria-label="Markera" />)}
              {onInfo && <th className="smal" aria-label="Information" />}
              {kolumner.map((k) => (
                <th key={k.nyckel} data-kol={k.nyckel} onClick={() => sortera(k.nyckel)}
                  style={bredder?.[k.nyckel] ? { width: bredder[k.nyckel], minWidth: bredder[k.nyckel], maxWidth: bredder[k.nyckel] } : kolumnStil(k)}>
                  {k.rubrik}
                  {sortering?.nyckel === k.nyckel && <span className="pil">{sortering.riktning > 0 ? "▲" : "▼"}</span>}
                  <span
                    className="kolhandtag" title="Dra för att ändra bredden. Dubbelklicka för automatiska bredder."
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => { e.stopPropagation(); aterstallBredder(); }}
                    onPointerDown={(e) => borjaAndraBredd(e, k.nyckel)} onPointerMove={flyttaBredd} onPointerUp={slappBredd} onPointerCancel={slappBredd}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {synliga.length === 0 && (
              <tr><td colSpan={kolumner.length + 3} className="tom">
                {rader.length === 0 ? (tomText ?? "Inga rader än. Klicka på Ny rad för att börja.") : "Inga rader matchar sökningen."}
              </td></tr>
            )}
            {synliga.map((r, index) => (
              <tr
                key={r.id} data-rad={r.id}
                className={[markerade.has(r.id) ? "markerad" : "", fokusId === r.id ? "fokus" : "", drar === r.id ? "drar" : "",
                  over?.id === r.id ? (over.fore ? "slapp-fore" : "slapp-efter") : ""].join(" ").trim() || undefined}
                onDragOver={kanFlytta && drar ? (e) => {
                  e.preventDefault();
                  const b = e.currentTarget.getBoundingClientRect();
                  const fore = e.clientY < b.top + b.height / 2;
                  if (over?.id !== r.id || over.fore !== fore) setOver({ id: r.id, fore });
                } : undefined}
                onDrop={kanFlytta && drar ? (e) => {
                  e.preventDefault();
                  if (over) flytta(drar, index + (over.fore ? 0 : 1));
                  setDrar(null); setOver(null);
                } : undefined}
              >
                {kanFlytta && (
                  <td className="smal flyttcell">
                    <span
                      className="flytthandtag" draggable title="Dra för att flytta raden"
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", r.id);
                        const tr = (e.currentTarget as HTMLElement).closest("tr");
                        if (tr) e.dataTransfer.setDragImage(tr, 16, 16);
                        setDrar(r.id);
                      }}
                      onDragEnd={() => { setDrar(null); setOver(null); }}
                    >⠿</span>
                    <span className="flyttpilar">
                      <button title="Flytta upp" aria-label="Flytta upp" disabled={index === 0} onClick={() => flytta(r.id, index - 1)}>▲</button>
                      <button title="Flytta ned" aria-label="Flytta ned" disabled={index === synliga.length - 1} onClick={() => flytta(r.id, index + 2)}>▼</button>
                    </span>
                  </td>
                )}
                {onTaBort && (
                  <td className="smal">
                    <input type="checkbox" aria-label="Markera rad" checked={markerade.has(r.id)} onChange={() => vaxla(r.id)} />
                  </td>
                )}
                {onInfo && (
                  <td className="smal">
                    <button className="infoknapp" title="Komponentinformation: var finns komponenten?" aria-label="Komponentinformation" onClick={() => onInfo(r)}>i</button>
                  </td>
                )}
                {kolumner.map((k) => {
                  const blink = blinkar.find((b) => b.radId === r.id && b.nyckel === k.nyckel);
                  if (k.cell) return <td key={k.nyckel} className={`egen${blink ? " blinkar" : ""}`}>{k.cell(r)}</td>;
                  return (
                    <Cell
                      key={k.nyckel}
                      kolumn={k}
                      varde={String(r[k.nyckel] ?? "")}
                      blink={blink}
                      varning={cellVarning?.(r, k.nyckel)}
                      extraKlass={cellKlass?.(r, k.nyckel)}
                      lasläge={lasläge}
                      onSpara={(v) => onAndra(r, k.nyckel, v)}
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Stabilt id för en förslagslista, så att samma lista kan delas av flera celler. */
const forslagIds = new WeakMap<string[], string>();
let nastaForslag = 0;
function forslagId(lista: string[]) {
  let id = forslagIds.get(lista);
  if (!id) { id = `forslag-${++nastaForslag}`; forslagIds.set(lista, id); }
  return id;
}

function kolumnStil<T>(k: Kolumn<T>): CSSProperties | undefined {
  if (k.fyll) return { width: "100%", minWidth: k.bredd ?? 240 };
  if (k.bredd && k.bredd < 100) return { width: k.bredd, minWidth: k.bredd, maxWidth: k.bredd };
  if (k.bredd) return { minWidth: k.bredd };
  if (k.typ === "text") return { minWidth: 120 };
  return undefined;
}

function Cell<T>({ kolumn, varde, blink, varning, extraKlass, onSpara, lasläge }: {
  kolumn: Kolumn<T>; varde: string; blink?: Blink; varning?: string; extraKlass?: string; onSpara: (v: string) => void; lasläge: boolean;
}) {
  const [utkast, setUtkast] = useState(varde);
  const fokus = useRef(false);
  const avbrutet = useRef(false);

  // Uppdateringar från andra slår igenom, utom i cellen man själv skriver i.
  useEffect(() => {
    if (!fokus.current) setUtkast(varde);
  }, [varde]);

  const stil = blink ? ({ "--blink": blink.farg } as CSSProperties) : undefined;
  const klass = [kolumn.mono ? "mono" : "", blink ? "blinkar" : "", varning ? "varnar" : "", extraKlass ?? ""].join(" ").trim() || undefined;

  if (kolumn.typ === "ro") {
    return (
      <td className={["ro", klass].filter(Boolean).join(" ")} style={stil} key={blink?.tid} title={varning}>
        <span>{varde}</span>
      </td>
    );
  }

  if (kolumn.typ === "datum") {
    return (
      <td className={klass} style={stil} key={blink?.tid} title={varning}>
        <input
          type="date" aria-label={kolumn.rubrik} value={/^0001-/.test(varde) ? "" : varde} readOnly={lasläge} disabled={lasläge}
          onChange={(e) => { if (e.target.value !== varde) onSpara(e.target.value); }}
        />
      </td>
    );
  }

  if (kolumn.typ === "kryss") {
    return (
      <td className={["kryss", klass].filter(Boolean).join(" ")} style={stil} key={blink?.tid}>
        <input type="checkbox" aria-label={kolumn.rubrik} checked={varde === "true"} disabled={lasläge} onChange={(e) => onSpara(String(e.target.checked))} />
      </td>
    );
  }

  if (kolumn.typ === "val") {
    const val = kolumn.val ?? [];
    const alternativ = varde && !val.includes(varde) ? [varde, ...val] : val;
    return (
      <td className={klass} style={stil} key={blink?.tid}>
        <select aria-label={kolumn.rubrik} value={varde} disabled={lasläge} onChange={(e) => onSpara(e.target.value)}>
          <option value="" />
          {alternativ.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
    );
  }

  return (
    <td className={klass} style={stil} key={blink?.tid} title={varning}>
      <input
        type="text" aria-label={kolumn.rubrik} spellCheck={false} value={utkast} readOnly={lasläge} size={1}
        list={kolumn.forslag?.length ? forslagId(kolumn.forslag) : undefined}
        onFocus={() => { fokus.current = true; }}
        onChange={(e) => setUtkast(e.target.value)}
        onBlur={() => {
          fokus.current = false;
          if (avbrutet.current) { avbrutet.current = false; setUtkast(varde); return; }
          if (utkast !== varde) onSpara(utkast);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { avbrutet.current = true; (e.target as HTMLInputElement).blur(); }
        }}
      />
    </td>
  );
}
