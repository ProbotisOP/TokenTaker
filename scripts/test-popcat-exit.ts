import { ExitEngine } from '../src/trading/exitEngine.ts';
import { MicrostructureEngine } from '../src/trading/microstructureEngine.ts';
import { Position } from '../src/types.ts';

const pos: Position = {
  id: 'POS_LIVE_POPCAT_1788924377830',
  tokenMint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  symbol: 'POPCAT',
  name: 'Popcat',
  entryPriceSol: 0.0005012445567135901,
  entryPriceUsd: 0.077,
  currentPriceSol: 0.0004989,
  currentPriceUsd: 0.077,
  peakPriceUsd: 0.077,
  lowestPriceUsd: 0.077,
  sizeTokens: 39.9,
  costBasisSol: 0.02,
  currentValueSol: 0.0199,
  unrealizedPnlSol: -0.0001,
  unrealizedPnlPct: -0.46,
  realizedPnlSol: 0,
  enteredAt: Date.now() - 42000,
  holdingSec: 42,
  stopLossPriceSol: 0.0004410952099079593,
  takeProfitLadder: [
    { targetPriceSol: 0.0005012445567135901 * 1.45, pctToSell: 50, filled: false },
    { targetPriceSol: 0.0005012445567135901 * 2.10, pctToSell: 50, filled: false },
  ],
  trailingStopPriceSol: 0.0005012445567135901,
  trailingActivated: false,
  status: 'OPEN',
  isRealWalletTrade: true,
  executionType: 'LIVE_ON_CHAIN',
  isSimulated: false,
  walletAddress: 'Fk7JNPucbK6KxhYvAzR3nuqJCpvPBXtBhKa1jiBjcCYy',
  executionVenue: 'Jupiter DEX / Solana Mainnet',
  executionHistory: [],
};

const microEngine = new MicrostructureEngine(25.0, 0.0004989);
const snap = microEngine.getSnapshot();
console.log('Snapshot:', {
  liquidityChangePct: snap.liquidityChangePct,
  buySellRatio: snap.buySellRatio,
  priceVelocity: snap.priceVelocity,
  '30sVol': snap.windows['30s'].volumeSol
});

const sig = ExitEngine.evaluatePosition(pos, snap);
console.log('ExitSignal:', sig);

// What if trailingStop is evaluated?
console.log('TrailingStopPriceSol:', pos.trailingStopPriceSol);
console.log('CurrentPriceSol:', pos.currentPriceSol);
console.log('TrailingActivated:', pos.trailingActivated);
console.log('currentPrice <= stopLossPriceSol?', pos.currentPriceSol <= pos.stopLossPriceSol);
