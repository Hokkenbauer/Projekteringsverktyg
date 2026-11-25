-- Projektlistan: arkivering och kategorier (mappar) med underkategorier.

-- Arkiverat projekt: tidpunkt och vem. NULL = aktivt projekt.
ALTER TABLE projekt ADD COLUMN IF NOT EXISTS "Arkiverad" timestamp with time zone NULL;
ALTER TABLE projekt ADD COLUMN IF NOT EXISTS "ArkiveradAv" text NOT NULL DEFAULT '';

-- Kategorier på startsidan (t.ex. Bravida, HECO). ForalderId = överordnad kategori (NULL = översta nivån).
-- AgareId: '' = gemensam för alla (så fungerar det nu). Ett användar-Id = användarens egna kategorier,
-- förberett för att senare kunna ha kategorier per användare utan ny tabell.
CREATE TABLE IF NOT EXISTS projektkategori (
    "Id" uuid NOT NULL PRIMARY KEY,
    "ForalderId" uuid NULL REFERENCES projektkategori ("Id"),
    "AgareId" text NOT NULL DEFAULT '',
    "Namn" character varying(100) NOT NULL,
    "Ordning" integer NOT NULL DEFAULT 0,
    "Skapad" timestamp with time zone NOT NULL,
    "SkapadAv" text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "IX_projektkategori_AgareId" ON projektkategori ("AgareId");

-- Vilken kategori ett projekt ligger i. Ett projekt ligger i högst en kategori per ägare
-- ('' = den gemensamma strukturen). Saknas rad = "Utan kategori".
CREATE TABLE IF NOT EXISTS projekt_kategoriplats (
    "ProjektId" uuid NOT NULL REFERENCES projekt ("Id") ON DELETE CASCADE,
    "AgareId" text NOT NULL DEFAULT '',
    "KategoriId" uuid NOT NULL REFERENCES projektkategori ("Id") ON DELETE CASCADE,
    PRIMARY KEY ("ProjektId", "AgareId")
);
CREATE INDEX IF NOT EXISTS "IX_projekt_kategoriplats_KategoriId" ON projekt_kategoriplats ("KategoriId");
