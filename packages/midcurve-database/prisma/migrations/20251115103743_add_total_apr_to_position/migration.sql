-- Add totalApr column to Position table
-- This column stores the pre-calculated total APR (time-weighted across all periods + unrealized)
-- Null if position history is below minimum threshold (< 5 minutes)
ALTER TABLE "positions" ADD COLUMN "totalApr" DOUBLE PRECISION;

-- Note: Column is nullable, no backfill required
-- Will be populated automatically on next position refresh via UniswapV3PositionService
