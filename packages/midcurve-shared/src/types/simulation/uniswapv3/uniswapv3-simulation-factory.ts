/**
 * UniswapV3 Simulation Factory
 *
 * Bridges the existing data model to the SimulationEngine.
 * Creates a configured SimulationEngine from a UniswapV3Position
 * and its associated close orders.
 */

import type { UniswapV3Position } from '../../position/uniswapv3/uniswapv3-position.js';
import type { SwapConfig } from '../../automation/close-order-config.types.js';
import type { SimulationInstrument } from '../simulation-instrument.js';
import type { SimulationState } from '../simulation-state.js';
import { resolveExposure } from '../../position/close-order-simulation/resolve-exposure.js';
import { ClosePositionInstrument } from '../instruments/close-position-instrument.js';
import { UniswapV3LPComponent } from './uniswapv3-lp-component.js';
import { SimulationEngine } from '../simulation-engine.js';

export interface CreateSimulationEngineParams {
  position: UniswapV3Position;
  isToken0Quote: boolean;
  currentPoolPrice: bigint;
  stopLossPrice: bigint | null;
  takeProfitPrice: bigint | null;
  stopLossSwapConfig: SwapConfig | null;
  takeProfitSwapConfig: SwapConfig | null;
}

export function createUniswapV3SimulationEngine(
  params: CreateSimulationEngineParams,
): SimulationEngine {
  const componentId = params.position.id;
  const baseToken = params.position.getBaseToken();
  const quoteToken = params.position.getQuoteToken();
  const baseDecimals = baseToken.decimals;
  const quoteDecimals = quoteToken.decimals;

  // Build LP component
  const lpComponent = new UniswapV3LPComponent(componentId, params.position);

  // Build instruments from close orders
  const instruments: SimulationInstrument[] = [];

  if (params.stopLossPrice !== null) {
    const exposure = resolveExposure(params.stopLossSwapConfig, params.isToken0Quote);
    instruments.push(new ClosePositionInstrument(
      'stop_loss',
      componentId,
      params.stopLossPrice,
      'below',
      exposure,
      baseDecimals,
    ));
  }

  if (params.takeProfitPrice !== null) {
    const exposure = resolveExposure(params.takeProfitSwapConfig, params.isToken0Quote);
    instruments.push(new ClosePositionInstrument(
      'take_profit',
      componentId,
      params.takeProfitPrice,
      'above',
      exposure,
      baseDecimals,
    ));
  }

  const initialState: SimulationState = {
    components: [lpComponent],
    activeInstruments: instruments,
    triggeredEvents: [],
    costBasis: params.position.costBasis,
    baseDecimals,
    quoteDecimals,
  };

  return new SimulationEngine(initialState, params.currentPoolPrice);
}
