-- Inbjudningar av externa deltagare (gäster i Microsoft Entra ID). Gäller tills personen loggat in första gången.
CREATE TABLE IF NOT EXISTS inbjudan (
    "Id" uuid PRIMARY KEY,
    "Epost" text NOT NULL,
    "Namn" text NOT NULL DEFAULT '',
    "Roll" text NOT NULL,
    "ProjektIds" text NOT NULL DEFAULT '',
    "GastId" text NOT NULL DEFAULT '',
    "Status" text NOT NULL DEFAULT 'Vantar',
    "Meddelande" text NOT NULL DEFAULT '',
    "Skapad" timestamp with time zone NOT NULL DEFAULT now(),
    "SkapadAv" text NOT NULL DEFAULT '',
    "Accepterad" timestamp with time zone NULL,
    "AnvandarId" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_inbjudan_Epost" ON inbjudan ("Epost");
