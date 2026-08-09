-- Remove the accounting layer.
--
-- Statement order is load-bearing:
--
--   1. accounting.token_lots.tokenId references public.tokens(id) with no
--      onDelete, i.e. RESTRICT. The tokens cleanup below fails while any lot
--      row exists, so the schema goes first.
--   2. The tokens cleanup itself. `prisma migrate diff` cannot generate this —
--      it compares structure, not data — and `db:migrate:verify` cannot check
--      it for the same reason. It is here so that applying the chain end to
--      end lands on one data state whether the target is an existing dev
--      database or an empty one.
--   3./4. The public-schema leftovers, as generated.
--
-- Note that steps 1 and 2 are also invisible to `prisma migrate diff` because
-- schema.prisma no longer declares the `accounting` schema: with
-- schemas = ["public"], Prisma does not inspect it, so it reports no drift
-- whether the schema is there or not. Dropping it has to be explicit.

-- DropSchema (chart of accounts, journal entries and lines, token lots,
-- lot states, lot disposals, and the TokenLotTransferEvent enum)
DROP SCHEMA IF EXISTS "accounting" CASCADE;

-- DeleteData
-- The journal rules were the only writers of these token types and TokenLot
-- the only reader. TokenFactory.fromDB throws on both, so the rows are
-- already uninstantiable by the rest of the system; left behind they would be
-- non-ERC-20 rows in a table everything else assumes holds ERC-20s.
DELETE FROM "public"."tokens" WHERE "tokenType" IN ('erc721', 'staking-share');

-- AlterTable
ALTER TABLE "public"."users" DROP COLUMN "reportingCurrency";

-- DropTable
DROP TABLE "public"."known_protocol_addresses";
