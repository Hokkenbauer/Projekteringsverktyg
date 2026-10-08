-- HTML-verktyg som laddats upp (gemensamma för alla). Verktygen som följer med appen ligger i webben.
CREATE TABLE IF NOT EXISTS verktyg (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Namn" text NOT NULL,
    "Html" text NOT NULL DEFAULT '',
    "Storlek" bigint NOT NULL DEFAULT 0,
    "Uppladdad" timestamp with time zone NOT NULL DEFAULT now(),
    "UppladdadAv" text NOT NULL DEFAULT ''
);

-- Supportbiblioteket: manualer och dokument (PDF) gemensamma för alla. Filen ligger i fillagringen.
CREATE TABLE IF NOT EXISTS supportfil (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Namn" text NOT NULL,
    "Kategori" text NOT NULL DEFAULT '',
    "Storlek" bigint NOT NULL DEFAULT 0,
    "Typ" text NOT NULL DEFAULT 'application/pdf',
    "BlobNamn" text NOT NULL,
    "Uppladdad" timestamp with time zone NOT NULL DEFAULT now(),
    "UppladdadAv" text NOT NULL DEFAULT ''
);
