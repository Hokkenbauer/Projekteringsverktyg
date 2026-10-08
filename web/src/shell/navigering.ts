/**
 * Appens flikar, samma grupper som i dagens program.
 * `klar` = fliken finns i den nya appen. Övriga visar vilken fas de byggs i.
 * Lägg till eller flytta flikar HÄR, inget annat behöver ändras för navigeringen.
 */
export type Flik = {
  id: string; namn: string; fas: number; klar?: boolean;
  /** Fliken är en lista i den gemensamma listmotorn (id enligt serverns Listdefinitioner). */
  lista?: string;
  /** Fliken är ett fritt textfält (nyckel enligt serverns TextEndpoints). */
  text?: string;
  /** Fliken visar kontroller av den här typen (serverns KontrollEndpoints). */
  kontroll?: "projekt" | "projektering" | "service";
  /** Fliken är en riskanalys (lista risk-{variant} och rubrikfält/texter). */
  risk?: "projektering" | "produktion";
};
export type Grupp = { namn: string; flikar: Flik[] };

export const NAVIGERING: Grupp[] = [
  {
    namn: "Projekt",
    flikar: [
      { id: "oversikt", namn: "Översikt", fas: 1, klar: true },
      { id: "projektfiler", namn: "Projektfiler", fas: 1, klar: true },
      { id: "medlemmar", namn: "Medlemmar", fas: 1, klar: true },
    ],
  },
  {
    namn: "Att göra",
    flikar: [
      { id: "att-gora", namn: "Lista", fas: 1, klar: true },
      { id: "anteckningar", namn: "Anteckningar", fas: 1, klar: true },
    ],
  },
  {
    namn: "Status",
    flikar: [
      { id: "projektstatus", namn: "Projekt Status", fas: 1, klar: true },
      { id: "andringslogg", namn: "Ändringslogg", fas: 1, klar: true },
    ],
  },
  {
    namn: "Komponenter & Listor",
    flikar: [
      { id: "komponenter", namn: "Komponenter", fas: 1, klar: true },
      { id: "skyltlista", namn: "Skyltlista", fas: 2, klar: true, lista: "skyltlista" },
      { id: "installationslista", namn: "Installationslista", fas: 2, klar: true, lista: "installationslista" },
      { id: "signallista", namn: "Signallista (I/O)", fas: 2, klar: true, lista: "signallista" },
      { id: "brandspjallstabell", namn: "Brandspjällstabell", fas: 2, klar: true, lista: "brandspjall" },
    ],
  },
  {
    namn: "Konstruktion",
    flikar: [
      { id: "apparatskap", namn: "Apparatskåp", fas: 4, klar: true },
      { id: "modulbelaggning", namn: "Modulbeläggning", fas: 4, klar: true },
      { id: "kraftberakning", namn: "Kraftberäkning", fas: 4, klar: true },
      { id: "modbus", namn: "Modbus", fas: 4, klar: true, lista: "modbus" },
      { id: "modbus-rtu", namn: "Modbus RTU", fas: 4, klar: true, lista: "modbusrtu" },
      { id: "bestallningslista", namn: "Beställningslista", fas: 4, klar: true },
    ],
  },
  {
    namn: "Driftsättning",
    flikar: [
      { id: "egenkontroll", namn: "Egenkontroll", fas: 3, klar: true, lista: "egenkontroll" },
      { id: "anmarkningsbilaga", namn: "Anmärkningsbilaga", fas: 3, klar: true, lista: "anmarkningar" },
      { id: "ip-lista", namn: "IP-lista", fas: 3, klar: true, lista: "iplista" },
      { id: "matplan", namn: "Mätplan", fas: 3, klar: true, lista: "matplan" },
      { id: "kontroller", namn: "Projektspecifika kontroller", fas: 3, klar: true, kontroll: "projekt" },
      { id: "anslutningsinformation", namn: "Anslutningsinformation", fas: 3, klar: true },
    ],
  },
  {
    namn: "Projektering",
    flikar: [
      { id: "projekteringsstod", namn: "Projekteringsstöd", fas: 5, klar: true },
      { id: "funktionstexter", namn: "Funktionstexter", fas: 5, klar: true },
      { id: "projekteringsegenkontroll", namn: "Projekteringsegenkontroll", fas: 5, klar: true, kontroll: "projektering" },
      { id: "riskanalys-projektering", namn: "Riskanalys projektering", fas: 5, klar: true, risk: "projektering" },
      { id: "riskanalys-produktion", namn: "Riskanalys produktion", fas: 5, klar: true, risk: "produktion" },
      { id: "byggvarubedomning", namn: "Byggvarubedömning", fas: 5, klar: true, lista: "byggvarubedomning" },
      { id: "sunda-hus", namn: "Sunda Hus", fas: 5, klar: true, lista: "sundahus" },
      { id: "teknisk-beskrivning", namn: "Teknisk beskrivning", fas: 5, klar: true },
      { id: "kravstallning", namn: "Listad kravställning", fas: 5, klar: true, lista: "kravstallning" },
      { id: "kalkylmangder", namn: "Kalkylmängder", fas: 5, klar: true, lista: "kalkylmangder" },
      { id: "placeringsritningar", namn: "Placeringsritningar", fas: 2, klar: true },
      { id: "ritbord", namn: "Ritbord (flödesbilder)", fas: 2, klar: true },
      { id: "projekteringsintyg", namn: "Projekteringsintyg", fas: 5, klar: true },
    ],
  },
  {
    namn: "Dokumentation",
    flikar: [
      { id: "projektinformation", namn: "Projektinformation", fas: 3, klar: true, text: "projektinformation" },
      { id: "signaturlista", namn: "Signaturlista", fas: 3, klar: true, lista: "signaturlista" },
      { id: "anlaggningsinstallningar", namn: "Anläggningsinställningar", fas: 3, klar: true, lista: "anlaggningsinstallningar" },
    ],
  },
  {
    namn: "Service",
    flikar: [
      { id: "servicerapport", namn: "Servicerapport", fas: 6, klar: true },
      { id: "planerade-tillfallen", namn: "Planerade tillfällen", fas: 6, klar: true, lista: "planerade" },
      { id: "serviceinformation", namn: "Serviceinformation", fas: 6, klar: true, text: "serviceinformation" },
      { id: "servicekontroller", namn: "Kontroller (service)", fas: 6, klar: true, kontroll: "service" },
    ],
  },
  {
    namn: "Verktyg",
    flikar: [
      { id: "html-verktyg", namn: "HTML-verktyg", fas: 6 },
      { id: "support", namn: "Support", fas: 6 },
    ],
  },
];

export function hittaFlik(id: string): { grupp: Grupp; flik: Flik } | null {
  for (const grupp of NAVIGERING) {
    const flik = grupp.flikar.find((f) => f.id === id);
    if (flik) return { grupp, flik };
  }
  return null;
}
