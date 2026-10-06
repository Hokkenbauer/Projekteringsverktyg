import type { ListRad } from "../../lib/typer";

const tal = (v: string | undefined) => Number((v ?? "").replace(",", ".").trim()) || 0;
const fmt = (v: number) => v.toLocaleString("sv-SE", { maximumFractionDigits: 2 });

/** Summan per fas för kraftberäkningen. */
export function KraftSumma({ rader }: { rader: ListRad[] | undefined }) {
  const r = rader ?? [];
  const l1 = r.reduce((s, x) => s + tal(x.data.l1), 0);
  const l2 = r.reduce((s, x) => s + tal(x.data.l2), 0);
  const l3 = r.reduce((s, x) => s + tal(x.data.l3), 0);
  const max = Math.max(l1, l2, l3), min = Math.min(l1, l2, l3);
  const obalans = max > 0 ? Math.round(((max - min) / max) * 100) : 0;
  return (
    <div className="kraftsumma">
      <b>Totalt (A):</b>
      <span>L1 = <b className="mono">{fmt(l1)}</b></span>
      <span>L2 = <b className="mono">{fmt(l2)}</b></span>
      <span>L3 = <b className="mono">{fmt(l3)}</b></span>
      {max > 0 && <span className={obalans > 20 ? "varnar" : "dampad"}>Obalans mellan faserna {obalans} %</span>}
    </div>
  );
}
