-- Två nivåer av roller: verktygsroll (Admin, Intern, Extern) och projektroll per projekt (Projektledare, Tekniker, Lasare).
ALTER TABLE projekt_medlem ADD COLUMN IF NOT EXISTS "Roll" text NOT NULL DEFAULT 'Tekniker';
ALTER TABLE anvandare ADD COLUMN IF NOT EXISTS "FarSkapaProjekt" boolean NOT NULL DEFAULT false;
ALTER TABLE anvandare ADD COLUMN IF NOT EXISTS "FarAndraMallar" boolean NOT NULL DEFAULT false;

-- Projektrollen för befintliga medlemskap följer personens gamla roll.
UPDATE projekt_medlem m SET "Roll" = CASE a."Roll"
    WHEN 'Admin' THEN 'Projektledare' WHEN 'Projektledare' THEN 'Projektledare'
    WHEN 'Lasare' THEN 'Lasare' ELSE 'Tekniker' END
FROM anvandare a WHERE a."Id" = m."AnvandarId";

-- Den som tidigare fick ändra i alla projekt (Projektledare, System) behåller det: medlem i alla befintliga projekt.
INSERT INTO projekt_medlem ("ProjektId", "AnvandarId", "Roll", "Tillagd", "TillagdAv")
SELECT p."Id", a."Id", CASE a."Roll" WHEN 'Projektledare' THEN 'Projektledare' ELSE 'Tekniker' END, now(), 'Byte till projektroller'
FROM projekt p CROSS JOIN anvandare a
WHERE a."Roll" IN ('Projektledare', 'System')
  AND NOT EXISTS (SELECT 1 FROM projekt_medlem x WHERE x."ProjektId" = p."Id" AND x."AnvandarId" = a."Id");

-- Mallar och kataloger: samma personer som förut (Admin, Projektledare, System).
UPDATE anvandare SET "FarAndraMallar" = true WHERE "Roll" IN ('Admin', 'Projektledare', 'System');

-- Verktygsroll: Admin behålls. Övriga med samma e-postdomän som någon admin blir interna, andra externa.
-- Finns ingen admin med e-postdomän blir alla övriga interna (rätta under Admin).
UPDATE anvandare SET "Roll" = CASE
    WHEN "Roll" = 'Admin' THEN 'Admin'
    WHEN NOT EXISTS (SELECT 1 FROM anvandare x WHERE x."Roll" = 'Admin' AND x."Epost" LIKE '%@%') THEN 'Intern'
    WHEN lower(split_part("Epost", '@', 2)) IN (SELECT lower(split_part(x."Epost", '@', 2)) FROM anvandare x WHERE x."Roll" = 'Admin' AND x."Epost" LIKE '%@%') THEN 'Intern'
    ELSE 'Extern' END
WHERE "Roll" NOT IN ('Admin', 'Intern', 'Extern');

-- Väntande inbjudningar: rollen gäller nu i projektet.
UPDATE inbjudan SET "Roll" = 'Tekniker' WHERE "Roll" NOT IN ('Projektledare', 'Tekniker', 'Lasare');
