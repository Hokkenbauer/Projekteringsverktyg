import { useMemo } from "react";
import type { Komponent, ListRad } from "../../lib/typer";

type Props = {
  gateways: ListRad[] | undefined;
  enheter: ListRad[] | undefined;
  komponenter: Komponent[];
  onFlik: (flik: string) => void;
};

/** Modbus RTU: hur många enheter som sitter på varje slinga (max 32) och om något ID finns två gånger. */
export function ModbusSumma({ gateways, enheter, komponenter, onFlik }: Props) {
  const rader = useMemo(() => {
    const perId = new Map(komponenter.map((k) => [k.id, k]));
    const namn = (r: ListRad) => perId.get(r.data.beteckning ?? "")?.beteckning ?? r.data.beteckning ?? "";
    const lista = (enheter ?? []);
    return (gateways ?? [])
      .filter((g) => (g.data.namn ?? "").trim())
      .sort((a, b) => a.ordning - b.ordning)
      .map((g) => {
        const s = g.data.namn!.trim().toLowerCase();
        const pa = lista.filter((r) => (r.data.slinga ?? "").trim().toLowerCase() === s);
        const antalPerId = new Map<string, string[]>();
        for (const r of pa) {
          const id = (r.data.id ?? "").trim();
          if (id) antalPerId.set(id, [...(antalPerId.get(id) ?? []), namn(r)]);
        }
        const dubbla = [...antalPerId.entries()].filter(([, n]) => n.length > 1);
        return { namn: g.data.namn!, antal: pa.length, dubbla };
      });
  }, [gateways, enheter, komponenter]);

  const utanSlinga = (enheter ?? []).filter((r) => !(r.data.slinga ?? "").trim()).length;
  const okanda = useMemo(() => {
    const kanda = new Set((gateways ?? []).map((g) => (g.data.namn ?? "").trim().toLowerCase()).filter(Boolean));
    return [...new Set((enheter ?? []).map((r) => (r.data.slinga ?? "").trim()).filter((s) => s && !kanda.has(s.toLowerCase())))];
  }, [gateways, enheter]);

  if (!gateways?.length) return null;
  return (
    <section className="panel modbussumma">
      <div className="rubrikrad">
        <h2>Enheter per slinga</h2>
        <button className="knapp" onClick={() => onFlik("modbus")}>Till Modbus</button>
      </div>
      <div className="slingor">
        {rader.map((r) => (
          <div key={r.namn} className={`slinga ${r.antal > 32 || r.dubbla.length ? "varning" : ""}`}>
            <b className="mono">{r.namn}</b>
            <span className={r.antal > 32 ? "fel" : ""}>{r.antal} av 32 enheter</span>
            {r.dubbla.map(([id, n]) => <span key={id} className="fel">ID {id} finns {n.length} gånger ({n.filter(Boolean).join(", ")})</span>)}
          </div>
        ))}
      </div>
      {(utanSlinga > 0 || okanda.length > 0) && (
        <p className="dampad liten">
          {utanSlinga > 0 && `${utanSlinga} enheter i Modbus saknar slinga. `}
          {okanda.length > 0 && `Slingor i Modbus som inte finns här: ${okanda.join(", ")}.`}
        </p>
      )}
    </section>
  );
}
