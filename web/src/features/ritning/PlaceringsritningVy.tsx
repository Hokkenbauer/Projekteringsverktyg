import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiFel, hamtaBinar, skicka } from "../../lib/api";
import { temaForVerktyg as tema } from "./tema";
import { Dialog } from "../../shell/Dialog";
import { registreraSparning } from "../../lib/sparning";
import type { Kataloger, Komponent, ListRad, Projekt, ProjektFil } from "../../lib/typer";

type Ritning = { data: string | null; version: number; andrad: string | null; andradAv: string };
type Historik = { id: number; version: number; sparad: string; sparadAv: string; storlek: number };

/** Funktioner som ritverktyget (i iframen) anropar. Se public/ritning/placeringsritning.html. */
type Vard = {
  redo: () => void;
  meddelande: (json: string) => void;
  spara: (data: string) => Promise<"ok" | "konflikt" | "fel" | "lasläge">;
  laddaUppPdf: (namn: string, b64: string, lagerId?: string) => Promise<string>;
  hamtaPdf: (fileId: string) => Promise<ArrayBuffer>;
  komponenter: () => { id: string; beteckning: string }[];
  visaKomponent: (id: string) => void;
};

/** Funktioner som ritverktyget lägger ut och som webbappen anropar. */
type Verktyg = Window & {
  pvSync?: (json: string) => void;
  pvSyncCatalogs?: (json: string) => void;
  pvAssignId?: (localId: string, realId: string) => void;
  pvLaddaRitning?: (json: string | null, namn: string, behallVy: boolean) => Promise<void>;
  pvSparaNu?: () => Promise<"ok" | "oforandrad" | "lasläge" | "konflikt" | "fel">;
  pvOsparat?: () => string | null;
  pvMarkeraSparad?: (data: string) => void;
  pvTema?: (t: Record<string, string | boolean>) => void;
  pvVisaKomponent?: (id: string) => Promise<boolean>;
  pvVisaKommentar?: (id: string) => Promise<boolean>;
  pvSattKommentarKlar?: (id: string, klar: boolean) => boolean;
};

/**
 * Den öppna placeringsritningen (om fliken visas). Placeringskommentarer ändrar då status direkt i ritverktyget,
 * så att ändringen sparas med ritningens vanliga sparning i stället för att krocka med den.
 */
export let oppenRitning: { sattKommentarKlar: (id: string, klar: boolean) => boolean } | null = null;


type Props = {
  projektId: string;
  projekt: Projekt | null;
  komponenter: Komponent[];
  egenkontroll: ListRad[] | undefined;
  installationslista: ListRad[] | undefined;
  kataloger: Kataloger;
  /** Snabbval i Ansluts till: gatewayportar, skåp och RC:er. */
  anslutForslag: string[];
  /** Räknas upp när någon annan har sparat ritningen. */
  uppdaterad: number;
  lasläge: boolean;
  laggKomponent: (k: Komponent) => void;
  taBortKomponentLokalt: (id: string) => void;
  andraLista: (lista: "egenkontroll" | "installationslista", komponentId: string, falt: string, varde: string) => Promise<void>;
  visaMeddelande: (text: string) => void;
  /** Komponent som ska visas på ritningen (från Komponentinformation). */
  fokusKomponent: string | null;
  onFokusVisad: () => void;
  /** Kommentar som ska visas på ritningen (från Att göra → Placeringskommentarer). */
  fokusKommentar?: string | null;
  onKommentarVisad?: () => void;
  /** Öppna Komponentinformation för en komponent som markerats i ritningen. */
  onVisaKomponent: (id: string) => void;
};

/**
 * Sparning som pågår när fliken lämnas. Den görs av webbappen (inte ritverktyget, som stängs),
 * och nästa gång ritningen öppnas väntar hämtningen in den.
 */
let sparningVidStang: Promise<void> | null = null;
/** Pågående uppladdningar av PDF-bakgrunder per lager, så att samma fil inte laddas upp två gånger. */
const uppladdningar = new Map<string, Promise<string>>();

async function laddaUpp(projektId: string, namn: string, b64: string): Promise<string> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const form = new FormData();
  form.append("mapp", "Handlingar/Ritningar");
  form.append("filer", new Blob([bytes], { type: "application/pdf" }), /\.pdf$/i.test(namn) ? namn : `${namn}.pdf`);
  const svar = await api<ProjektFil[]>(`/api/projekt/${projektId}/filer`, { method: "POST", body: form });
  return svar[0]!.id;
}

type Lager = { id: string; name: string; b64?: string; fileId?: string };
type RitningsData = { buildings?: { floors?: { layers?: Lager[] }[] }[] };

/** Laddar upp bakgrunder som bara finns lokalt (b64) och byter dem mot projektfilens Id. */
async function laddaUppLokala(projektId: string, data: string): Promise<string> {
  const r = JSON.parse(data) as RitningsData;
  for (const b of r.buildings ?? []) for (const f of b.floors ?? []) for (const l of f.layers ?? []) {
    if (!l.b64 || l.fileId) { delete l.b64; continue; }
    const nyckel = `${projektId}|${l.id}`;
    let lofte = uppladdningar.get(nyckel);
    if (!lofte) { lofte = laddaUpp(projektId, l.name, l.b64); uppladdningar.set(nyckel, lofte); }
    l.fileId = await lofte;
    delete l.b64;
  }
  return JSON.stringify(r);
}

const KOMPONENTFALT = new Set([
  "beteckning", "system", "komponenttyp", "signaltyp", "placering", "beskrivning", "ovrigt",
  "anslutsTill", "kabeltyp", "produkttyp", "produkt", "monteringsanvisning", "signaler",
]);

/**
 * Placeringsritningar: SRÖ-ritverktyget från dagens program, inbäddat. Komponenterna på ritningen är
 * projektets komponenter (samma Id), så ändringar slår igenom i Komponenter, Egenkontroll och
 * Installationslista. Själva ritningen sparas på servern, PDF-bakgrunderna som projektfiler.
 */
export function PlaceringsritningVy(p: Props) {
  const ram = useRef<HTMLIFrameElement>(null);
  const [helskarm, setHelskarm] = useState(false);
  const [historik, setHistorik] = useState<Historik[] | null>(null);
  const [visaHistorik, setVisaHistorik] = useState(false);
  const [aterstaller, setAterstaller] = useState(false);
  const version = useRef(0);
  const redo = useRef(false);
  // Alltid senaste props, så att värdfunktionerna (som verktyget håller kvar) ser aktuellt läge.
  const props = useRef(p);
  props.current = p;
  const kompRef = useRef(new Map<string, Komponent>());
  kompRef.current = new Map(p.komponenter.map((k) => [k.id, k]));

  const verktyg = () => ram.current?.contentWindow as Verktyg | null | undefined;

  const synkaKomponenter = () => {
    const v = verktyg();
    if (!v?.pvSync || !redo.current) return;
    const { komponenter, egenkontroll, installationslista } = props.current;
    const ek = new Map((egenkontroll ?? []).filter((r) => r.komponentId).map((r) => [r.komponentId!, r.data]));
    const il = new Map((installationslista ?? []).filter((r) => r.komponentId).map((r) => [r.komponentId!, r.data]));
    v.pvSync(JSON.stringify(komponenter.map((k) => ({
      ...k,
      kontrollerad: ek.get(k.id)?.kontrollerad === "true",
      kabelLangdMeter: il.get(k.id)?.langd ?? "",
    }))));
  };

  const hamtaOchLadda = async (behallVy: boolean) => {
    const v = verktyg();
    if (!v?.pvLaddaRitning) return;
    try {
      if (sparningVidStang) await sparningVidStang;
      const r = await api<Ritning>(`/api/projekt/${p.projektId}/ritning`);
      version.current = r.version;
      v.pvTema?.(tema());
      await v.pvLaddaRitning(r.data, props.current.projekt?.namn ?? "Projekt", behallVy);
      v.pvSyncCatalogs?.(JSON.stringify({ ...props.current.kataloger, anslutsTill: props.current.anslutForslag }));
      synkaKomponenter();
      visaFokus();
      visaKommentar();
    } catch (e) {
      props.current.visaMeddelande(`Ritningen kunde inte hämtas: ${(e as Error).message}`);
    }
  };

  /** Markerar och centrerar komponenten som Komponentinformation bad om. */
  const visaFokus = () => {
    const id = props.current.fokusKomponent;
    const v = verktyg();
    if (!id || !v?.pvVisaKomponent || !redo.current) return;
    // pvSync lägger till nya komponenter en kort stund efter laddningen.
    window.setTimeout(async () => {
      const hittad = await verktyg()?.pvVisaKomponent?.(id);
      if (!hittad) props.current.visaMeddelande("Komponenten finns inte på ritningen än. Den ligger under Att placera.");
      props.current.onFokusVisad();
    }, 400);
  };

  useEffect(() => {
    const o = { sattKommentarKlar: (id: string, klar: boolean) => !!(redo.current && verktyg()?.pvSattKommentarKlar?.(id, klar)) };
    oppenRitning = o;
    return () => { if (oppenRitning === o) oppenRitning = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Öppnar planet med kommentaren som Placeringskommentarer bad om, och centrerar den. */
  const visaKommentar = () => {
    const id = props.current.fokusKommentar;
    if (!id || !verktyg()?.pvVisaKommentar || !redo.current) return;
    window.setTimeout(async () => {
      const hittad = await verktyg()?.pvVisaKommentar?.(id);
      if (!hittad) props.current.visaMeddelande("Kommentaren finns inte längre på ritningen.");
      props.current.onKommentarVisad?.();
    }, 300);
  };

  /** Ändrar fält på en komponent ett i taget, med senaste versionen varje gång. */
  const andraKomponent = async (id: string, falt: Record<string, string>) => {
    let k = kompRef.current.get(id);
    if (!k) return;
    for (const [nyckel, varde] of Object.entries(falt)) {
      if ((k as Record<string, unknown>)[nyckel] === varde) continue;
      try {
        k = await api<Komponent>(`/api/projekt/${p.projektId}/komponenter/${id}`, {
          method: "PATCH", body: skicka({ falt: nyckel, varde, version: k.version }),
        });
        props.current.laggKomponent(k);
        kompRef.current.set(id, k);
      } catch (e) {
        props.current.visaMeddelande(e instanceof ApiFel && e.status === 409
          ? "Någon annan ändrade komponenten samtidigt. Ritningen är uppdaterad, gör om ändringen."
          : `Ändringen kunde inte sparas: ${(e as Error).message}`);
        synkaKomponenter();
        return;
      }
    }
  };

  const hanteraMeddelande = async (json: string) => {
    let m: Record<string, unknown>;
    try { m = JSON.parse(json); } catch { return; }
    const { lasläge, visaMeddelande } = props.current;
    if (m.type === "requestSync") { synkaKomponenter(); return; }
    if (lasläge) { visaMeddelande("Du har bara läsbehörighet. Ändringen sparas inte."); synkaKomponenter(); return; }

    if (m.type === "createComponent") {
      try {
        const k = await api<Komponent>(`/api/projekt/${p.projektId}/komponenter`, {
          method: "POST", body: skicka({ beteckning: m.beteckning ?? "", komponenttyp: m.komponenttyp ?? "" }),
        });
        props.current.laggKomponent(k);
        kompRef.current.set(k.id, k);
        verktyg()?.pvAssignId?.(String(m.localId), k.id);
      } catch (e) {
        visaMeddelande(`Komponenten kunde inte skapas: ${(e as Error).message}`);
      }
      return;
    }
    const id = String(m.pvId ?? "");
    if (!id) return;
    if (m.type === "deleteComponent") {
      try {
        await api(`/api/projekt/${p.projektId}/komponenter/${id}`, { method: "DELETE" });
        props.current.taBortKomponentLokalt(id);
      } catch (e) {
        visaMeddelande(`Komponenten kunde inte tas bort: ${(e as Error).message}`);
      }
      return;
    }
    if (m.type === "fieldUpdate") {
      const falt: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) if (KOMPONENTFALT.has(k)) falt[k] = String(v ?? "");
      if (Object.keys(falt).length) await andraKomponent(id, falt);
      if (typeof m.kontrollerad === "boolean")
        await props.current.andraLista("egenkontroll", id, "kontrollerad", String(m.kontrollerad));
      if (m.kabelLangdMeter !== undefined)
        await props.current.andraLista("installationslista", id, "langd", String(m.kabelLangdMeter ?? ""));
    }
  };

  // Värdfunktionerna läggs ut innan iframen laddas.
  useEffect(() => {
    const vard: Vard = {
      redo: () => { redo.current = true; void hamtaOchLadda(false); },
      meddelande: (json) => { void hanteraMeddelande(json); },
      spara: async (data) => {
        if (props.current.lasläge) return "lasläge";
        try {
          const r = await api<Ritning>(`/api/projekt/${p.projektId}/ritning`, {
            method: "PUT", body: skicka({ data, version: version.current }),
          });
          version.current = r.version;
          return "ok";
        } catch (e) {
          if (e instanceof ApiFel && e.status === 409) {
            props.current.visaMeddelande("Någon annan sparade ritningen samtidigt. Deras version visas nu; gör om din senaste ändring.");
            void hamtaOchLadda(true);
            return "konflikt";
          }
          return "fel";
        }
      },
      laddaUppPdf: (namn, b64, lagerId) => {
        const nyckel = lagerId ? `${p.projektId}|${lagerId}` : "";
        const pagar = nyckel ? uppladdningar.get(nyckel) : undefined;
        if (pagar) return pagar;
        const lofte = laddaUpp(p.projektId, namn, b64);
        if (nyckel) uppladdningar.set(nyckel, lofte);
        lofte.catch(() => uppladdningar.delete(nyckel));
        return lofte;
      },
      hamtaPdf: (fileId) => hamtaBinar(`/api/projekt/${p.projektId}/filer/${fileId}/innehall`),
      komponenter: () => props.current.komponenter.map((k) => ({ id: k.id, beteckning: k.beteckning })),
      visaKomponent: (id) => props.current.onVisaKomponent(id),
    };
    (window as unknown as { pvRitningsVard?: Vard }).pvRitningsVard = vard;
    return () => { redo.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.projektId]);

  // När fliken lämnas: spara det som inte hunnit sparas. Görs innan ritverktyget tas bort (därför layout-effekt),
  // och själva sparningen körs här i webbappen, eftersom ritverktyget stängs.
  useLayoutEffect(() => () => {
    const data = verktyg()?.pvOsparat?.();
    if (!data || props.current.lasläge) return;
    const { projektId, visaMeddelande } = props.current;
    const url = `/api/projekt/${projektId}/ritning`;
    const fore = version.current;
    let klar = "";
    const putta = (v: number) => api<Ritning>(url, { method: "PUT", body: skicka({ data: klar, version: v }) });
    sparningVidStang = laddaUppLokala(projektId, data).then((d) => { klar = d; return putta(fore); }).then(() => undefined).catch(async (e) => {
      // En automatisk sparning kan ha hunnit gå iväg precis innan. Då är servern ett steg före, och det är vår egen.
      if (e instanceof ApiFel && e.status === 409) {
        const nu = await api<Ritning>(url);
        if (nu.data === klar) return;
        if (nu.version === fore + 1) { await putta(nu.version); return; }
      }
      throw e;
    }).catch((e) => {
      visaMeddelande(e instanceof ApiFel && e.status === 409
        ? "Din sista ändring i ritningen kunde inte sparas: någon annan sparade samtidigt."
        : `Din sista ändring i ritningen kunde inte sparas: ${(e as Error).message}`);
    }).finally(() => { sparningVidStang = null; });
    registreraSparning(sparningVidStang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sparaNu = async () => {
    const svar = await verktyg()?.pvSparaNu?.();
    p.visaMeddelande(
      svar === "ok" ? "Ritningen är sparad."
        : svar === "oforandrad" ? "Allt är redan sparat."
        : svar === "lasläge" ? "Du har bara läsbehörighet."
        : svar === "konflikt" ? "Någon annan sparade samtidigt. Deras version visas nu; gör om din senaste ändring."
        : "Ritningen kunde inte sparas. Försök igen.");
  };

  // Komponenter, egenkontroll och kabellängder speglas in i ritningen en kort stund efter en ändring.
  useEffect(() => {
    const t = window.setTimeout(synkaKomponenter, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.komponenter, p.egenkontroll, p.installationslista]);

  useEffect(() => {
    if (redo.current) verktyg()?.pvSyncCatalogs?.(JSON.stringify({ ...p.kataloger, anslutsTill: p.anslutForslag }));
  }, [p.kataloger, p.anslutForslag.join("|")]);

  useEffect(() => { if (p.fokusKomponent) visaFokus(); }, [p.fokusKomponent]);
  useEffect(() => { if (p.fokusKommentar) visaKommentar(); }, [p.fokusKommentar]);

  // Ritverktyget följer webbappens färgtema, även när temat byts.
  useEffect(() => {
    const skicka = () => { if (redo.current) verktyg()?.pvTema?.(tema()); };
    const obs = new MutationObserver(skicka);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", skicka);
    return () => { obs.disconnect(); mq.removeEventListener("change", skicka); };
  }, []);

  // Någon annan har sparat: hämta deras version.
  useEffect(() => {
    if (p.uppdaterad > 0 && redo.current) void hamtaOchLadda(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.uppdaterad]);

  const oppnaHistorik = async () => {
    setVisaHistorik(true); setHistorik(null);
    // Det senaste sparas först, så att det också finns i historiken.
    await verktyg()?.pvSparaNu?.();
    try { setHistorik(await api<Historik[]>(`/api/projekt/${p.projektId}/ritning/historik`)); }
    catch (e) { p.visaMeddelande(`Historiken kunde inte hämtas: ${(e as Error).message}`); setVisaHistorik(false); }
  };

  const aterstall = async (h: Historik) => {
    const tid = new Date(h.sparad).toLocaleString("sv-SE");
    if (!window.confirm(`Återställa ritningen till hur den såg ut ${tid}?\n\nDen nuvarande ritningen sparas i historiken först, så det går att ångra.`)) return;
    setAterstaller(true);
    try {
      await verktyg()?.pvSparaNu?.();
      const gammal = await api<Ritning>(`/api/projekt/${p.projektId}/ritning/historik/${h.id}`);
      const nu = await api<Ritning>(`/api/projekt/${p.projektId}/ritning`);
      const r = await api<Ritning>(`/api/projekt/${p.projektId}/ritning?aterstall=true`, {
        method: "PUT", body: skicka({ data: gammal.data, version: nu.version }),
      });
      version.current = r.version;
      await hamtaOchLadda(true);
      setVisaHistorik(false);
      p.visaMeddelande(`Ritningen är återställd till ${tid}.`);
    } catch (e) {
      p.visaMeddelande(`Ritningen kunde inte återställas: ${(e as Error).message}`);
    } finally { setAterstaller(false); }
  };

  return (
    <div className={`ritningsyta ${helskarm ? "helskarm" : ""}`}>
      <div className="ritningshuvud">
        <h1>Placeringsritningar</h1>
        <span
          className="hjalp" tabIndex={0}
          title={"Komponenterna på ritningen är projektets komponenter. Ändringar sparas automatiskt och syns i Komponenter, Egenkontroll och Installationslista. PDF-bakgrunder sparas under Projektfiler → Handlingar/Ritningar. Dra komponenter från Att placera till planen."}
        >?</span>
        {p.lasläge && <span className="dampad">Endast läsning</span>}
        <span className="grow" />
        {!p.lasläge && <button className="knapp primar" onClick={() => void sparaNu()} title="Spara ritningen nu (Ctrl+S). Den sparas annars automatiskt varannan sekund.">Spara</button>}
        <button className="knapp" onClick={() => void oppnaHistorik()} title="Tidigare versioner av ritningen">Historik</button>
        <button className="knapp" onClick={() => setHelskarm((h) => !h)}>{helskarm ? "Avsluta helskärm" : "Helskärm"}</button>
      </div>
      <iframe
        ref={ram} className="ritningsram" src={`/ritning/placeringsritning.html?v=${__BYGGE__}`} title="Placeringsritning"
        onLoad={() => { if (!redo.current) (window as unknown as { pvRitningsVard?: Vard }).pvRitningsVard?.redo(); }}
      />
      <Dialog titel="Ritningens historik" oppen={visaHistorik} onStang={() => { if (!aterstaller) setVisaHistorik(false); }}
        fot={<button className="knapp" disabled={aterstaller} onClick={() => setVisaHistorik(false)}>Stäng</button>}>
        <p className="dampad liten">
          En kopia sparas automatiskt högst var tionde minut medan någon arbetar. Allt från de senaste två dygnen finns kvar,
          sedan en per dag i 30 dagar. Återställ lägger tillbaka hela ritningen: byggnader, plan, rum, placeringar och kablar.
        </p>
        {historik === null ? <p className="dampad">Hämtar…</p>
          : historik.length === 0 ? <p className="dampad">Ingen historik än. Den första kopian sparas vid nästa ändring.</p>
          : (
            <table className="formtabell">
              <thead><tr><th>Sparad</th><th>Av</th><th>Storlek</th><th /></tr></thead>
              <tbody>
                {historik.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.sparad).toLocaleString("sv-SE")}</td>
                    <td>{h.sparadAv}</td>
                    <td className="dampad">{Math.max(1, Math.round(h.storlek / 1024))} kB</td>
                    <td>{!p.lasläge && <button className="knapp liten" disabled={aterstaller} onClick={() => void aterstall(h)}>Återställ</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Dialog>
    </div>
  );
}
