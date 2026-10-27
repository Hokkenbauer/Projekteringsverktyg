-- Inställningar per komponent som JSON (t.ex. gatewayens typ, IP och portar). Tom = inga inställningar.
ALTER TABLE komponent ADD COLUMN IF NOT EXISTS "Installningar" text NOT NULL DEFAULT '';

-- Produkttyp och Fabrikat blir ett fält (Produkt). Där bara Fabrikat är ifyllt flyttas det till Produkt.
-- Fabrikat-kolumnen ("Produkt") lämnas orörd så att inget försvinner.
UPDATE komponent SET "Produkttyp" = "Produkt" WHERE "Produkttyp" = '' AND "Produkt" <> '';
