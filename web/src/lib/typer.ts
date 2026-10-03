/** Typer som speglar serverns DTO:er. */

export type Mig = { id: string; namn: string; tema: TemaNamn };

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
  lista: "attGora" | "anteckningar";
  typ: "skapad" | "andrad" | "borttagen";
  rad: unknown;
  avId: string;
  avNamn: string;
};
