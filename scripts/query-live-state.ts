async function queryState() {
  try {
    const res = await fetch('http://localhost:3000/api/state');
    if (!res.ok) {
      console.log('Server not reachable or status:', res.status);
      return;
    }
    const data = await res.json();
    console.log('Active Positions (' + data.activePositions?.length + '):');
    for (const p of (data.activePositions || [])) {
      console.log(' -', p.symbol, p.tokenMint, 'cost:', p.costBasisSol, 'holdingSec:', p.holdingSec);
    }
    console.log('\nClosed Positions (' + data.closedPositions?.length + '):');
    for (const p of (data.closedPositions || []).slice(0, 8)) {
      console.log(' -', p.symbol, p.tokenMint, 'exitReason:', p.exitReason, 'pnlSol:', p.realizedPnlSol, 'holdingSec:', p.holdingSec);
    }
  } catch (e: any) {
    console.log('Error fetching state:', e.message);
  }
}

queryState();
