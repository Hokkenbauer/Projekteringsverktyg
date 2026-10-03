import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * Den gemensamma tabellmotorn. Varje flik som är en tabell beskriver bara sina kolumner;
 * sök, sortering, markering, ny rad, borttagning och redigering i cellen finns här.
 */

export type Kolumn<T> = {
  nyckel: keyof T & string;
  rubrik: string;
  typ: "text" | "val";
  val?: string[];
  mono?: boolean;
  bredd?: number;
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
};

export function DataGrid<T extends Rad>({
  rader, kolumner, sokPlatshallare, onAndra, onNy, onTaBort, blinkar = [], verktyg,
}: Props<T>) {
  const [sok, setSok] = useState("");
  const [sortering, setSortering] = useState<{ nyckel: string; riktning: 1 | -1 } | null>(null);
  const [markerade, setMarkerade] = useState<Set<string>>(new Set());

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

  // Markerade rader som inte längre finns (t.ex. borttagna av någon annan) släpps.
  useEffect(() => {
    setMarkerade((m) => {
      const ids = new Set(rader.map((r) => r.id));
      const kvar = new Set([...m].filter((id) => ids.has(id)));
      return kvar.size === m.size ? m : kvar;
    });
  }, [rader]);

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
        {verktyg}
        <span className="antal">
          {synliga.length === rader.length ? `${rader.length} rader` : `${synliga.length} av ${rader.length} rader`}
        </span>
      </div>
      <div className="grid-ram">
        <table className="grid">
          <thead>
            <tr>
              {onTaBort && <th className="smal" aria-label="Markera" />}
              {kolumner.map((k) => (
                <th key={k.nyckel} onClick={() => sortera(k.nyckel)} style={k.bredd ? { minWidth: k.bredd } : undefined}>
                  {k.rubrik}
                  {sortering?.nyckel === k.nyckel && <span className="pil">{sortering.riktning > 0 ? "▲" : "▼"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {synliga.length === 0 && (
              <tr><td colSpan={kolumner.length + 1} className="tom">
                {rader.length === 0 ? "Inga rader än. Klicka på Ny rad för att börja." : "Inga rader matchar sökningen."}
              </td></tr>
            )}
            {synliga.map((r) => (
              <tr key={r.id} className={markerade.has(r.id) ? "markerad" : undefined}>
                {onTaBort && (
                  <td className="smal">
                    <input type="checkbox" aria-label="Markera rad" checked={markerade.has(r.id)} onChange={() => vaxla(r.id)} />
                  </td>
                )}
                {kolumner.map((k) => {
                  const blink = blinkar.find((b) => b.radId === r.id && b.nyckel === k.nyckel);
                  return (
                    <Cell
                      key={k.nyckel}
                      kolumn={k}
                      varde={String(r[k.nyckel] ?? "")}
                      blink={blink}
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

function Cell<T>({ kolumn, varde, blink, onSpara }: {
  kolumn: Kolumn<T>; varde: string; blink?: Blink; onSpara: (v: string) => void;
}) {
  const [utkast, setUtkast] = useState(varde);
  const fokus = useRef(false);
  const avbrutet = useRef(false);

  // Uppdateringar från andra slår igenom, utom i cellen man själv skriver i.
  useEffect(() => {
    if (!fokus.current) setUtkast(varde);
  }, [varde]);

  const stil = blink ? ({ "--blink": blink.farg } as CSSProperties) : undefined;
  const klass = [kolumn.mono ? "mono" : "", blink ? "blinkar" : ""].join(" ").trim() || undefined;

  if (kolumn.typ === "val") {
    const val = kolumn.val ?? [];
    const alternativ = varde && !val.includes(varde) ? [varde, ...val] : val;
    return (
      <td className={klass} style={stil} key={blink?.tid}>
        <select aria-label={kolumn.rubrik} value={varde} onChange={(e) => onSpara(e.target.value)}>
          <option value="" />
          {alternativ.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </td>
    );
  }

  return (
    <td className={klass} style={stil} key={blink?.tid}>
      <input
        type="text" aria-label={kolumn.rubrik} spellCheck={false} value={utkast}
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
