import React, { useState } from 'react';
import {
  X,
  Key,
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Eye,
  EyeOff,
  Sparkles,
  Lock,
} from 'lucide-react';

interface DedicatedKeypairModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (address: string) => void;
  onKeypairConfigured?: (address?: string) => void;
  currentAddress?: string | null;
  currentPublicKey?: string | null;
  hasKeypair?: boolean;
  initialTab?: 'GENERATE' | 'IMPORT';
}

export const DedicatedKeypairModal: React.FC<DedicatedKeypairModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onKeypairConfigured,
  currentAddress,
  currentPublicKey,
  hasKeypair,
  initialTab = 'GENERATE',
}) => {
  const [activeTab, setActiveTab] = useState<'GENERATE' | 'IMPORT'>(initialTab);
  const [importKeyInput, setImportKeyInput] = useState('');
  const [showImportKey, setShowImportKey] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      setErrorMsg(null);
      setImportKeyInput('');
      setGeneratedResult(null);
    }
  }, [isOpen, initialTab]);

  // Result from generation
  const [generatedResult, setGeneratedResult] = useState<{
    address: string;
    privateKeyBase58?: string;
  } | null>(null);
  const [showGeneratedKey, setShowGeneratedKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/wallet/setup-dedicated-keypair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to generate keypair');
      }
      setGeneratedResult({
        address: data.address,
        privateKeyBase58: data.privateKeyBase58,
      });
      if (onSuccess) onSuccess(data.address);
      if (onKeypairConfigured) onKeypairConfigured(data.address);
    } catch (err: any) {
      setErrorMsg(err.message || 'Keypair generation failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImport = async () => {
    if (!importKeyInput.trim()) {
      setErrorMsg('Please paste a valid base58 private key');
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/wallet/setup-dedicated-keypair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privateKeyBase58: importKeyInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to import keypair');
      }
      if (onSuccess) onSuccess(data.address);
      if (onKeypairConfigured) onKeypairConfigured(data.address);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to import keypair');
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, isKey: boolean = false) => {
    navigator.clipboard.writeText(text);
    if (isKey) {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 3000);
    } else {
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-xl w-full p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto font-mono">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Key className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wide">
                Dedicated Solana Trading Wallet
              </h3>
              <p className="text-[11px] text-zinc-400">
                Secure worker execution architecture for Phantom
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Security Notice */}
        <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs flex items-start gap-2.5 text-amber-200 leading-relaxed">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-amber-300">Security Invariant: </span>
            Never use your primary personal wallet holding main assets. This setup creates or imports a dedicated sub-account whose private key resides strictly in the local server worker process. The web dashboard never accesses or signs with it.
          </div>
        </div>

        {/* Tab Selector */}
        {!generatedResult && (
          <div className="grid grid-cols-2 gap-2 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs font-bold">
            <button
              onClick={() => {
                setActiveTab('GENERATE');
                setErrorMsg(null);
              }}
              className={`py-2 rounded-lg transition ${
                activeTab === 'GENERATE'
                  ? 'bg-amber-400 text-zinc-950 shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              1. Generate New Keypair
            </button>
            <button
              onClick={() => {
                setActiveTab('IMPORT');
                setErrorMsg(null);
              }}
              className={`py-2 rounded-lg transition ${
                activeTab === 'IMPORT'
                  ? 'bg-amber-400 text-zinc-950 shadow'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              2. Import Sub-Account Key
            </button>
          </div>
        )}

        {/* Error message */}
        {errorMsg && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-600 text-rose-200 text-xs">
            {errorMsg}
          </div>
        )}

        {/* GENERATE RESULT VIEW */}
        {generatedResult ? (
          <div className="flex flex-col gap-4">
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/50 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase">
                <ShieldCheck className="w-4 h-4" />
                <span>Dedicated Trading Keypair Created Successfully</span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-relaxed">
                Save the details below. You will import this dedicated trading account into Phantom to monitor real-time flips, trades, and SOL balance.
              </p>

              {/* Public Address */}
              <div>
                <div className="text-[10px] text-zinc-400 uppercase mb-1">Trading Wallet Public Address (Phantom View)</div>
                <div className="flex items-center gap-2 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                  <span className="text-xs text-zinc-100 truncate flex-1">{generatedResult.address}</span>
                  <button
                    onClick={() => copyToClipboard(generatedResult.address, false)}
                    className="p-1 rounded hover:bg-zinc-800 text-amber-400 transition"
                    title="Copy Address"
                  >
                    {copiedAddress ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Private Key */}
              {generatedResult.privateKeyBase58 && (
                <div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 uppercase mb-1">
                    <span>One-Time Base58 Private Key (For Phantom Import)</span>
                    <button
                      onClick={() => setShowGeneratedKey(!showGeneratedKey)}
                      className="text-zinc-400 hover:text-zinc-200 text-[10px] flex items-center gap-1"
                    >
                      {showGeneratedKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      <span>{showGeneratedKey ? 'Hide' : 'Reveal'}</span>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-xs text-amber-300 truncate flex-1 font-mono">
                      {showGeneratedKey ? generatedResult.privateKeyBase58 : '••••••••••••••••••••••••••••••••••••••••••••••••'}
                    </span>
                    <button
                      onClick={() => copyToClipboard(generatedResult.privateKeyBase58 || '', true)}
                      className="p-1 rounded hover:bg-zinc-800 text-amber-400 transition"
                      title="Copy Private Key"
                    >
                      {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Phantom Import Instructions */}
            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs flex flex-col gap-2">
              <span className="font-bold text-zinc-200">How to view this in Phantom Wallet:</span>
              <ol className="list-decimal list-inside text-[11px] text-zinc-400 space-y-1">
                <li>Open your Phantom extension or mobile app.</li>
                <li>Click the top-left menu &rarr; <strong className="text-zinc-200">Manage Accounts</strong> &rarr; <strong className="text-zinc-200">Add / Connect Wallet</strong>.</li>
                <li>Choose <strong className="text-zinc-200">Import Private Key</strong>.</li>
                <li>Name it <strong className="text-amber-400">TokenTaker Bot</strong> and paste the key above.</li>
                <li>Deposit test funds (e.g. 0.05 SOL) to this wallet to begin trading.</li>
              </ol>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition shadow-lg"
            >
              Done &amp; Continue to Preflight
            </button>
          </div>
        ) : activeTab === 'GENERATE' ? (
          /* GENERATE PROMPT */
          <div className="flex flex-col gap-4">
            <p className="text-xs text-zinc-300 leading-relaxed">
              Clicking generate will create a cryptographically secure Solana keypair on your local server. The private key will be saved exclusively in <code className="text-amber-300 bg-zinc-950 px-1 rounded">.secure_trading_keypair.json</code> on the server and will never be exposed over the network.
            </p>

            <button
              onClick={handleGenerate}
              disabled={isSubmitting}
              className="w-full py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-zinc-950 font-bold text-xs uppercase tracking-wider transition shadow-lg flex items-center justify-center gap-2"
            >
              {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              <span>Generate Dedicated Keypair</span>
            </button>
          </div>
        ) : (
          /* IMPORT TAB */
          <div className="flex flex-col gap-4">
            {currentAddress && (
              <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-xs">
                <div className="text-[10px] text-zinc-500 uppercase font-bold">Connected Wallet Address:</div>
                <div className="text-amber-300 font-bold font-mono mt-0.5 break-all">{currentAddress}</div>
                <div className="text-[11px] text-zinc-400 mt-1">
                  Import this account's private key below so the worker can sign live trades without browser popups.
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
                <span>Paste Base58 Private Key (from Phantom):</span>
                <button
                  onClick={() => setShowImportKey(!showImportKey)}
                  className="text-zinc-400 hover:text-zinc-200 text-[10px] flex items-center gap-1"
                >
                  {showImportKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span>{showImportKey ? 'Hide' : 'Show'}</span>
                </button>
              </div>
              <input
                type={showImportKey ? 'text' : 'password'}
                value={importKeyInput}
                onChange={(e) => setImportKeyInput(e.target.value)}
                placeholder="e.g. 5M... or [12, 45, 98, ...]"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-400"
              />
            </div>

            {/* Step-by-step Phantom Export Guide */}
            <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs flex flex-col gap-2">
              <span className="font-bold text-zinc-200">How to get your Private Key in Phantom:</span>
              <ol className="list-decimal list-inside text-[11px] text-zinc-400 space-y-1">
                <li>Open your Phantom extension or app.</li>
                <li>Click the top account name or Settings ⚙️ &rarr; <strong className="text-zinc-200">Manage Accounts</strong>.</li>
                <li>Click your account {currentAddress ? `(${currentAddress.slice(0, 6)}...)` : ''} &rarr; <strong className="text-zinc-200">Show Private Key</strong>.</li>
                <li>Enter password, copy the key, and paste it in the box above.</li>
                <li>Click <strong className="text-emerald-400">Save &amp; Authenticate Keypair</strong>.</li>
              </ol>
            </div>

            <button
              onClick={handleImport}
              disabled={isSubmitting || !importKeyInput.trim()}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs uppercase tracking-wider transition shadow-lg flex items-center justify-center gap-2"
            >
              {isSubmitting ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              <span>Save &amp; Authenticate Keypair on Worker</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
