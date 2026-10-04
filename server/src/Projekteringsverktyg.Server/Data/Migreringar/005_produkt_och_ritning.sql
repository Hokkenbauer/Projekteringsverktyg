-- Produktuppgifter på komponenten (används av Placeringsritningar och exporten).
ALTER TABLE komponent ADD COLUMN IF NOT EXISTS "Produkttyp" text NOT NULL DEFAULT '';
ALTER TABLE komponent ADD COLUMN IF NOT EXISTS "Produkt" text NOT NULL DEFAULT '';
ALTER TABLE komponent ADD COLUMN IF NOT EXISTS "Monteringsanvisning" text NOT NULL DEFAULT '';

-- Placeringsritningar: byggnader, plan, rum, placeringar och kablar som ett dokument per projekt.
-- Komponenternas egna uppgifter ligger kvar i komponent; ritningen pekar bara på deras Id.
-- PDF-bakgrunderna ligger som projektfiler (Handlingar/Ritningar).
CREATE TABLE IF NOT EXISTS ritning (
    "ProjektId" uuid NOT NULL PRIMARY KEY REFERENCES projekt ("Id") ON DELETE CASCADE,
    "Data" text NOT NULL,
    "Version" integer NOT NULL DEFAULT 1,
    "Andrad" timestamp with time zone NOT NULL DEFAULT now(),
    "AndradAv" text NOT NULL DEFAULT ''
);
