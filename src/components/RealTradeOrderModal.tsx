import React, { useState } from 'react';
import { X } from 'lucide-react';
import type { CandidateTokenState, WalletAutotradeConfig } from '../types.ts';
import { PhantomTradePanel } from './PhantomTradePanel.tsx';

interface RealTradeOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  candidate?: CandidateTokenState | null;
  initialMint?: string;
  initialSymbol?: string;
  initialPriceSol?: number;
  initialPriceUsd?: number;
  walletConfig?: WalletAutotradeConfig | null;
  onSuccess?: (positionId: string) => void;
  onOpenWalletSettings?: () => void;
}

export const RealTradeOrderModal: React.FC<RealTradeOrderModalProps> = ({ isOpen, onClose, candidate, initialMint, initialSymbol, onSuccess }) => {
  const [busy, setBusy] = useState(false);
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-50 bg-black/80 p-4 flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Review trade with Phantom">
    <div className="w-full max-w-2xl max-h-[90vh] overflow-auto rounded-xl bg-zinc-950 border border-zinc-700">
      <div className="flex justify-end p-2"><button aria-label="Close trade review" disabled={busy} onClick={onClose} className="p-2 text-zinc-300 hover:text-white"><X className="w-5 h-5" /></button></div>
      <PhantomTradePanel key={candidate?.metadata.mint ?? initialMint ?? 'manual'} candidate={candidate} initialMint={initialMint}
        initialSymbol={initialSymbol} onSuccess={onSuccess} showPositions={false} onBusyChange={setBusy} />
    </div>
  </div>;
};
