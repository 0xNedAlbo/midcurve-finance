-- Backfill pool config data (token addresses, feeBps, tickSpacing) into position config JSON
UPDATE positions SET config = positions.config::jsonb
  || jsonb_build_object(
    'token0Address', p.config::jsonb->>'token0',
    'token1Address', p.config::jsonb->>'token1',
    'feeBps', (p.config::jsonb->'feeBps'),
    'tickSpacing', (p.config::jsonb->'tickSpacing')
  )
FROM pools p WHERE positions."poolId" = p.id;

-- Backfill pool state fields into position state JSON
UPDATE positions SET state = positions.state::jsonb
  || jsonb_build_object(
    'sqrtPriceX96', p.state::jsonb->>'sqrtPriceX96',
    'currentTick', (p.state::jsonb->'currentTick'),
    'poolLiquidity', p.state::jsonb->>'liquidity',
    'feeGrowthGlobal0', p.state::jsonb->>'feeGrowthGlobal0',
    'feeGrowthGlobal1', p.state::jsonb->>'feeGrowthGlobal1'
  )
FROM pools p WHERE positions."poolId" = p.id;
