-- Gemensam listmotor. Fria listor (Anmärkningsbilaga, IP-lista m.fl.) har KomponentId = NULL.
-- Komponentkopplade listor (Skyltlista, Egenkontroll m.fl.) har en rad per komponent
-- och lagrar bara listans egna fält i Data (JSON). Komponentens fält kopieras aldrig.
CREATE TABLE IF NOT EXISTS listrad (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Lista" text NOT NULL,
    "KomponentId" uuid NULL REFERENCES komponent ("Id") ON DELETE CASCADE,
    "Data" text NOT NULL DEFAULT '{}',
    "Ordning" integer NOT NULL DEFAULT 0,
    "Version" integer NOT NULL DEFAULT 1,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_listrad_ProjektId_Lista" ON listrad ("ProjektId", "Lista");
CREATE UNIQUE INDEX IF NOT EXISTS "UX_listrad_komponent" ON listrad ("ProjektId", "Lista", "KomponentId") WHERE "KomponentId" IS NOT NULL;

-- Fria textfält per projekt (Projektinformation, Serviceinformation).
CREATE TABLE IF NOT EXISTS projekttext (
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Nyckel" text NOT NULL,
    "Text" text NOT NULL DEFAULT '',
    "Andrad" timestamp with time zone NULL,
    "AndradAv" text NOT NULL DEFAULT '',
    PRIMARY KEY ("ProjektId", "Nyckel")
);

-- Projektfiler med versioner. Själva filen ligger i Blob Storage under BlobNamn.
CREATE TABLE IF NOT EXISTS projektfil (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Mapp" text NOT NULL,
    "Namn" text NOT NULL,
    "Version" integer NOT NULL,
    "Storlek" bigint NOT NULL,
    "Typ" text NOT NULL DEFAULT '',
    "BlobNamn" text NOT NULL,
    "Uppladdad" timestamp with time zone NOT NULL DEFAULT now(),
    "UppladdadAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_projektfil_ProjektId_Mapp_Namn" ON projektfil ("ProjektId", "Mapp", "Namn");
