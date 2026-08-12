-- Migra el registro de OTP por telefono/WhatsApp a OTP por correo.
-- La region/moneda y el filtro por region dejan de depender del telefono y pasan a
-- depender de "country". Esta migracion es NO DESTRUCTIVA: hace backfill y ajusta el
-- indice, pero NO elimina columnas todavia (las de telefono quedan inertes en la BD).
-- La eliminacion definitiva se hara en una migracion de seguimiento cuando se confirme
-- que todo funciona en produccion (ver bloque comentado al final).

-- 1) Backfill de country desde phoneCountryIso cuando falte.
UPDATE "users"
SET "country" = UPPER("phoneCountryIso")
WHERE ("country" IS NULL OR "country" = '')
  AND "phoneCountryIso" IS NOT NULL
  AND "phoneCountryIso" <> '';

-- 2) Backfill de billingRegion / preferredCurrency desde el pais cuando falten.
UPDATE "users"
SET
  "billingRegion" = CASE WHEN UPPER(COALESCE("country", "phoneCountryIso", '')) = 'BO' THEN 'BOLIVIA' ELSE 'INTERNATIONAL' END,
  "preferredCurrency" = CASE WHEN UPPER(COALESCE("country", "phoneCountryIso", '')) = 'BO' THEN 'BOB' ELSE 'USD' END
WHERE ("billingRegion" IS NULL OR "billingRegion" = '')
  AND (
    ("country" IS NOT NULL AND "country" <> '')
    OR ("phoneCountryIso" IS NOT NULL AND "phoneCountryIso" <> '')
  );

-- 3) Agrega indice sobre country (usado por el feed) sin eliminar el de phoneCountryIso.
--    Dejar el indice viejo no destruye datos; se elimina junto con la columna despues.
CREATE INDEX IF NOT EXISTS "users_country_idx" ON "users"("country");

-- 4) [PENDIENTE / SEGUIMIENTO] Eliminacion definitiva de columnas de metadata de telefono.
--    Ejecutar en una migracion posterior cuando se confirme que todo funciona:
-- DROP INDEX IF EXISTS "users_phoneCountryIso_idx";
-- ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneDialCode";
-- ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneNationalNumber";
-- ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneCountryIso";
-- ALTER TABLE "users" DROP COLUMN IF EXISTS "phoneCountryName";
