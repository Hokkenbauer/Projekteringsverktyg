-- Ägare: den som skapade verktyget (första användaren, som automatiskt blev Admin).
-- Ägarens konto kan ingen annan ändra, och bara ägaren kan göra någon till Admin eller ta bort Admin.
-- Övriga administratörer blir HECO-användare (behåller rätten att ändra mallar och kataloger).
ALTER TABLE anvandare ADD COLUMN IF NOT EXISTS "Agare" boolean NOT NULL DEFAULT false;
UPDATE anvandare SET "Agare" = true
WHERE "Id" = (SELECT "Id" FROM anvandare WHERE "Roll" = 'Admin' ORDER BY "Skapad", "Id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM anvandare WHERE "Agare");
UPDATE anvandare SET "Roll" = 'Intern', "FarAndraMallar" = true
WHERE "Roll" = 'Admin' AND NOT "Agare" AND EXISTS (SELECT 1 FROM anvandare WHERE "Agare");
