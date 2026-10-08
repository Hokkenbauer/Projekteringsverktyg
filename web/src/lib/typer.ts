/** Typer som speglar serverns DTO:er. */

export type Rattigheter = {
  skapaProjekt: boolean;
  hanteraAnvandare: boolean;
  hanteraMedlemmar: boolean;
  redigeraStatusRubriker: boolean;
  redigeraUnderrubriker: boolean;
  redigeraKataloger: boolean;
  hanteraMallar?: boolean;
  seAnslutningsinformation: boolean;
  skriva: boolean;
};

export type Roll = "Admin" | "Projektledare" | "System" | "Tekniker" | "Lasare";
export const ROLLER: { id: Roll; namn: string }[] = [
  { id: "Admin", namn: "Admin" },
  { id: "Projektledare", namn: "Projektledare" },
  { id: "System", namn: "System" },
  { id: "Tekniker", namn: "Tekniker" },
  { id: "Lasare", namn: "Läsare" },
];
export const rollNamn = (r: string) => ROLLER.find((x) => x.id === r)?.namn ?? r;

export type Mig = { id: string; namn: string; tema: TemaNamn; roll: Roll; rattigheter: Rattigheter };

export type AnvandarInfo = { id: string; namn: string; epost: string; roll: Roll; senastInloggad: string };
export type Medlem = { anvandarId: string; namn: string; epost: string; roll: Roll; tillagd: string; tillagdAv: string };

export type StatusRubrik = { id: string; namn: string; ordning: number };
export type StatusUppgift = {
  id: string; rubrikId: string; text: string; ordning: number; klar: boolean;
  kommentar: string; utfordAv: string; klarDatum: string | null; version: number;
};
export type ProjektStatus = { rubriker: StatusRubrik[]; uppgifter: StatusUppgift[] };

export type TemaNamn = "system" | "natt" | "dag" | "grafit" | "fjall";

export type Projekt = {
  id: string;
  namn: string;
  nummer: string;
  kund: string;
  ansvarig: string;
  skapad: string;
  skapadAv: string;
  antalKomponenter: number;
};

export type Komponent = {
  id: string;
  projektId: string;
  system: string;
  beteckning: string;
  komponenttyp: string;
  signaltyp: string;
  beskrivning: string;
  anslutsTill: string;
  kabeltyp: string;
  placering: string;
  ovrigt: string;
  produkttyp: string;
  produkt: string;
  monteringsanvisning: string;
  version: number;
  andrad: string;
  andradAv: string;
};

export type KomponentHandelse = {
  komponent: Komponent;
  falt: string | null;
  avId: string;
  avNamn: string;
};

export type Narvarande = { id: string; namn: string };

export type Logg = {
  id: number;
  tidpunkt: string;
  anvandarNamn: string;
  entitet: string;
  entitetId: string | null;
  beskrivning: string;
  falt: string | null;
  fore: string | null;
  efter: string | null;
};

export type AttGora = {
  id: string;
  projektId: string;
  text: string;
  klar: boolean;
  ordning: number;
  version: number;
  andrad: string;
  andradAv: string;
};

export type Anteckningar = { text: string; andrad: string | null; andradAv: string };

export type ListaHandelse = {
  /** attGora, anteckningar, projektStatus, filer, lista:<id> eller text:<nyckel>. */
  lista: string;
  typ: "skapad" | "andrad" | "borttagen";
  rad: unknown;
  avId: string;
  avNamn: string;
};

export type ListKolumn = {
  nyckel: string;
  rubrik: string;
  typ: "text" | "val" | "kryss" | "datum" | "komponent" | "lopnr" | "produkt" | "antal" | "differens" | "koppling" | "fran";
  val: string[] | null;
  komponentFalt: keyof Komponent | null;
  standard: string | null;
  mono: boolean;
  bredd: number | null;
  redigerbar: boolean;
  fyll: boolean;
  faktorer?: string[] | null;
  /** Förslag från komponenternas värden i detta fält (t.ex. produkttyp). */
  forslag?: keyof Kataloger | null;
  /** För typ koppling: förslagen är komponenter vars signaltyp innehåller detta. */
  kopplingSignaltyp?: string | null;
};

export type ListDef = {
  id: string;
  namn: string;
  grupp: string;
  ingress: string;
  kopplad: boolean;
  komponenttypInnehaller: string[] | null;
  bindestreck: boolean;
  kolumner: ListKolumn[];
};

export type ListRad = {
  id: string;
  komponentId: string | null;
  data: Record<string, string>;
  ordning: number;
  version: number;
  andrad: string;
  andradAv: string;
};

export type ProjektFil = {
  id: string;
  mapp: string;
  namn: string;
  version: number;
  antalVersioner: number;
  storlek: number;
  typ: string;
  uppladdad: string;
  uppladdadAv: string;
};

/** Förslagslistor per komponentfält, byggda av allt som använts i något projekt. */
export type Kataloger = Partial<Record<"system" | "komponenttyp" | "signaltyp" | "kabeltyp" | "produkttyp" | "produkt" | "placering", string[]>>;

/** Apparatskåp, delas av Apparatskåp, Kraftberäkning och Modulbeläggning. Data och Moduler är JSON. */
export type Skap = {
  id: string; namn: string; beteckning: string; placering: string; beskrivning: string;
  data: string; moduler: string; ordning: number; version: number; andrad: string; andradAv: string;
};
export type Korttyp = { id: string; namn: string; beskrivning: string; antalKanaler: number; farg: string; breddMm: number; stromMa: number; ordning: number };
export type ModulKanal = { komponentId?: string; information?: string };
export type ModulKort = { id: string; beskrivning: string; antalKanaler: number; farg: string; breddMm: number; stromMa: number; kanaler: ModulKanal[] };
export type Modulbelaggning = { cpu1: string; kort: ModulKort[] };

/** Namngivet dokument i ett projekt (funktionstext, servicerapport). Data = text eller JSON. */
export type ProjektDokument = {
  id: string; typ: string; namn: string; data: string; ordning: number; version: number;
  skapad: string; andrad: string; andradAv: string;
};
