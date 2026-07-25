-- Elimina googleId de users: el login con Google se resuelve solo por email
DROP INDEX IF EXISTS "users_googleId_key";
ALTER TABLE "users" DROP COLUMN IF EXISTS "googleId";
