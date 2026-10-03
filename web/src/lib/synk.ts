import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from "@microsoft/signalr";
import type { KomponentHandelse, Narvarande } from "./typer";

export type SynkHandelser = {
  komponentSkapad: (h: KomponentHandelse) => void;
  komponentAndrad: (h: KomponentHandelse) => void;
  komponentBorttagen: (h: KomponentHandelse) => void;
  narvaro: (lista: Narvarande[]) => void;
  ateransluten: () => void;
  status: (s: "ansluten" | "ateransluter" | "frankopplad") => void;
};

/** Ansluter till livesynken för ett projekt. Returnerar en funktion som kopplar ner. */
export function anslutTillProjekt(
  projektId: string,
  hamtaToken: () => Promise<string>,
  h: SynkHandelser,
): () => void {
  const anslutning: HubConnection = new HubConnectionBuilder()
    .withUrl("/hubs/projekt", { accessTokenFactory: hamtaToken })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build();

  anslutning.on("KomponentSkapad", h.komponentSkapad);
  anslutning.on("KomponentAndrad", h.komponentAndrad);
  anslutning.on("KomponentBorttagen", h.komponentBorttagen);
  anslutning.on("Narvaro", h.narvaro);

  anslutning.onreconnecting(() => h.status("ateransluter"));
  anslutning.onreconnected(async () => {
    await anslutning.invoke("GaMedIProjekt", projektId);
    h.status("ansluten");
    h.ateransluten();
  });
  anslutning.onclose(() => h.status("frankopplad"));

  let stoppad = false;
  (async () => {
    try {
      await anslutning.start();
      if (stoppad) return;
      await anslutning.invoke("GaMedIProjekt", projektId);
      h.status("ansluten");
    } catch {
      h.status("frankopplad");
    }
  })();

  return () => {
    stoppad = true;
    if (anslutning.state !== HubConnectionState.Disconnected) void anslutning.stop();
  };
}
