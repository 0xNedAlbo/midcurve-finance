-- Drop old pool price subscription tables
-- Data has been migrated to the generic OnchainDataSubscribers table
-- which supports both automation (persistent) and UI (expiring) subscriptions.

DROP TABLE IF EXISTS "pool_price_subscribers";
DROP TABLE IF EXISTS "pool_price_subscriptions";
