import { useCallback, useEffect, useRef, useState } from "react";
import type { Blink } from "../../grid/DataGrid";
import { api, ApiFel, laddaNer, skicka } from "../../lib/api";
import { anslutTillProjekt } from "../../lib/synk";
import type { Anteckningar, AttGora, Kataloger, Skap, Komponent, KomponentHandelse, ListaHandelse, ListDef, ListRad, Logg, Mig, Narvarande, Projekt } from "../../lib/typer";
import { skrivUt } from "../../lib/utskrift";
import { NAVIGERING, hittaFlik } from "../../shell/navigering";
import { AnteckningarVy } from "../att-gora/AnteckningarVy";
import { AttGoraVy } from "../att-gora/AttGoraVy";
import { ProjektfilerVy } from "../filer/ProjektfilerVy";
import { ListVy, type VisadRad } from "../listor/ListVy";
import { PlaceringsritningVy } from "../ritning/PlaceringsritningVy";
import { RitbordVy } from "../ritning/RitbordVy";
import { ApparatskapVy } from "../konstruktion/ApparatskapVy";
import { KraftSumma } from "../konstruktion/KraftSumma";
import { ModulbelaggningVy } from "../konstruktion/ModulbelaggningVy";
import { SkapValjare } from "../konstruktion/SkapValjare";
import { KomponenterVy } from "../komponenter/KomponenterVy";
import { KomponentInfo } from "../komponenter/KomponentInfo";
import { KontrollerVy, type Kontroll } from "../kontroller/KontrollerVy";
import { RiskVy } from "../risk/RiskVy";
import { ProjektStatusVy } from "../status/ProjektStatusVy";
import { MedlemmarVy } from "./MedlemmarVy";
import { LoggVy, Oversikt } from "./Oversikt";

const FARGER = ["#2B6CB0", "#B7791F", "#2F855A", "#9B2C6E", "#6B46C1", "#C05621", "#2C7A7B"];
export const fargFor = (id: string) => FARGER[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % FARGER.length];
export const initialer = (namn: string) =>
  namn.split(/\s+/).filter(Boolean).slice(0, 2).map((d) => d[0]!.toUpperCase()).join("") || "?";

type Props = {
  projektId: string;
  flik: string;
  mig: Mig;
  hamtaToken: () => Promise<string>;
  onFlik: (flik: string) => void;
  onTillbaka: () => void;
  visaMeddelande: (text: string) => void;
};

export function Arbetsyta({ projektId, flik, mig, hamtaToken, onFlik, onTillbaka, visaMeddelande }: Props) {
  const [projekt, setProjekt] = useState<Projekt | null>(null);
  const [komponenter, setKomponenter] = useState<Komponent[]>([]);
  const [logg, setLogg] = useState<Logg[]>([]);
  const [loggVersion, setLoggVersion] = useState(0);
  const [statusVersion, setStatusVersion] = useState(0);
  const [attGora, setAttGora] = useState<AttGora[]>([]);
  const [anteckningar, setAnteckningar] = useState<Anteckningar | null>(null);
  const [listdefinitioner, setListdefinitioner] = useState<ListDef[]>([]);
  const [kataloger, setKataloger] = useState<Kataloger>({});
  const [listor, setListor] = useState<Record<string, ListRad[]>>({});
  const [texter, setTexter] = useState<Record<string, Anteckningar>>({});
  const [filVersion, setFilVersion] = useState(0);
  const [ritningVersion, setRitningVersion] = useState(0);
  const [kontrollVersion, setKontrollVersion] = useState(0);
  const [ritbordVersion, setRitbordVersion] = useState(0);
  const [skapLista, setSkapLista] = useState<Skap[] | null>(null);
  const [valtSkap, setValtSkap] = useState<string | null>(null);
  const [infoId, setInfoId] = useState<string | null>(null);
  const [fokus, setFokus] = useState<{ flik: string; id: string } | null>(null);
  const [ritningFokus, setRitningFokus] = useState<string | null>(null);
  const [valdKontroll, setValdKontroll] = useState<Record<string, Kontroll | null>>({});
  // Vilka listor och texter som är hämtade, så att livesynken vet vad som ska uppdateras.
  const hamtadeListor = useRef<Set<string>>(new Set());
  const hamtadeTexter = useRef<Set<string>>(new Set());
  const [narvaro, setNarvaro] = useState<Narvarande[]>([]);
  const [status, setStatus] = useState<"ansluten" | "ateransluter" | "frankopplad">("ateransluter");
  const [blinkar, setBlinkar] = useState<Blink[]>([]);
  const [fel, setFel] = useState<string | null>(null);
  const listorRef = useRef(listor);
  listorRef.current = listor;
  const [oppnaGrupper, setOppnaGrupper] = useState<Set<string>>(
    () => new Set(["Projekt", "Status", hittaFlik(flik)?.grupp.namn ?? "Komponenter & Listor"]),
  );

  const hamtaAllt = useCallback(async () => {
    try {
      const [p, k, a, t, d] = await Promise.all([
        api<Projekt>(`/api/projekt/${projektId}`),
        api<Komponent[]>(`/api/projekt/${projektId}/komponenter`),
        api<AttGora[]>(`/api/projekt/${projektId}/att-gora`),
        api<Anteckningar>(`/api/projekt/${projektId}/anteckningar`),
        api<ListDef[]>(`/api/listdefinitioner`),
      ]);
      setProjekt(p);
      setKomponenter(k);
      setAttGora(a);
      setAnteckningar(t);
      setListdefinitioner(d);
      setFel(null);
      api<Kataloger>(`/api/kataloger`).then(setKataloger).catch(() => { /* bara förslag */ });
      // Översikten visar egenkontroller och anmärkningar, så de hämtas alltid. Övriga listor hämtas när de öppnas.
      const listIds = new Set(["egenkontroll", "anmarkningar", ...hamtadeListor.current]);
      const listSvar = await Promise.all([...listIds].map(async (id) => [id, await api<ListRad[]>(`/api/projekt/${projektId}/listor/${id}`)] as const));
      setListor(Object.fromEntries(listSvar));
      listIds.forEach((id) => hamtadeListor.current.add(id));
      const textSvar = await Promise.all([...hamtadeTexter.current].map(async (n) => [n, await api<Anteckningar>(`/api/projekt/${projektId}/texter/${n}`)] as const));
      if (textSvar.length) setTexter(Object.fromEntries(textSvar));
    } catch (e) {
      setFel((e as Error).message);
    }
  }, [projektId]);

  const hamtaLogg = useCallback(async () => {
    try {
      setLogg(await api<Logg[]>(`/api/projekt/${projektId}/andringslogg?antal=20`));
      setLoggVersion((v) => v + 1);
    } catch {
      /* loggen är inte kritisk */
    }
  }, [projektId]);

  // Loggen hämtas om en kort stund efter en ändring, så att flera ändringar ger en hämtning.
  const loggTimer = useRef<number | undefined>(undefined);
  const hamtaLoggSnart = useCallback(() => {
    window.clearTimeout(loggTimer.current);
    loggTimer.current = window.setTimeout(hamtaLogg, 400);
  }, [hamtaLogg]);

  const blinka = useCallback((radId: string, nyckel: string, farg: string) => {
    const b: Blink = { radId, nyckel, farg, tid: Date.now() };
    setBlinkar((lista) => [...lista.filter((x) => !(x.radId === radId && x.nyckel === nyckel)), b]);
    window.setTimeout(() => setBlinkar((lista) => lista.filter((x) => x !== b)), 1800);
  }, []);

  const lagg = useCallback((k: Komponent) => {
    setKomponenter((lista) => {
      const i = lista.findIndex((x) => x.id === k.id);
      if (i === -1) return [...lista, k];
      if (lista[i]!.version > k.version) return lista;
      const kopia = [...lista];
      kopia[i] = k;
      return kopia;
    });
  }, []);

  const laggAttGora = useCallback((a: AttGora) => {
    setAttGora((lista) => {
      const i = lista.findIndex((x) => x.id === a.id);
      if (i === -1) return [...lista, a];
      if (lista[i]!.version > a.version) return lista;
      const kopia = [...lista];
      kopia[i] = a;
      return kopia;
    });
  }, []);

  const laggListRad = useCallback((lista: string, rad: ListRad): ListRad | null => {
    let fore: ListRad | null = null;
    setListor((alla) => {
      const nuvarande = alla[lista];
      if (!nuvarande) return alla;
      const i = nuvarande.findIndex((x) => x.id === rad.id || (rad.komponentId !== null && x.komponentId === rad.komponentId));
      if (i === -1) return { ...alla, [lista]: [...nuvarande, rad] };
      fore = nuvarande[i]!;
      if (fore.version > rad.version) return alla;
      const kopia = [...nuvarande];
      kopia[i] = rad;
      return { ...alla, [lista]: kopia };
    });
    return fore;
  }, []);

  const listaAndrad = useCallback((h: ListaHandelse) => {
    if (h.lista.startsWith("lista:")) {
      const id = h.lista.slice(6);
      if (id.startsWith("kontroll-")) setKontrollVersion((v) => v + 1);
      const rad = h.rad as ListRad;
      if (h.typ === "borttagen") setListor((alla) => (alla[id] ? { ...alla, [id]: alla[id]!.filter((x) => x.id !== rad.id) } : alla));
      else if (hamtadeListor.current.has(id)) {
        const fore = listorRef.current[id]?.find((x) => x.id === rad.id || (rad.komponentId !== null && x.komponentId === rad.komponentId));
        laggListRad(id, rad);
        if (h.avId !== mig.id) {
          const radId = rad.komponentId ?? rad.id;
          for (const nyckel of Object.keys(rad.data)) {
            if ((fore?.data[nyckel] ?? "") !== rad.data[nyckel]) blinka(radId, nyckel, fargFor(h.avId));
          }
        }
      }
    } else if (h.lista.startsWith("text:")) {
      const nyckel = h.lista.slice(5);
      if (h.avId !== mig.id) setTexter((t) => ({ ...t, [nyckel]: h.rad as Anteckningar }));
    } else if (h.lista === "kontroller") {
      if (h.avId !== mig.id) setKontrollVersion((v) => v + 1);
    } else if (h.lista === "skap") {
      void hamtaSkapRef.current();
    } else if (h.lista === "ritbord") {
      if (h.avId !== mig.id) setRitbordVersion((v) => v + 1);
    } else if (h.lista === "ritning") {
      if (h.avId !== mig.id) setRitningVersion((v) => v + 1);
    } else if (h.lista === "filer") {
      if (h.avId !== mig.id) setFilVersion((v) => v + 1);
    } else if (h.lista === "attGora") {
      const rad = h.rad as AttGora;
      if (h.typ === "borttagen") setAttGora((l) => l.filter((x) => x.id !== rad.id));
      else {
        laggAttGora(rad);
        if (h.typ === "andrad" && h.avId !== mig.id) blinka(rad.id, "text", fargFor(h.avId));
      }
    } else if (h.lista === "anteckningar" && h.avId !== mig.id) {
      setAnteckningar(h.rad as Anteckningar);
    } else if (h.lista === "projektStatus" && h.avId !== mig.id) {
      setStatusVersion((v) => v + 1);
    }
    hamtaLoggSnart();
  }, [laggAttGora, laggListRad, blinka, hamtaLoggSnart, mig.id]);

  useEffect(() => {
    void hamtaAllt();
    void hamtaLogg();
    const koppla = anslutTillProjekt(projektId, hamtaToken, {
      komponentSkapad: (h: KomponentHandelse) => { lagg(h.komponent); hamtaLoggSnart(); },
      komponentAndrad: (h: KomponentHandelse) => {
        lagg(h.komponent);
        if (h.avId !== mig.id && h.falt) blinka(h.komponent.id, h.falt, fargFor(h.avId));
        hamtaLoggSnart();
      },
      komponentBorttagen: (h: KomponentHandelse) => {
        setKomponenter((lista) => lista.filter((x) => x.id !== h.komponent.id));
        hamtaLoggSnart();
      },
      narvaro: setNarvaro,
      listaAndrad,
      ateransluten: () => { void hamtaAllt(); void hamtaLogg(); },
      status: setStatus,
    });
    return () => { koppla(); window.clearTimeout(loggTimer.current); };
  }, [projektId, hamtaToken, mig.id, hamtaAllt, hamtaLogg, hamtaLoggSnart, lagg, blinka, listaAndrad]);

  // ---- Att göra ----
  const andraAttGora = async (rad: AttGora, falt: "text" | "klar", varde: string) => {
    const fore = rad;
    laggAttGora({ ...rad, [falt]: falt === "klar" ? varde === "true" : varde });
    try {
      laggAttGora(await api<AttGora>(`/api/projekt/${projektId}/att-gora/${rad.id}`, {
        method: "PATCH", body: skicka({ falt, varde, version: rad.version }),
      }));
    } catch (e) {
      setAttGora((l) => l.map((x) => (x.id === fore.id ? fore : x)));
      visaMeddelande(e instanceof ApiFel && e.status === 409
        ? "Någon annan ändrade raden samtidigt. Gör om din ändring."
        : `Ändringen kunde inte sparas: ${(e as Error).message}`);
      if (e instanceof ApiFel && e.status === 409) void hamtaAllt();
    }
  };
  const nyAttGora = async () => {
    try {
      laggAttGora(await api<AttGora>(`/api/projekt/${projektId}/att-gora`, { method: "POST", body: skicka({ text: "" }) }));
    } catch (e) {
      visaMeddelande(`Raden kunde inte skapas: ${(e as Error).message}`);
    }
  };
  const taBortAttGora = async (ids: string[]) => {
    const res = await Promise.allSettled(ids.map((id) => api(`/api/projekt/${projektId}/att-gora/${id}`, { method: "DELETE" })));
    setAttGora((l) => l.filter((x) => !ids.includes(x.id)));
    if (res.some((r) => r.status === "rejected")) { visaMeddelande("Några rader kunde inte tas bort."); void hamtaAllt(); }
  };

  // ---- Listor från den gemensamma listmotorn ----
  const vald = hittaFlik(flik);
  const kontrollTyp = vald?.flik.kontroll;
  const aktivKontroll = kontrollTyp ? valdKontroll[kontrollTyp] ?? null : null;
  // ---- Apparatskåp (delas av Apparatskåp, Kraftberäkning och Modulbeläggning) ----
  const arSkapFlik = flik === "apparatskap" || flik === "kraftberakning" || flik === "modulbelaggning";
  const hamtaSkap = async (): Promise<Skap[]> => {
    try {
      const lista = await api<Skap[]>(`/api/projekt/${projektId}/skap`);
      setSkapLista(lista);
      setValtSkap((v) => (v && lista.some((x) => x.id === v) ? v : lista[0]?.id ?? null));
      return lista;
    } catch (e) {
      visaMeddelande(`Skåpen kunde inte hämtas: ${(e as Error).message}`);
      return [];
    }
  };
  const hamtaSkapRef = useRef(hamtaSkap);
  hamtaSkapRef.current = hamtaSkap;
  useEffect(() => { if (arSkapFlik && skapLista === null) void hamtaSkap(); }, [arSkapFlik]);
  const aktivtSkap = skapLista?.find((x) => x.id === valtSkap) ?? null;
  const uppdateraSkap = (s: Skap) => setSkapLista((l) => l?.map((x) => (x.id === s.id ? s : x)) ?? l);

  const riskVariant = vald?.flik.risk;
  const listId = vald?.flik.lista ?? (riskVariant ? `risk-${riskVariant}`
    : aktivKontroll ? `kontroll-${aktivKontroll.id}`
    : flik === "kraftberakning" && valtSkap ? `kraft-${valtSkap}` : undefined);
  const textNyckel = vald?.flik.text ?? (vald?.flik.risk ? `risk-${vald.flik.risk}` : undefined);

  // Listor som fliken behöver hämtas första gången de används. Ritningen visar egenkontroll och kabellängd.
  const behovdaListor = listId ? listId : flik === "placeringsritningar" ? "egenkontroll,installationslista" : "";
  useEffect(() => {
    for (const id of behovdaListor.split(",").filter(Boolean)) {
      if (hamtadeListor.current.has(id)) continue;
      hamtadeListor.current.add(id);
      api<ListRad[]>(`/api/projekt/${projektId}/listor/${id}`)
        .then((rader) => setListor((alla) => ({ ...alla, [id]: rader })))
        .catch((e) => { hamtadeListor.current.delete(id); visaMeddelande(`Listan kunde inte hämtas: ${(e as Error).message}`); });
    }
  }, [behovdaListor, projektId, visaMeddelande]);

  useEffect(() => {
    if (!textNyckel || hamtadeTexter.current.has(textNyckel)) return;
    hamtadeTexter.current.add(textNyckel);
    api<Anteckningar>(`/api/projekt/${projektId}/texter/${textNyckel}`)
      .then((t) => setTexter((alla) => ({ ...alla, [textNyckel]: t })))
      .catch((e) => { hamtadeTexter.current.delete(textNyckel); visaMeddelande(`Texten kunde inte hämtas: ${(e as Error).message}`); });
  }, [textNyckel, projektId, visaMeddelande]);

  const hamtaLista = async (id: string) => {
    try {
      const rader = await api<ListRad[]>(`/api/projekt/${projektId}/listor/${id}`);
      setListor((alla) => ({ ...alla, [id]: rader }));
    } catch { /* nästa ändring hämtar igen */ }
  };

  const andraLista = async (def: ListDef, visad: VisadRad, falt: string, varde: string) => {
    const rader = listor[def.id] ?? [];
    const befintlig = def.kopplad ? rader.find((r) => r.komponentId === visad.id) : rader.find((r) => r.id === visad.id);
    if (!def.kopplad && !befintlig) return;
    const url = def.kopplad
      ? `/api/projekt/${projektId}/listor/${def.id}/komponent/${visad.id}`
      : `/api/projekt/${projektId}/listor/${def.id}/${visad.id}`;
    if (befintlig) laggListRad(def.id, { ...befintlig, data: { ...befintlig.data, [falt]: varde } });
    try {
      laggListRad(def.id, await api<ListRad>(url, { method: "PATCH", body: skicka({ falt, varde, version: befintlig?.version ?? 0 }) }));
    } catch (e) {
      visaMeddelande(e instanceof ApiFel && e.status === 409
        ? "Någon annan ändrade raden samtidigt. Raden är uppdaterad, gör om din ändring."
        : `Ändringen kunde inte sparas: ${(e as Error).message}`);
      void hamtaLista(def.id);
    }
  };

  const nyListRad = async (def: ListDef) => {
    try {
      laggListRad(def.id, await api<ListRad>(`/api/projekt/${projektId}/listor/${def.id}`, { method: "POST" }));
    } catch (e) {
      visaMeddelande(`Raden kunde inte skapas: ${(e as Error).message}`);
    }
  };

  const taBortListRader = async (def: ListDef, ids: string[]) => {
    const res = await Promise.allSettled(ids.map((id) => api(`/api/projekt/${projektId}/listor/${def.id}/${id}`, { method: "DELETE" })));
    setListor((alla) => ({ ...alla, [def.id]: (alla[def.id] ?? []).filter((x) => !ids.includes(x.id)) }));
    if (res.some((r) => r.status === "rejected")) { visaMeddelande("Några rader kunde inte tas bort."); void hamtaLista(def.id); }
  };

  const sparaText = async (nyckel: string, text: string) => {
    const t = await api<Anteckningar>(`/api/projekt/${projektId}/texter/${nyckel}`, { method: "PUT", body: skicka({ text }) });
    setTexter((alla) => ({ ...alla, [nyckel]: t }));
  };

  // ---- Anteckningar ----
  const sparaAnteckningar = async (text: string) => {
    setAnteckningar(await api<Anteckningar>(`/api/projekt/${projektId}/anteckningar`, { method: "PUT", body: skicka({ text }) }));
  };

  const andra = async (k: Komponent, falt: keyof Komponent & string, varde: string) => {
    const fore = k;
    lagg({ ...k, [falt]: varde });
    try {
      const svar = await api<Komponent>(`/api/projekt/${projektId}/komponenter/${k.id}`, {
        method: "PATCH",
        body: skicka({ falt, varde, version: k.version }),
      });
      lagg(svar);
    } catch (e) {
      if (e instanceof ApiFel && e.status === 409) {
        const aktuell = (e.data as { komponent?: Komponent })?.komponent;
        if (aktuell) setKomponenter((l) => l.map((x) => (x.id === aktuell.id ? aktuell : x)));
        visaMeddelande("Någon annan ändrade raden samtidigt. Raden är uppdaterad, gör om din ändring.");
      } else {
        setKomponenter((l) => l.map((x) => (x.id === fore.id ? fore : x)));
        visaMeddelande(`Ändringen kunde inte sparas: ${(e as Error).message}`);
      }
    }
  };

  const ny = async () => {
    try {
      const k = await api<Komponent>(`/api/projekt/${projektId}/komponenter`, { method: "POST", body: skicka({}) });
      lagg(k);
    } catch (e) {
      visaMeddelande(`Raden kunde inte skapas: ${(e as Error).message}`);
    }
  };

  const taBort = async (ids: string[]) => {
    const resultat = await Promise.allSettled(
      ids.map((id) => api(`/api/projekt/${projektId}/komponenter/${id}`, { method: "DELETE" })),
    );
    setKomponenter((l) => l.filter((x) => !ids.includes(x.id)));
    const misslyckade = resultat.filter((r) => r.status === "rejected").length;
    visaMeddelande(misslyckade ? `${misslyckade} rader kunde inte tas bort.` : `${ids.length} rader borttagna.`);
    if (misslyckade) void hamtaAllt();
  };

  const kontrollDef = listdefinitioner.find((d) => d.id === "kontroll");
  const kraftDef = listdefinitioner.find((d) => d.id === "kraft");
  const listDef = !listId ? undefined
    : aktivKontroll && kontrollDef
      ? { ...kontrollDef, id: listId, namn: aktivKontroll.namn, ingress: aktivKontroll.beskrivning || kontrollDef.ingress }
      : flik === "kraftberakning" && kraftDef && aktivtSkap
        ? { ...kraftDef, id: listId, namn: `Kraftberäkning ${aktivtSkap.namn}` }
        : listdefinitioner.find((d) => d.id === listId);
  /** Från Komponentinformation: gå till fliken och visa komponentens rad. */
  const gaTill = (malFlik: string, komponentId: string) => {
    const grupp = hittaFlik(malFlik)?.grupp.namn;
    if (grupp) setOppnaGrupper((g) => new Set(g).add(grupp));
    setFokus({ flik: malFlik, id: komponentId });
    window.setTimeout(() => setFokus((f) => (f?.id === komponentId ? null : f)), 3500);
    if (malFlik === "placeringsritningar") setRitningFokus(komponentId);
    onFlik(malFlik);
  };
  const fokusHar = fokus && fokus.flik === flik ? fokus.id : null;

  const listVy = (inbaddad: boolean) => listDef && vald ? (
    <ListVy
      key={listDef.id}
      def={listDef}
      grupp={vald.grupp.namn}
      rader={listor[listDef.id]}
      komponenter={komponenter}
      projekt={projekt}
      blinkar={blinkar}
      lasläge={!skrivbar}
      onAndra={(r, falt, v) => void andraLista(listDef, r, falt, v)}
      onNy={() => void nyListRad(listDef)}
      onTaBort={(ids) => void taBortListRader(listDef, ids)}
      onExcel={() => void laddaNer(`/api/projekt/${projektId}/listor/${listDef.id}/excel`, `${listDef.namn}.xlsx`).catch((e) => visaMeddelande((e as Error).message))}
      onFlik={onFlik}
      inbaddad={inbaddad}
      utanUtskrift={!!riskVariant}
      onInfo={setInfoId}
      fokusId={fokusHar}
    />
  ) : <p className="dampad">Hämtar…</p>;
  const skrivbar = mig.rattigheter.skriva;

  return (
    <div className="arbetsyta">
      <nav className="sidnav" aria-label="Flikar">
        <button className="tillbaka" onClick={onTillbaka}>← Alla projekt</button>
        {NAVIGERING.map((g) => {
          const oppen = oppnaGrupper.has(g.namn);
          return (
            <div key={g.namn} className={`grupp ${oppen ? "oppen" : ""}`}>
              <button
                className="grupp-knapp" aria-expanded={oppen}
                onClick={() => setOppnaGrupper((s) => { const n = new Set(s); if (n.has(g.namn)) n.delete(g.namn); else n.add(g.namn); return n; })}
              >
                <svg className="chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                {g.namn}
              </button>
              {oppen && (
                <div className="flikar">
                  {g.flikar.map((f) => (
                    <button key={f.id} className={`flik ${f.klar ? "" : "planerad"} ${flik === f.id ? "aktiv" : ""}`} onClick={() => onFlik(f.id)}>
                      {f.namn}
                      {!f.klar && <span className="fas">Fas {f.fas}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <main className="huvudyta">
        <div className="projekthuvud">
          <div className="projektnamn">
            <b>{projekt?.namn ?? "…"}</b>
            <span>{[projekt?.nummer, projekt?.kund].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="narvaro" aria-label="I projektet nu">
            {narvaro.map((n) => (
              <span key={n.id} className="avatar" style={{ background: fargFor(n.id) }} title={`${n.namn}${n.id === mig.id ? " (du)" : ""}`}>
                {initialer(n.namn)}
              </span>
            ))}
            <span className={`synkstatus ${status}`}>
              {status === "ansluten" ? "Livesynk på" : status === "ateransluter" ? "Ansluter…" : "Frånkopplad"}
            </span>
          </div>
        </div>

        {fel && <p className="felruta">Projektet kunde inte hämtas: {fel}</p>}

        {flik === "komponenter" && (
          <KomponenterVy
            projektId={projektId} kanHanteraMallar={!!mig.rattigheter.hanteraMallar} onUppdatera={() => void hamtaAllt()} visaMeddelande={visaMeddelande}
            onInfo={(k) => setInfoId(k.id)} fokusId={fokusHar}
            komponenter={komponenter} kataloger={kataloger} blinkar={blinkar} onAndra={andra} onNy={ny} onTaBort={taBort} lasläge={!mig.rattigheter.skriva} />
        )}
        {flik === "oversikt" && projekt && (
          <Oversikt
            projekt={projekt} komponenter={komponenter} attGora={attGora} anteckningar={anteckningar} logg={logg} narvaro={narvaro} onFlik={onFlik}
            egenkontroll={listor.egenkontroll} anmarkningar={listor.anmarkningar}
          />
        )}
        {flik === "andringslogg" && <LoggVy projektId={projektId} komponenter={komponenter} uppdaterad={loggVersion} />}
        {flik === "att-gora" && <AttGoraVy rader={attGora} blinkar={blinkar} onAndra={andraAttGora} onNy={nyAttGora} onTaBort={taBortAttGora} lasläge={!mig.rattigheter.skriva} />}
        {flik === "projektstatus" && <ProjektStatusVy projektId={projektId} rattigheter={mig.rattigheter} uppdaterad={statusVersion} visaMeddelande={visaMeddelande} />}
        {flik === "medlemmar" && <MedlemmarVy projektId={projektId} rattigheter={mig.rattigheter} visaMeddelande={visaMeddelande} />}
        {flik === "anteckningar" && anteckningar && <AnteckningarVy key={projektId} anteckningar={anteckningar} onSpara={sparaAnteckningar} lasläge={!mig.rattigheter.skriva} />}
        {vald?.flik.lista && listVy(false)}
        {kontrollTyp && vald && (
          <KontrollerVy
            key={kontrollTyp}
            projektId={projektId}
            typ={kontrollTyp}
            grupp={vald.grupp.namn}
            rubrik={vald.flik.namn}
            valdId={aktivKontroll?.id ?? null}
            onVald={(_, k) => setValdKontroll((alla) => ({ ...alla, [kontrollTyp]: k }))}
            uppdaterad={kontrollVersion}
            skriva={skrivbar}
            hanteraMallar={!!mig.rattigheter.hanteraMallar}
            visaMeddelande={visaMeddelande}
          >
            {listVy(true)}
          </KontrollerVy>
        )}
        {riskVariant && vald && (
          <RiskVy
            key={riskVariant}
            projektId={projektId}
            projekt={projekt}
            variant={riskVariant}
            grupp={vald.grupp.namn}
            rubrik={vald.flik.namn}
            text={texter[`risk-${riskVariant}`]}
            onSparaText={(t) => sparaText(`risk-${riskVariant}`, t)}
            def={listDef}
            rader={listId ? listor[listId] : undefined}
            lasläge={!skrivbar}
            visaMeddelande={visaMeddelande}
          >
            {listVy(true)}
          </RiskVy>
        )}
        {vald?.flik.text && textNyckel && (texter[textNyckel] ? (
          <AnteckningarVy
            key={`${projektId}-${textNyckel}`}
            anteckningar={texter[textNyckel]!}
            onSpara={(t) => sparaText(textNyckel, t)}
            lasläge={!skrivbar}
            grupp={vald.grupp.namn}
            rubrik={vald.flik.namn}
            ingress={textNyckel === "serviceinformation"
              ? "Information som serviceteknikern behöver: åtkomst, kontaktpersoner, larmhantering, särskilda förutsättningar. Sparas automatiskt."
              : "Övergripande information om projektet: omfattning, förutsättningar, kontaktpersoner och viktiga beslut. Sparas automatiskt."}
            onSkrivUt={(t) => skrivUt(vald.flik.namn, projekt, { typ: "text", text: t })}
          />
        ) : <p className="dampad">Hämtar…</p>)}
        {flik === "placeringsritningar" && (
          <PlaceringsritningVy
            projektId={projektId}
            projekt={projekt}
            komponenter={komponenter}
            egenkontroll={listor.egenkontroll}
            installationslista={listor.installationslista}
            kataloger={kataloger}
            uppdaterad={ritningVersion}
            fokusKomponent={ritningFokus}
            onFokusVisad={() => setRitningFokus(null)}
            onVisaKomponent={setInfoId}
            lasläge={!skrivbar}
            laggKomponent={lagg}
            taBortKomponentLokalt={(id) => setKomponenter((l) => l.filter((x) => x.id !== id))}
            andraLista={async (lista, komponentId, falt, varde) => {
              const def = listdefinitioner.find((d) => d.id === lista);
              if (def) await andraLista(def, { id: komponentId } as VisadRad, falt, varde);
            }}
            visaMeddelande={visaMeddelande}
          />
        )}
        {arSkapFlik && vald && (
          <>
            <div className="brodsmula">{vald.grupp.namn}</div>
            <h1>{vald.flik.namn}</h1>
            <p className="ingress">
              {flik === "apparatskap" && "Grundinformation, ledningsfärger, komponenter i skåpet och specifikation per skåp. Sparas automatiskt."}
              {flik === "kraftberakning" && "Strömmen per fas för det som matas från skåpet. Summan per fas visas längst ned."}
              {flik === "modulbelaggning" && "CPU1 och I/O-kort per skåp. Dra signaler från listan till vänster till en kanal. Grön = kopplad, röd = samma komponent kopplad på flera ställen. Markera en kanal och tryck Delete för att koppla loss."}
              {" "}Skåpen är desamma i Apparatskåp, Kraftberäkning och Modulbeläggning.
            </p>
            <SkapValjare
              projektId={projektId} skap={skapLista} valtId={valtSkap} onVal={setValtSkap}
              onUppdatera={hamtaSkap} lasläge={!skrivbar} visaMeddelande={visaMeddelande}
            />
            {skapLista === null ? <p className="dampad">Hämtar…</p> : !aktivtSkap ? (
              <p className="tomruta">Inga apparatskåp i projektet än. {skrivbar && "Klicka på Nytt skåp för att börja."}</p>
            ) : flik === "apparatskap" ? (
              <ApparatskapVy
                key={aktivtSkap.id} projektId={projektId} projekt={projekt} skap={aktivtSkap} komponenter={komponenter}
                lasläge={!skrivbar} onSparat={uppdateraSkap} onKonflikt={() => void hamtaSkap()} visaMeddelande={visaMeddelande}
              />
            ) : flik === "modulbelaggning" ? (
              <ModulbelaggningVy
                key={aktivtSkap.id} projektId={projektId} projekt={projekt} skap={aktivtSkap} allaSkap={skapLista}
                komponenter={komponenter} lasläge={!skrivbar} onSparat={uppdateraSkap} onKonflikt={() => void hamtaSkap()}
                visaMeddelande={visaMeddelande}
              />
            ) : (
              <>
                {listVy(true)}
                <KraftSumma rader={listId ? listor[listId] : undefined} />
              </>
            )}
          </>
        )}
        {flik === "ritbord" && (
          <RitbordVy
            projektId={projektId} projekt={projekt} lasläge={!skrivbar}
            kanInstallningar={!!mig.rattigheter.hanteraMallar}
            uppdaterad={ritbordVersion} visaMeddelande={visaMeddelande}
          />
        )}
        {flik === "projektfiler" && <ProjektfilerVy projektId={projektId} lasläge={!skrivbar} uppdaterad={filVersion} visaMeddelande={visaMeddelande} />}
        {vald && !vald.flik.klar && (
          <>
            <div className="brodsmula">{vald.grupp.namn}</div>
            <h1>{vald.flik.namn}</h1>
            <div className="planerad-ruta">
              <span className="fasmarke">Fas {vald.flik.fas}</span>
              <p>Den här fliken flyttas över från dagens program i fas {vald.flik.fas}.</p>
              <p className="dampad">Beskriv gärna hur du vill ha den i flikdokumentet innan den byggs.</p>
            </div>
          </>
        )}
      </main>
      {infoId && (
        <KomponentInfo
          projektId={projektId}
          komponent={komponenter.find((k) => k.id === infoId)}
          listdefinitioner={listdefinitioner}
          onStang={() => setInfoId(null)}
          onGaTill={(f, id) => { gaTill(f, id); if (window.innerWidth < 1300) setInfoId(null); }}
          onVisaPaRitning={(id) => { gaTill("placeringsritningar", id); setInfoId(null); }}
          uppdaterad={loggVersion}
        />
      )}
    </div>
  );
}
