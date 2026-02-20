-- DropEmailImageFromUser
-- Remove unused email and image columns from users table

-- Drop indexes first
DROP INDEX IF EXISTS "users_email_key";
DROP INDEX IF EXISTS "users_email_idx";

-- Drop columns
ALTER TABLE "users" DROP COLUMN IF EXISTS "email";
ALTER TABLE "users" DROP COLUMN IF EXISTS "image";
