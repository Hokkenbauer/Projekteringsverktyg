-- Tomma datum från det gamla programmet (0001-01-01) blir tomma, så att utskrifter har en tom ruta att fylla i för hand.
UPDATE listrad SET "Data" = regexp_replace("Data", '"([A-Za-z0-9_]+)"\s*:\s*"0001-01-01[^"]*"', '"\1":""', 'g')
WHERE "Data" LIKE '%0001-01-01%';
