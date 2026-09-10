import fs from 'node:fs';
import path from 'node:path';
import type { PortfolioState, Position, RiskLimits } from '../types.ts';

export interface TradingSnapshot {
  version: 1;
  activePositions: Position[];
  closedPositions: Position[];
  portfolio: PortfolioState;
  riskLimits: RiskLimits;
  settledSignatures: string[];
}

export class TradingStateStore {
  constructor(private filename = path.join(process.cwd(), '.trading-state.json')) {}

  load(): TradingSnapshot | undefined {
    if (!fs.existsSync(this.filename)) return undefined;
    const data = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
    if (data.version !== 1 || !Array.isArray(data.activePositions) || !Array.isArray(data.closedPositions) ||
        !Array.isArray(data.settledSignatures) || data.settledSignatures.some((v: unknown) => typeof v !== 'string') ||
        !data.portfolio || !data.riskLimits) throw new Error('Invalid trading state; restore/reconcile before starting');
    for (const position of [...data.activePositions, ...data.closedPositions]) {
      if (!position.id || !position.walletAddress || !position.isRealWalletTrade || !Array.isArray(position.executionHistory) ||
          !Number.isFinite(position.sizeTokens) || position.sizeTokens < 0 ||
          !Number.isFinite(position.costBasisSol) || position.costBasisSol < 0 ||
          !Number.isFinite(position.realizedPnlSol) || !Number.isFinite(position.currentValueSol)) throw new Error('Invalid persisted position');
    }
    return data;
  }

  save(snapshot: TradingSnapshot): void {
    const temporary = `${this.filename}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { mode: 0o600 });
    const fd = fs.openSync(temporary, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temporary, this.filename);
    const directory = fs.openSync(path.dirname(this.filename), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  }
}
