/** Typer som speglar serverns DTO:er. */

export type Rattigheter = {
  skapaProjekt: boolean;
  hanteraAnvandare: boolean;
  hanteraMedlemmar: boolean;
  redigeraStatusRubriker: boolean;
  redigeraUnderrubriker: boolean;
  redigeraKataloger: boolean;
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
  lista: "attGora" | "anteckningar" | "projektStatus";
  typ: "skapad" | "andrad" | "borttagen";
  rad: unknown;
  avId: string;
  avNamn: string;
};
