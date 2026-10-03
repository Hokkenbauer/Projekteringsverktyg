-- Användare och roller. Rollen är global: Admin, Projektledare, System, Tekniker, Lasare.
CREATE TABLE IF NOT EXISTS anvandare (
    "Id" text NOT NULL PRIMARY KEY,
    "Namn" text NOT NULL DEFAULT '',
    "Epost" text NOT NULL DEFAULT '',
    "Roll" text NOT NULL DEFAULT 'Tekniker',
    "Skapad" timestamp with time zone NOT NULL DEFAULT now(),
    "SenastInloggad" timestamp with time zone NOT NULL DEFAULT now()
);

-- Medlemmar per projekt. Tekniker och Läsare ser bara projekt de är medlemmar i.
CREATE TABLE IF NOT EXISTS projekt_medlem (
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "AnvandarId" text NOT NULL REFERENCES anvandare ("Id") ON DELETE CASCADE,
    "Tillagd" timestamp with time zone NOT NULL DEFAULT now(),
    "TillagdAv" text NOT NULL DEFAULT '',
    PRIMARY KEY ("ProjektId", "AnvandarId")
);

-- Projekt Status: fasta rubriker (företagets arbetsmetod, ändras av admin)...
CREATE TABLE IF NOT EXISTS status_rubrik (
    "Id" uuid NOT NULL PRIMARY KEY,
    "Namn" text NOT NULL,
    "Ordning" integer NOT NULL DEFAULT 0
);

-- ...och underrubriker per projekt, som läggs till så att de passar projektet.
CREATE TABLE IF NOT EXISTS status_uppgift (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "RubrikId" uuid NOT NULL REFERENCES status_rubrik ("Id") ON DELETE CASCADE,
    "Text" text NOT NULL DEFAULT '',
    "Ordning" integer NOT NULL DEFAULT 0,
    "Klar" boolean NOT NULL DEFAULT false,
    "Kommentar" text NOT NULL DEFAULT '',
    "UtfordAv" text NOT NULL DEFAULT '',
    "KlarDatum" timestamp with time zone NULL,
    "Version" integer NOT NULL DEFAULT 1,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_status_uppgift_ProjektId" ON status_uppgift ("ProjektId");

INSERT INTO status_rubrik ("Id", "Namn", "Ordning") VALUES
    ('5b0b3c1e-0f0e-4f5e-9a10-000000000001', 'Förprojektering', 1),
    ('5b0b3c1e-0f0e-4f5e-9a10-000000000002', 'Projektering', 2),
    ('5b0b3c1e-0f0e-4f5e-9a10-000000000003', 'Installationsunderlag', 3),
    ('5b0b3c1e-0f0e-4f5e-9a10-000000000004', 'Installationsritningar', 4),
    ('5b0b3c1e-0f0e-4f5e-9a10-000000000005', 'Skåpskonstruktion', 5)
ON CONFLICT ("Id") DO NOTHING;
