-- Fix vault positionHash: append ownerAddress to make each wallet's vault
-- position a distinct entity.
-- Format: uniswapv3-vault/{chainId}/{vaultAddress}/{ownerAddress}

-- Step 1: Update positionHash on vault positions
UPDATE positions
SET "positionHash" = "positionHash" || '/' || (config->>'ownerAddress')
WHERE protocol = 'uniswapv3-vault'
  AND "positionHash" IS NOT NULL
  AND config->>'ownerAddress' IS NOT NULL;

-- Step 2: Update journal line positionRef values that reference the old format.
-- Join to positions table to get the correct new positionHash.
UPDATE journal_lines jl
SET "positionRef" = p."positionHash"
FROM positions p
WHERE p.protocol = 'uniswapv3-vault'
  AND p."positionHash" IS NOT NULL
  AND jl."positionRef" IS NOT NULL
  AND jl."positionRef" = 'uniswapv3-vault/' || (p.config->>'chainId') || '/' || (p.config->>'vaultAddress')
  AND jl."positionRef" != p."positionHash";
