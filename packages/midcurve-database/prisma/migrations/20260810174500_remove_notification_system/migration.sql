-- Remove the notification system and webhook integration.
--
-- Statement order is load-bearing:
--
--   1. The three tables. Dropping a table takes its own foreign keys and
--      indexes with it, so the constraints toward users and positions need no
--      separate statement. This also removes user_notifications_eventType_idx,
--      the last dependency on the enum dropped in step 2.
--   2. The enum type. Nothing else referenced it: before this migration
--      NotificationEventType was used by exactly one column,
--      user_notifications."eventType", plus that column's index.
--   3. The orphaned range-monitor subscriptions. This is data, not structure.
--
-- Steps 2 and 3 are both invisible to `db:migrate:verify`, for different
-- reasons, and neither can be trusted to the generator:
--
--   - Once schema.prisma stops declaring NotificationEventType, Prisma no
--     longer introspects it, so a type left behind in the database is not
--     reported as drift. The check passes whether or not step 2 is here.
--   - `migrate diff` compares structure and never data, so step 3 can neither
--     be generated nor verified — the same class of statement as the tokens
--     cleanup in 20260809162923_remove_accounting_layer.
--
-- Confirm both by querying the database directly after applying:
--
--   SELECT typname FROM pg_type WHERE typname = 'NotificationEventType';
--   SELECT count(*) FROM onchain_data_subscribers
--    WHERE "subscriptionId" LIKE 'auto:range-monitor:%' AND status <> 'deleted';
--
-- Both must return empty / zero.

-- DropTable
DROP TABLE "public"."position_range_statuses";
DROP TABLE "public"."user_notifications";
DROP TABLE "public"."user_webhook_configs";

-- DropEnum
DROP TYPE "public"."NotificationEventType";

-- UpdateData
-- RangeMonitor held one OnchainDataSubscribers row per tracked position
-- (auto:range-monitor:{positionId}) and retired its own orphans on startup.
-- The worker is gone, so nothing will ever retire these again. Left active,
-- the onchain-data service keeps a live pool subscription open for each one
-- indefinitely, feeding a queue with no consumer.
--
-- Rows are marked deleted rather than removed, which is how every other
-- subscription is retired — see AutomationSubscriptionService.
UPDATE "public"."onchain_data_subscribers"
SET "status" = 'deleted',
    "pausedAt" = CURRENT_TIMESTAMP
WHERE "subscriptionId" LIKE 'auto:range-monitor:%'
  AND "status" <> 'deleted';
