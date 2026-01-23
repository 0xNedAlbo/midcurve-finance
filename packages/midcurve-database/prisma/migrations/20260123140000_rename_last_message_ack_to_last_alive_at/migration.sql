-- Rename lastMessageAck to lastAliveAt (preserves column position and data)
-- This field now represents subscriber liveness heartbeats (updated every 15s by consumers)
ALTER TABLE "pool_price_subscribers" RENAME COLUMN "lastMessageAck" TO "lastAliveAt";
