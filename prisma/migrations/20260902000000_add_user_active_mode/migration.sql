-- Habilita el modelo "doble capacidad" (usuario y profesional a la vez, estilo inDrive).
-- Introduce "activeMode": el modo que el usuario tiene seleccionado en la UI (el toggle
-- del perfil). NO otorga permisos por si mismo: la capacidad profesional se sigue
-- derivando de tener un ProfessionalProfile aprobado. Este campo solo decide que
-- feed/dashboard ve y que rol se registra en acciones ambiguas (ej. referidos).
--
-- Esta migracion es NO DESTRUCTIVA: solo agrega una columna con default y hace backfill.
-- No elimina ni modifica ninguna columna existente. La columna "role" se conserva intacta.

-- 1) Agrega la columna con default 'USER'. Al tener DEFAULT + NOT NULL, todas las filas
--    existentes (incluidos los psicologos) quedan pobladas automaticamente sin bloqueos.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activeMode" "UserRole" NOT NULL DEFAULT 'USER';

-- 2) Backfill: los usuarios que hoy son profesionales arrancan con el modo profesional
--    activo para no cambiarles la experiencia. Incluye el rol legacy ANFITRIONA.
UPDATE "users"
SET "activeMode" = 'PROFESSIONAL'
WHERE "role" IN ('PROFESSIONAL', 'ANFITRIONA');
