-- Att göra-listan per projekt.
CREATE TABLE IF NOT EXISTS att_gora (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Text" text NOT NULL DEFAULT '',
    "Klar" boolean NOT NULL DEFAULT false,
    "Ordning" integer NOT NULL DEFAULT 0,
    "Version" integer NOT NULL DEFAULT 1,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_att_gora_ProjektId" ON att_gora ("ProjektId");

-- Anteckningar: ett fritt textfält per projekt.
ALTER TABLE projekt ADD COLUMN IF NOT EXISTS "Anteckningar" text NOT NULL DEFAULT '';
ALTER TABLE projekt ADD COLUMN IF NOT EXISTS "AnteckningarAndrad" timestamp with time zone NULL;
ALTER TABLE projekt ADD COLUMN IF NOT EXISTS "AnteckningarAndradAv" text NOT NULL DEFAULT '';
