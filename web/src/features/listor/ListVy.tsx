import { useMemo, type ReactNode } from "react";
import { DataGrid, type Blink, type Kolumn } from "../../grid/DataGrid";
import type { Kataloger, Komponent, ListDef, ListRad, Projekt } from "../../lib/typer";
import { skrivUt } from "../../lib/utskrift";

/** En rad som tabellen visar: id + ett textvärde per kolumn. */
export type VisadRad = Record<string, string> & { id: string };

/** Om en komponent hör till listan (samma regel som serverns Listdefinitioner.Omfattar). */
export const omfattar = (def: ListDef, komponenttyp: string) =>
  !def.komponenttypInnehaller || def.komponenttypInnehaller.every((o) => komponenttyp.toLowerCase().includes(o.toLowerCase()));

/** Första talet i en fri text ("12 st" = 12), eller null. Samma regel som servern. */
export function tal(text: string): number | null {
  const m = /-?\d+(?:[.,]\d+)?/.exec(text ?? "");
  return m ? Number(m[0].replace(",", ".")) : null;
}

/** Kolumnnyckeln i tabellens rader. "id" är upptaget av radens id, så kolumnen ID heter id_ i tabellen. */
export const vn = (n: string) => (n === "id" ? "id_" : n);

/** Bygger tabellens rader. Kopplade listor får en rad per komponent; komponentens fält läses direkt från komponenten. */
export function byggRader(def: ListDef, rader: ListRad[], komponenter: Komponent[]): VisadRad[] {
  const perId = new Map(komponenter.map((k) => [k.id, k]));
  const fyll = (data: Record<string, string>, k: Komponent | null, nr: number) => {
    const ut: Record<string, string> = {};
    for (const kol of def.kolumner) {
      if (kol.typ === "komponent" && kol.komponentFalt) {
        const v = k ? String(k[kol.komponentFalt] ?? "") : "";
        ut[vn(kol.nyckel)] = def.bindestreck ? v.replace(/_/g, "-") : v;
      }
      else if (kol.typ === "lopnr") ut[vn(kol.nyckel)] = String(nr);
      else if (kol.typ === "produkt") {
        const varden = (kol.faktorer ?? []).map((f) => (data[f] ?? "").trim());
        const talen = varden.map((v) => Number(v.replace(",", ".")));
        ut[vn(kol.nyckel)] = varden.length && varden.every((v) => v !== "") && talen.every((t) => !Number.isNaN(t))
          ? String(talen.reduce((x, y) => x * y, 1)) : "";
      }
      else if (kol.typ === "antal" && kol.komponentFalt && kol.faktorer?.[0]) {
        const v = (data[kol.faktorer[0]] ?? "").trim().toLowerCase();
        const falt = kol.komponentFalt;
        ut[vn(kol.nyckel)] = v ? String(komponenter.filter((x) => String(x[falt] ?? "").trim().toLowerCase() === v).length) : "";
      }
      else if (kol.typ === "koppling") {
        const v = data[kol.nyckel] ?? "";
        ut[vn(kol.nyckel)] = perId.get(v)?.beteckning ?? v;
      }
      else if (kol.typ === "fran" && kol.komponentFalt && kol.faktorer?.[0]) {
        const kp = perId.get(data[kol.faktorer[0]] ?? "");
        ut[vn(kol.nyckel)] = kp ? String(kp[kol.komponentFalt] ?? "") : "";
      }
      else if (kol.typ === "differens" && kol.faktorer?.length === 2) {
        const hamta = (n: string) => ut[vn(n)] ?? data[n] ?? "";
        const a = tal(hamta(kol.faktorer[0]!)), b = tal(hamta(kol.faktorer[1]!));
        ut[vn(kol.nyckel)] = a !== null && b !== null ? String(a - b) : "";
      }
      else ut[vn(kol.nyckel)] = data[kol.nyckel] ?? kol.standard ?? "";
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
  /** Inbäddad i en annan vy (t.ex. Kontroller): mindre rubrik, ingen brödsmula. */
  inbaddad?: boolean;
  /** Dölj listans egen utskriftsknapp (när vyn runt omkring har en egen). */
  utanUtskrift?: boolean;
  /** Komponentinformation (bara listor som följer Komponenter). */
  onInfo?: (komponentId: string) => void;
  fokusId?: string | null;
  /** Förslagslistor till textkolumner med forslag. */
  kataloger?: Kataloger;
  /** Förslag per kolumn som vyn runt omkring vet om (t.ex. gateways till Modbus). */
  forslagExtra?: Record<string, string[]>;
  /** Extra knappar i rubrikraden (t.ex. Importera). */
  extraKnappar?: ReactNode;
};

export function ListVy({ def, grupp, rader, komponenter, projekt, blinkar, lasläge, onAndra, onNy, onTaBort, onExcel, onFlik, inbaddad, utanUtskrift, onInfo, fokusId, kataloger, forslagExtra, extraKnappar }: Props) {
  const visade = useMemo(() => byggRader(def, rader ?? [], komponenter), [def, rader, komponenter]);

  const kopplingsForslag = (signaltyp: string | null | undefined) => komponenter
    .filter((k) => !signaltyp || k.signaltyp.toLowerCase().includes(signaltyp.toLowerCase()))
    .map((k) => k.beteckning).filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "sv", { numeric: true }));

  /** Kopplingskolumner sparar komponentens Id när texten är en komponents beteckning. */
  const andra = (r: VisadRad, visadNyckel: string, varde: string) => {
    const nyckel = visadNyckel === "id_" ? "id" : visadNyckel;
    const kol = def.kolumner.find((k) => k.nyckel === nyckel);
    if (kol?.typ === "koppling") {
      const t = varde.trim().toLowerCase();
      const kp = t ? komponenter.find((k) => k.beteckning.trim().toLowerCase() === t) : undefined;
      onAndra(r, nyckel, kp ? kp.id : varde);
      return;
    }
    onAndra(r, nyckel, varde);
  };

  const kolumner: Kolumn<VisadRad>[] = useMemo(
    () => def.kolumner.map((k) => ({
      nyckel: vn(k.nyckel),
      rubrik: k.rubrik,
      typ: k.redigerbar ? (k.typ as "text" | "val" | "kryss" | "datum") : "ro",
      val: k.val ?? undefined,
      mono: k.mono || k.typ === "lopnr",
      bredd: k.bredd ?? undefined,
      fyll: k.fyll,
      forslag: forslagExtra?.[k.nyckel]
        ?? (k.typ === "koppling" ? kopplingsForslag(k.kopplingSignaltyp) : k.forslag ? kataloger?.[k.forslag] : undefined),
    })),
    [def, kataloger, forslagExtra, komponenter],
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

  // Modbus: samma ID på samma slinga, och fler än 32 enheter per slinga.
  const modbusKontroll = useMemo(() => {
    if (def.id !== "modbus") return null;
    const perSlinga = new Map<string, number>();
    const idPerSlinga = new Map<string, number>();
    for (const r of visade) {
      const s = r.slinga?.trim().toLowerCase();
      if (!s) continue;
      perSlinga.set(s, (perSlinga.get(s) ?? 0) + 1);
      const id = r.id_?.trim();
      if (id) idPerSlinga.set(`${s}|${id}`, (idPerSlinga.get(`${s}|${id}`) ?? 0) + 1);
    }
    return { perSlinga, idPerSlinga };
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
      rader: visade.map((r) => ut.map((k) => (k.typ === "kryss" ? (r[vn(k.nyckel)] === "true" ? "✔" : "") : r[vn(k.nyckel)] ?? ""))),
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
      {!inbaddad && <div className="brodsmula">{grupp}</div>}
      <div className="rubrikrad">
        {inbaddad ? <h2>{def.namn}</h2> : <h1>{def.namn}</h1>}
        <div className="knappar">
          {extraKnappar}
          {def.kopplad && <button className="knapp" onClick={() => onFlik("komponenter")}>Till Komponenter</button>}
          <button className="knapp" onClick={onExcel}>Exportera till Excel</button>
          {!utanUtskrift && <button className="knapp" onClick={utskrift}>Skriv ut / PDF</button>}
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
          onAndra={(r, nyckel, v) => andra(r, nyckel, v)}
          onNy={def.kopplad ? undefined : onNy}
          onTaBort={def.kopplad ? undefined : onTaBort}
          blinkar={blinkar}
          lasläge={lasläge}
          tomText={tomText}
          onInfo={def.kopplad && onInfo ? (r) => onInfo(r.id) : undefined}
          fokusId={fokusId}
          cellKlass={(r, nyckel) => {
            const kol = def.kolumner.find((k) => vn(k.nyckel) === nyckel);
            if (kol?.typ === "differens") {
              // Kalkylmängder: fler komponenter än kalkylerat är det man vill upptäcka.
              const d = tal(r[nyckel] ?? "");
              return d === null ? undefined : d > 0 ? "risk-hog" : d === 0 ? "risk-lag" : undefined;
            }
            if (kol?.typ !== "produkt" || !def.id.startsWith("risk-")) return undefined;
            const v = Number(r[nyckel]);
            return !r[nyckel] ? undefined : v >= 6 ? "risk-hog" : v >= 3 ? "risk-medel" : "risk-lag";
          }}
          cellVarning={dubblettIp ? (r, nyckel) => (nyckel === "ip" && r.ip?.trim() && (dubblettIp.get(r.ip.trim()) ?? 0) > 1 ? "IP-adressen finns på flera rader" : undefined)
            : modbusKontroll ? (r, nyckel) => {
              const s = r.slinga?.trim().toLowerCase();
              if (!s) return undefined;
              if (nyckel === "id_" && r.id_?.trim() && (modbusKontroll.idPerSlinga.get(`${s}|${r.id_.trim()}`) ?? 0) > 1) return "Samma ID finns två gånger på slingan";
              if (nyckel === "slinga" && (modbusKontroll.perSlinga.get(s) ?? 0) > 32) return "Fler än 32 enheter på slingan";
              return undefined;
            } : undefined}
        />
      )}
    </>
  );
}
