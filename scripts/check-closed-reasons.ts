import { EngineCoordinator } from '../src/trading/engineCoordinator.ts';

async function checkClosed() {
  const coord = EngineCoordinator.getInstance();
  console.log('Active positions count:', coord.activePositions.length);
  console.log('Closed positions count:', coord.closedPositions.length);
  for (const cp of coord.closedPositions.slice(0, 5)) {
    console.log('---');
    console.log('Symbol:', cp.symbol);
    console.log('Mint:', cp.tokenMint);
    console.log('Status:', cp.status);
    console.log('ExitReason:', cp.exitReason);
    console.log('EnteredAt:', new Date(cp.enteredAt).toISOString());
    console.log('ClosedAt:', cp.closedAt ? new Date(cp.closedAt).toISOString() : 'none');
    console.log('HoldingSec:', cp.holdingSec);
    console.log('RealizedPnlSol:', cp.realizedPnlSol);
  }
}
checkClosed().catch(console.error);
