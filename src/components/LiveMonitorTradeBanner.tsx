import React, { useState } from 'react';
import { Wallet, Sliders } from 'lucide-react';
import { SystemMode, type WalletAutotradeConfig } from '../types.ts';

interface LiveMonitorTradeBannerProps {
  currentSystemMode: SystemMode;
  onSetSystemMode: (mode: SystemMode, confirmedLive?: boolean) => void;
  walletConfig: WalletAutotradeConfig | null;
  onOpenRealTradeModal: (initialMint?: string, initialSymbol?: string) => void;
  onNavigateToWallet: () => void;
  onToggleAutotrade?: () => void;
}

export const LiveMonitorTradeBanner: React.FC<LiveMonitorTradeBannerProps> = ({
  currentSystemMode, walletConfig, onOpenRealTradeModal, onNavigateToWallet,
}) => {
  const [mint, setMint] = useState('');
  const connected = walletConfig?.isConnected && walletConfig.walletAddress;
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 mb-5 space-y-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-zinc-200"><Wallet className="h-4 w-4 text-violet-300" />
        <strong>Phantom approval trading</strong><span className="text-xs text-zinc-500">Server: {currentSystemMode}</span>
      </div>
      <button onClick={onNavigateToWallet} className="rounded bg-violet-700 px-3 py-2 text-white"><Sliders className="inline w-4 h-4 mr-1" />Open Real Wallet / Phantom</button>
    </div>
    <p className="text-xs text-zinc-400">{connected ? `${walletConfig!.walletAddress!.slice(0, 6)}…${walletConfig!.walletAddress!.slice(-4)} · last reported balance ${walletConfig!.balanceSol.toFixed(4)} SOL` : 'Connect your existing Phantom wallet. No dedicated keypair is needed.'}</p>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); onOpenRealTradeModal(mint.trim() || undefined); }}>
      <input aria-label="Token mint for Phantom review" className="flex-1 min-w-48 rounded border border-zinc-700 bg-zinc-950 p-2 text-zinc-100 font-mono"
        placeholder="Token mint address for a manual swap" value={mint} onChange={event => setMint(event.target.value)} />
      <button className="rounded bg-emerald-700 px-3 py-2 font-semibold text-white" type="submit">Review trade in Phantom</button>
    </form>
    <p className="text-xs text-zinc-500">You approve every buy and sell. Opening this form does not submit a transaction. Manual swaps do not require the scanner feed.</p>
  </div>;
};
