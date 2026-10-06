import { useEffect, useRef, useState } from "react";
import { api, ApiFel, hamtaBinar, skicka } from "../../lib/api";
import type { Kataloger, Komponent, ListRad, Projekt, ProjektFil } from "../../lib/typer";

type Ritning = { data: string | null; version: number; andrad: string | null; andradAv: string };

/** Funktioner som ritverktyget (i iframen) anropar. Se public/ritning/placeringsritning.html. */
type Vard = {
  redo: () => void;
  meddelande: (json: string) => void;
  spara: (data: string) => Promise<"ok" | "konflikt" | "fel" | "lasläge">;
  laddaUppPdf: (namn: string, b64: string) => Promise<string>;
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
  pvSparaNu?: () => Promise<void>;
  pvTema?: (t: Record<string, string | boolean>) => void;
  pvVisaKomponent?: (id: string) => Promise<boolean>;
};

/** Webbappens aktuella färger, så att ritverktyget får samma tema. */
function tema(): Record<string, string | boolean> {
  const st = getComputedStyle(document.documentElement);
  const v = (n: string) => st.getPropertyValue(n).trim();
  return {
    bg: v("--bg"), yta: v("--yta"), yta2: v("--yta-2"), linje: v("--linje"), text: v("--text"), dampad: v("--dampad"),
    accent: v("--accent"), accentText: v("--accent-text"), fara: v("--fara"), varning: v("--varning"), klar: v("--ok"),
    sans: v("--font"), mono: v("--font-mono"), ljust: st.colorScheme !== "dark",
  };
}

type Props = {
  projektId: string;
  projekt: Projekt | null;
  komponenter: Komponent[];
  egenkontroll: ListRad[] | undefined;
  installationslista: ListRad[] | undefined;
  kataloger: Kataloger;
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
  /** Öppna Komponentinformation för en komponent som markerats i ritningen. */
  onVisaKomponent: (id: string) => void;
};

const KOMPONENTFALT = new Set([
  "beteckning", "system", "komponenttyp", "signaltyp", "placering", "beskrivning", "ovrigt",
  "anslutsTill", "kabeltyp", "produkttyp", "produkt", "monteringsanvisning",
]);

/**
 * Placeringsritningar: SRÖ-ritverktyget från dagens program, inbäddat. Komponenterna på ritningen är
 * projektets komponenter (samma Id), så ändringar slår igenom i Komponenter, Egenkontroll och
 * Installationslista. Själva ritningen sparas på servern, PDF-bakgrunderna som projektfiler.
 */
export function PlaceringsritningVy(p: Props) {
  const ram = useRef<HTMLIFrameElement>(null);
  const [helskarm, setHelskarm] = useState(false);
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
      const r = await api<Ritning>(`/api/projekt/${p.projektId}/ritning`);
      version.current = r.version;
      v.pvTema?.(tema());
      await v.pvLaddaRitning(r.data, props.current.projekt?.namn ?? "Projekt", behallVy);
      v.pvSyncCatalogs?.(JSON.stringify(props.current.kataloger));
      synkaKomponenter();
      visaFokus();
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
      laddaUppPdf: async (namn, b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const form = new FormData();
        form.append("mapp", "Handlingar/Ritningar");
        form.append("filer", new Blob([bytes], { type: "application/pdf" }), /\.pdf$/i.test(namn) ? namn : `${namn}.pdf`);
        const svar = await api<ProjektFil[]>(`/api/projekt/${p.projektId}/filer`, { method: "POST", body: form });
        return svar[0]!.id;
      },
      hamtaPdf: (fileId) => hamtaBinar(`/api/projekt/${p.projektId}/filer/${fileId}/innehall`),
      komponenter: () => props.current.komponenter.map((k) => ({ id: k.id, beteckning: k.beteckning })),
      visaKomponent: (id) => props.current.onVisaKomponent(id),
    };
    (window as unknown as { pvRitningsVard?: Vard }).pvRitningsVard = vard;
    return () => {
      // Sparar det sista innan fliken lämnas (verktyget sparar annars varannan sekund).
      void verktyg()?.pvSparaNu?.();
      redo.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.projektId]);

  // Komponenter, egenkontroll och kabellängder speglas in i ritningen en kort stund efter en ändring.
  useEffect(() => {
    const t = window.setTimeout(synkaKomponenter, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.komponenter, p.egenkontroll, p.installationslista]);

  useEffect(() => {
    if (redo.current) verktyg()?.pvSyncCatalogs?.(JSON.stringify(p.kataloger));
  }, [p.kataloger]);

  useEffect(() => { if (p.fokusKomponent) visaFokus(); }, [p.fokusKomponent]);

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
        <button className="knapp" onClick={() => setHelskarm((h) => !h)}>{helskarm ? "Avsluta helskärm" : "Helskärm"}</button>
      </div>
      <iframe
        ref={ram} className="ritningsram" src="/ritning/placeringsritning.html" title="Placeringsritning"
        onLoad={() => { if (!redo.current) (window as unknown as { pvRitningsVard?: Vard }).pvRitningsVard?.redo(); }}
      />
    </div>
  );
}
