-- Ritbord (SCADA-bakgrunder/flödesbilder): flera bilder per projekt.
-- Data = bildens redigerbara innehåll (sidstorlek, lager och objekt) som JSON.
CREATE TABLE IF NOT EXISTS ritbord (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Namn" text NOT NULL,
    "Data" text NOT NULL DEFAULT '',
    "Ordning" integer NOT NULL DEFAULT 0,
    "Version" integer NOT NULL DEFAULT 1,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_ritbord_ProjektId" ON ritbord ("ProjektId");

-- Ritbordets gemensamma inställningar (kundstandarder, linjetyper, symboler, mallar). En rad för alla.
CREATE TABLE IF NOT EXISTS ritbord_installning (
    "Id" integer NOT NULL PRIMARY KEY,
    "Data" text NOT NULL,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
