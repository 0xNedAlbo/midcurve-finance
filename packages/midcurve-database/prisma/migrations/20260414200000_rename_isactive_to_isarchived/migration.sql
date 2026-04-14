-- Rename isActive → isArchived (inverted boolean: isActive=true becomes isArchived=false)
-- Rename positionClosedAt → archivedAt

-- Step 1: Rename columns
ALTER TABLE "public"."positions" RENAME COLUMN "isActive" TO "isArchived";
ALTER TABLE "public"."positions" RENAME COLUMN "positionClosedAt" TO "archivedAt";

-- Step 2: Invert the boolean (isActive=true → isArchived=false, isActive=false → isArchived=true)
UPDATE "public"."positions" SET "isArchived" = NOT "isArchived";

-- Step 3: Set default for new column semantics
ALTER TABLE "public"."positions" ALTER COLUMN "isArchived" SET DEFAULT false;

-- Step 4: Clear archivedAt for non-archived positions (was set on burn, not user action)
UPDATE "public"."positions" SET "archivedAt" = NULL WHERE "isArchived" = false;

-- Step 5: Drop old index and create new one
DROP INDEX IF EXISTS "public"."positions_isActive_idx";
CREATE INDEX "positions_isArchived_idx" ON "public"."positions"("isArchived");
