-- Gemensamma kataloger som redigeras i appen (funktionstexter, projekteringsstöd, frågor till
-- teknisk beskrivning, byggvarudatabasen). Data = katalogen som JSON. Saknas raden används
-- grundkatalogen från dagens program (inbäddad i servern).
CREATE TABLE IF NOT EXISTS katalog (
    "Namn" text NOT NULL PRIMARY KEY,
    "Data" text NOT NULL DEFAULT '',
    "Version" integer NOT NULL DEFAULT 1,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);

-- Namngivna dokument i ett projekt: projektets funktionstexter, servicerapporter m.m.
-- Typ talar om vilken flik dokumentet hör till. Data = text eller JSON beroende på typ.
CREATE TABLE IF NOT EXISTS projektdokument (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Typ" text NOT NULL,
    "Namn" text NOT NULL DEFAULT '',
    "Data" text NOT NULL DEFAULT '',
    "Ordning" integer NOT NULL DEFAULT 0,
    "Version" integer NOT NULL DEFAULT 1,
    "Skapad" timestamp with time zone NOT NULL DEFAULT now(),
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_projektdokument_ProjektId_Typ" ON projektdokument ("ProjektId", "Typ");
