-- Un profesional verificado solo con CI (canCharge=false) puede subir despues su
-- titulo desde el perfil y mandarlo a verificar. Mientras el admin lo revisa,
-- sigue activo (practicando gratis) pero con esta bandera en true. Al aprobar el
-- titulo, el admin habilita canCharge y baja esta bandera.
--
-- Migracion NO DESTRUCTIVA: agrega una columna con default false.
ALTER TABLE "professional_profiles"
  ADD COLUMN IF NOT EXISTS "chargeVerificationPending" BOOLEAN NOT NULL DEFAULT false;
