-- Nuevo modelo de verificacion del profesional (estilo "elige 1 documento").
-- En el registro el profesional sube UNO de: CI, TITULO o MATRICULA. El admin lo
-- valida y, segun el tipo, se habilita o no el cobro dentro de la app:
--   - CI        => NO puede cobrar (solo sesiones gratuitas, costo 0).
--   - TITULO    => puede cobrar.
--   - MATRICULA => puede cobrar.
--
-- Esta migracion es NO DESTRUCTIVA: crea un enum nuevo y agrega dos columnas con
-- default. No elimina ni modifica columnas existentes (idDocUrl, matriculaUrl, etc.
-- se conservan para compatibilidad).

-- 1) Enum con los tipos de documento de verificacion.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VerificationDocType') THEN
    CREATE TYPE "VerificationDocType" AS ENUM ('CI', 'TITULO', 'MATRICULA');
  END IF;
END$$;

-- 2) Tipo de documento elegido por el profesional (nullable: los registros antiguos
--    quedan en NULL y se resuelven cuando el admin los revise).
ALTER TABLE "professional_profiles"
  ADD COLUMN IF NOT EXISTS "verificationDocType" "VerificationDocType";

-- 3) Flag de cobro. Arranca en false; el admin lo activa al aprobar un TITULO/MATRICULA.
ALTER TABLE "professional_profiles"
  ADD COLUMN IF NOT EXISTS "canCharge" BOOLEAN NOT NULL DEFAULT false;

-- 4) Backfill: profesionales ya aprobados que tengan titulo o matricula cargada
--    pueden cobrar (no romper a los que ya operaban cobrando).
UPDATE "professional_profiles"
SET "canCharge" = true
WHERE "reviewStatus" = 'APPROVED'
  AND ("matriculaUrl" IS NOT NULL OR "tituloProfesionalUrl" IS NOT NULL);
