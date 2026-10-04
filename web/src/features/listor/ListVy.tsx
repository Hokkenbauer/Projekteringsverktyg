import { useMemo } from "react";
import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import type { Komponent, ListDef, ListRad, Projekt } from "../../lib/typer";
import { skrivUt } from "../../lib/utskrift";

/** En rad som tabellen visar: id + ett textvärde per kolumn. */
export type VisadRad = Record<string, string> & { id: string };

/** Om en komponent hör till listan (samma regel som serverns Listdefinitioner.Omfattar). */
export const omfattar = (def: ListDef, komponenttyp: string) =>
  !def.komponenttypInnehaller || def.komponenttypInnehaller.every((o) => komponenttyp.toLowerCase().includes(o.toLowerCase()));

/** Bygger tabellens rader. Kopplade listor får en rad per komponent; komponentens fält läses direkt från komponenten. */
export function byggRader(def: ListDef, rader: ListRad[], komponenter: Komponent[]): VisadRad[] {
  const fyll = (data: Record<string, string>, k: Komponent | null, nr: number) => {
    const ut: Record<string, string> = {};
    for (const kol of def.kolumner) {
      if (kol.typ === "komponent" && kol.komponentFalt) {
        const v = k ? String(k[kol.komponentFalt] ?? "") : "";
        ut[kol.nyckel] = def.bindestreck ? v.replace(/_/g, "-") : v;
      }
      else if (kol.typ === "lopnr") ut[kol.nyckel] = String(nr);
      else ut[kol.nyckel] = data[kol.nyckel] ?? kol.standard ?? "";
    }
    return ut;
  };

  if (def.kopplad) {
    const perKomponent = new Map(rader.filter((r) => r.komponentId).map((r) => [r.komponentId!, r]));
    return komponenter
      .filter((k) => omfattar(def, k.komponenttyp))
      .sort((a, b) => a.system.localeCompare(b.system, "sv") || a.beteckning.localeCompare(b.beteckning, "sv", { numeric: true }))
      .map((k, i) => {
        const r = perKomponent.get(k.id) ?? null;
        return { ...fyll(r?.data ?? {}, k, i + 1), id: k.id };
      });
  }
  return [...rader]
    .sort((a, b) => a.ordning - b.ordning)
    .map((r, i) => ({ ...fyll(r.data, null, i + 1), id: r.id }));
}

type Props = {
  def: ListDef;
  grupp: string;
  rader: ListRad[] | undefined;
  komponenter: Komponent[];
  projekt: Projekt | null;
  blinkar: Blink[];
  lasläge: boolean;
  onAndra: (rad: VisadRad, falt: string, varde: string) => void;
  onNy: () => void;
  onTaBort: (ids: string[]) => void;
  onExcel: () => void;
  onFlik: (flik: string) => void;
};

export function ListVy({ def, grupp, rader, komponenter, projekt, blinkar, lasläge, onAndra, onNy, onTaBort, onExcel, onFlik }: Props) {
  const visade = useMemo(() => byggRader(def, rader ?? [], komponenter), [def, rader, komponenter]);

  const kolumner: Kolumn<VisadRad>[] = useMemo(
    () => def.kolumner.map((k) => ({
      nyckel: k.nyckel,
      rubrik: k.rubrik,
      typ: k.redigerbar ? (k.typ as "text" | "val" | "kryss" | "datum") : "ro",
      val: k.val ?? undefined,
      mono: k.mono || k.typ === "lopnr",
      bredd: k.bredd ?? undefined,
      fyll: k.fyll,
    })),
    [def],
  );

  // IP-listan: samma IP-adress på flera rader markeras.
  const dubblettIp = useMemo(() => {
    if (def.id !== "iplista") return null;
    const antal = new Map<string, number>();
    for (const r of visade) {
      const ip = r.ip?.trim();
      if (ip) antal.set(ip, (antal.get(ip) ?? 0) + 1);
    }
    return antal;
  }, [def.id, visade]);

  // Signallistan: antal per signaltyp.
  const summering = useMemo(() => {
    if (def.id !== "signallista") return null;
    const antal = new Map<string, number>();
    for (const r of visade) antal.set(r.signaltyp || "Ej angiven", (antal.get(r.signaltyp || "Ej angiven") ?? 0) + 1);
    return [...antal.entries()].sort((a, b) => a[0].localeCompare(b[0], "sv"));
  }, [def.id, visade]);

  const utskrift = () => {
    const ut = def.kolumner;
    skrivUt(def.namn, projekt, {
      typ: "tabell",
      kolumner: ut.map((k) => k.rubrik),
      rader: visade.map((r) => ut.map((k) => (k.typ === "kryss" ? (r[k.nyckel] === "true" ? "✔" : "") : r[k.nyckel] ?? ""))),
      sammanfattning: summering ? summering.map(([t, n]) => `${t}: ${n}`).join("   ·   ") : undefined,
    });
  };

  const tomText = def.kopplad
    ? komponenter.length === 0
      ? "Inga komponenter i projektet än. Lägg till dem under Komponenter."
      : "Inga komponenter av den här typen i Komponenter."
    : undefined;

  return (
    <>
      <div className="brodsmula">{grupp}</div>
      <div className="rubrikrad">
        <h1>{def.namn}</h1>
        <div className="knappar">
          {def.kopplad && <button className="knapp" onClick={() => onFlik("komponenter")}>Till Komponenter</button>}
          <button className="knapp" onClick={onExcel}>Exportera till Excel</button>
          <button className="knapp" onClick={utskrift}>Skriv ut / PDF</button>
        </div>
      </div>
      <p className="ingress">{def.ingress}</p>
      {summering && summering.length > 0 && (
        <div className="summering" aria-label="Antal per signaltyp">
          <span className="chip">Totalt <b>{visade.length}</b></span>
          {summering.map(([t, n]) => <span key={t} className="chip">{t} <b>{n}</b></span>)}
        </div>
      )}
      {rader === undefined ? <p className="dampad">Hämtar…</p> : (
        <DataGrid
          rader={visade}
          kolumner={kolumner}
          sokPlatshallare={`Sök i ${def.namn.toLowerCase()}`}
          onAndra={(r, nyckel, v) => onAndra(r, nyckel, v)}
          onNy={def.kopplad ? undefined : onNy}
          onTaBort={def.kopplad ? undefined : onTaBort}
          blinkar={blinkar}
          lasläge={lasläge}
          tomText={tomText}
          cellVarning={dubblettIp ? (r, nyckel) => (nyckel === "ip" && r.ip?.trim() && (dubblettIp.get(r.ip.trim()) ?? 0) > 1 ? "IP-adressen finns på flera rader" : undefined) : undefined}
        />
      )}
    </>
  );
}
