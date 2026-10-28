import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFordrojdSparning } from "../../lib/sparning";
import type { Kataloger, Komponent, ListRad } from "../../lib/typer";
import {
  Anslutningar, GATEWAYTYPER, GATEWAY_KOMPONENTTYP, arGateway, gatewaytyp, installning, lasGateway, nastaGatewayBeteckning,
  nyGateway, nyPort, okandaGateways, portNamn, protokoll, type GatewayInstallningar,
} from "../../lib/gateway";

const BAUD = ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"];
const PARITET = ["None", "Even", "Odd"];
const STOPBIT = ["1", "2"];

/** Enheter på en port: komponenter vars kedja når porten och som har en Modbus RTU-punkt (eller saknar I/O). */
function enheterPaPort(a: Anslutningar, namn: string) {
  return a.komponenter.filter((k) => !arGateway(k) && a.kedja(k).port?.namn.toLowerCase() === namn.toLowerCase()
    && (protokoll(k).includes("RTU") || k.signaler.length === 0));
}

type RedigerareProps = {
  gateway: Komponent;
  anslutningar: Anslutningar;
  /** Modbus-listans rader (för slavadress per enhet). */
  modbus: ListRad[] | undefined;
  lasläge: boolean;
  onAndra: (k: Komponent, falt: keyof Komponent & string, varde: string) => void;
  /** Visa enheterna per port. */
  visaEnheter?: boolean;
  onInfo?: (id: string) => void;
};

/**
 * Gatewayens inställningar: typ, IP och portar (slingor) med TCP-port och kommunikationsinställning.
 * Sparas i komponentens inställningar. Används i fliken Modbus RTU och i Komponentinformation.
 */
export function GatewayRedigerare({ gateway, anslutningar, modbus, lasläge, onAndra, visaEnheter, onInfo }: RedigerareProps) {
  const [inst, setInst] = useState<GatewayInstallningar>(() => lasGateway(gateway));
  const sparning = useFordrojdSparning();
  const andrad = useRef(false);
  const senaste = useRef(gateway);
  senaste.current = gateway;
  useEffect(() => { if (!andrad.current) setInst(lasGateway(gateway)); }, [gateway.installningar]);
  
  const spara = (ny: GatewayInstallningar) => {
    setInst(ny);
    andrad.current = true;
    sparning.planera(() => {
      andrad.current = false;
      onAndra(senaste.current, "installningar", JSON.stringify(ny));
    }, 600);
  };
  const port = (i: number, falt: keyof GatewayInstallningar["portar"][number], v: string) =>
    spara({ ...inst, portar: inst.portar.map((p, j) => (j === i ? { ...p, [falt]: v } : p)) });

  const idFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of modbus ?? []) if (r.data.beteckning) m.set(r.data.beteckning, r.data.id ?? "");
    return m;
  }, [modbus]);

  const typ = gatewaytyp(inst.typ);
  const val = (v: string, lista: string[], onChange: (v: string) => void, etikett: string) => (
    <select value={v} disabled={lasläge} aria-label={etikett} onChange={(e) => onChange(e.target.value)}>
      {!lista.includes(v) && <option value={v}>{v || "–"}</option>}
      {lista.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );

  return (
    <div className="gw-redigerare">
      <div className="gw-falt">
        <label><span>Gatewaytyp</span>
          <select value={inst.typ} disabled={lasläge} onChange={(e) => spara({ ...inst, typ: e.target.value })}>
            {GATEWAYTYPER.map((t) => <option key={t.kod} value={t.kod}>{t.kod} – {t.namn}</option>)}
          </select>
        </label>
        <label title="Samma IP-adress som i IP-listan (Driftsättning), där gatewayen finns som egen rad"><span>IP-adress</span>
          <input value={inst.ip} readOnly={lasläge} placeholder="192.168.0.10" onChange={(e) => spara({ ...inst, ip: e.target.value })} />
        </label>
      </div>
      <table className="formtabell gw-portar">
        <thead><tr><th>Port</th><th>TCP-port</th><th>Baudrate</th><th>Paritet</th><th>Databitar</th><th>Stopbit</th><th>Enheter</th>{!lasläge && <th />}</tr></thead>
        <tbody>
          {inst.portar.map((p, i) => {
            const namn = portNamn(gateway, p);
            const enheter = enheterPaPort(anslutningar, namn);
            const ider = enheter.map((k) => (idFor.get(k.id) ?? "").trim()).filter(Boolean);
            const dubbla = [...new Set(ider.filter((x, j) => ider.indexOf(x) !== j))];
            return (
              <tr key={i}>
                <td><input value={p.namn} readOnly={lasläge} aria-label="Portens namn" className="mono" onChange={(e) => port(i, "namn", e.target.value)} title={`Ansluts till: ${namn}`} /></td>
                <td><input value={p.tcpPort} readOnly={lasläge} aria-label="TCP-port" className="mono" onChange={(e) => port(i, "tcpPort", e.target.value)} /></td>
                <td>{val(p.baudrate, BAUD, (v) => port(i, "baudrate", v), "Baudrate")}</td>
                <td>{val(p.paritet, PARITET, (v) => port(i, "paritet", v), "Paritet")}</td>
                <td>{val(p.databitar, ["7", "8"], (v) => port(i, "databitar", v), "Databitar")}</td>
                <td>{val(p.stopbit, STOPBIT, (v) => port(i, "stopbit", v), "Stopbit")}</td>
                <td className={enheter.length > typ.maxPerPort || dubbla.length ? "gw-fel" : ""}>
                  <span className="mono">{enheter.length} / {typ.maxPerPort}</span>
                  {dubbla.length > 0 && <small> · slavadress {dubbla.join(", ")} dubbla</small>}
                  <small className="dampad"> · {installning(p)}</small>
                </td>
                {!lasläge && (
                  <td>
                    <button className="knapp liten" title="Ta bort porten" disabled={inst.portar.length === 1}
                      onClick={() => { if (!enheter.length || window.confirm(`${enheter.length} enheter är anslutna till ${namn}. Ta bort porten ändå?`)) spara({ ...inst, portar: inst.portar.filter((_, j) => j !== i) }); }}>✕</button>
                  </td>
                )}
              </tr>
            );
          })}
          {!lasläge && (
            <tr><td colSpan={8}>
              <button className="knapp" onClick={() => spara({ ...inst, portar: [...inst.portar, nyPort(inst.portar.length + 1, inst.portar.at(-1))] })}>+ Lägg till port</button>
            </td></tr>
          )}
        </tbody>
      </table>
      {visaEnheter && inst.portar.map((p, i) => {
        const namn = portNamn(gateway, p);
        const enheter = enheterPaPort(anslutningar, namn);
        if (!enheter.length) return null;
        return (
          <details key={i} className="gw-enheter">
            <summary><span className="mono">{namn}</span> – {enheter.length} enheter</summary>
            <ul>
              {enheter.map((k) => {
                const via = anslutningar.kedja(k).steg.at(-1);
                return (
                  <li key={k.id}>
                    <button className="lank mono" onClick={() => onInfo?.(k.id)}>{k.beteckning || "(utan beteckning)"}</button>
                    <span>{k.komponenttyp}</span>
                    <span className="dampad">{via ? `via ${via.beteckning}` : "direkt"}</span>
                    <span className="mono">{idFor.get(k.id) ? `Slavadress ${idFor.get(k.id)}` : "Slavadress saknas"}</span>
                  </li>
                );
              })}
            </ul>
          </details>
        );
      })}
    </div>
  );
}

type Props = {
  grupp: string;
  rubrik: string;
  komponenter: Komponent[];
  kataloger: Kataloger;
  modbus: ListRad[] | undefined;
  lasläge: boolean;
  onAndra: (k: Komponent, falt: keyof Komponent & string, varde: string) => void;
  onSkapa: (data: Partial<Record<keyof Komponent, string>>[]) => Promise<void>;
  onInfo: (id: string) => void;
  onFlik: (flik: string) => void;
  /** Äldre fritextslingor (listan modbusrtu), visas bara om det finns några. */
  aldre?: ReactNode;
};

/** Fliken Modbus RTU: projektets gateways (komponenter) med portar och anslutna enheter. */
export function GatewayVy(p: Props) {
  const anslutningar = useMemo(() => new Anslutningar(p.komponenter), [p.komponenter]);
  const gateways = p.komponenter.filter(arGateway).sort((a, b) => a.beteckning.localeCompare(b.beteckning, "sv", { numeric: true }));
  const okanda = useMemo(() => okandaGateways(p.komponenter), [p.komponenter]);
  const [arbetar, setArbetar] = useState(false);

  const nyGw = async () => {
    const beteckning = window.prompt("Beteckning på den nya gatewayen:", nastaGatewayBeteckning("GW-MB-RTU", p.komponenter));
    if (!beteckning?.trim()) return;
    setArbetar(true);
    try {
      await p.onSkapa([{ beteckning: beteckning.trim(), komponenttyp: GATEWAY_KOMPONENTTYP, signaltyp: "Modbus TCP", installningar: JSON.stringify(nyGateway()) }]);
    } finally { setArbetar(false); }
  };

  const skapaOkanda = async () => {
    const namn = [...okanda.keys()];
    if (!window.confirm(`Skapa ${namn.length} gatewaykomponenter (${namn.join(", ")}) med de portar som används i Ansluts till?`)) return;
    setArbetar(true);
    try {
      await p.onSkapa(namn.map((n) => {
        const max = Math.max(4, ...okanda.get(n)!);
        const inst = nyGateway(max);
        return { beteckning: n, komponenttyp: GATEWAY_KOMPONENTTYP, signaltyp: "Modbus TCP", installningar: JSON.stringify(inst) };
      }));
    } finally { setArbetar(false); }
  };

  const utanGateway = p.komponenter.filter((k) => protokoll(k).includes("RTU") && !arGateway(k) && !anslutningar.kedja(k).port).length;

  return (
    <>
      <div className="brodsmula">{p.grupp}</div>
      <div className="rubrikrad">
        <h1>{p.rubrik}</h1>
        <div className="knappar">
          {!p.lasläge && <button className="knapp primar" disabled={arbetar} onClick={() => void nyGw()}>+ Ny gateway</button>}
          <button className="knapp" onClick={() => p.onFlik("modbus")}>Till Modbus-enheterna</button>
        </div>
      </div>
      <p className="ingress">
        Gateways är komponenter (komponenttyp Gateway, t.ex. GW-MB-RTU1). Inställningarna för varje port (slinga) görs här eller i
        Komponentinformation. Enheter ansluts genom att välja porten i komponentens <b>Ansluts till</b>, t.ex. <span className="mono">GW-MB-RTU1-Port1</span>.
        Ställdon, spjäll och givare som sitter på en RC ansluts till RC:n; de räknas då till RC:ns port.
      </p>

      {okanda.size > 0 && (
        <div className="gw-tips">
          <p>
            <b>{okanda.size} gateways används i Ansluts till men finns inte som komponenter:</b>{" "}
            {[...okanda.entries()].map(([n, portar]) => `${n} (port ${[...portar].sort((a, b) => a - b).join(", ")})`).join("; ")}.
          </p>
          {!p.lasläge && <button className="knapp" disabled={arbetar} onClick={() => void skapaOkanda()}>Skapa gatewaykomponenterna</button>}
        </div>
      )}
      {utanGateway > 0 && <p className="dampad liten">{utanGateway} komponenter med Modbus RTU når ingen gateway via Ansluts till. De syns markerade i fliken Modbus.</p>}

      {gateways.length === 0 ? (
        <div className="tomruta">
          <p>Inga gateways i projektet än.</p>
          {!p.lasläge && <button className="knapp primar" disabled={arbetar} onClick={() => void nyGw()}>+ Ny gateway</button>}
        </div>
      ) : gateways.map((g) => (
        <section key={g.id} className="panel gw-kort">
          <div className="gw-huvud">
            <h2><button className="lank mono" onClick={() => p.onInfo(g.id)}>{g.beteckning || "(utan beteckning)"}</button></h2>
            <span className="dampad">{[g.produkttyp, g.placering, g.anslutsTill && `ansluten till ${g.anslutsTill}`].filter(Boolean).join(" · ") || "Ange produkt, placering och Ansluts till (skåp) i Komponenter"}</span>
          </div>
          <GatewayRedigerare gateway={g} anslutningar={anslutningar} modbus={p.modbus} lasläge={p.lasläge} onAndra={p.onAndra} visaEnheter onInfo={p.onInfo} />
        </section>
      ))}

      {p.aldre}
    </>
  );
}
