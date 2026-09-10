# TokenTaker: observed early-launch signals

This branch replaces the POC's fabricated live launch/safety/flow path with a causal, event-driven signal pipeline. **It does not establish profitability.** Default operation is **SHADOW**, with the market feed and live signing disabled.

## Phantom approval trading

Use your existing Phantom wallet with an approval popup for **every buy and sell**. No dedicated keypair or private-key import is needed. [Local setup, approval flow and limitations](docs/phantom-trading.md).

Open **Real Wallet / Phantom → Connect Phantom → Enable manual Phantom trading → Review buy in Phantom**. The server needs explicit `ENABLE_LIVE_TRADING=true` and Jupiter API access. Manual swaps can run with the scanner feed disabled; they are not presented as bot-approved early entries. Stops and take-profits require your exit approval and cannot sell silently.

## Early-entry timing update

[Entry stages, execution guards, measured regression evidence and the offline audit contract](docs/entry-timing.md).

- Phantom remains a wallet connection, not a launch-data source. No provider is selected by default. A verified non-Pump discovery/inspection adapter is still required; none is implemented yet.
- New Pump buys are blocked in the coordinator and transaction attestor. Existing positions retain their exit path.
- The same synthetic accumulation fixture confirms at **9 seconds instead of 11**, without lowering any original evidence threshold. This is a signal-timing regression result, **not historical or net-return evidence**.
- `npm run benchmark:entry` reproduces that result. `npm run validate:entry -- --input capture.json` audits supplied event/quote captures using frozen policy, temporal OOS partitions, coverage checks and execution guards. No genuine captures are stored in this repository.

## Run and validate

Node 22+ is required (native WebSocket and fetch).

```sh
npm ci
cp .env.example .env
npm run lint
npm test
npm run build
npm run dev
```

Open `http://localhost:3000`. The scanner starts empty, reports its actual feed state, and does not seed established tokens or invent buying activity. Keep this local: this POC's control API is not an authenticated, internet-facing trading service. Do not deploy it publicly with a funded signer.

## Observation setup

1. The only existing live adapter is PumpPortal, now observation-only for Pump launches. Leave `EARLY_FEED_PROVIDER=NONE` for the requested non-Pump setup; it needs a separate verified venue adapter. To explicitly inspect the legacy Pump feed, both `EARLY_FEED_PROVIDER=PUMPPORTAL` and `EARLY_FEED_ENABLED=true` are required. Creation subscriptions are free.
2. To evaluate wallet flow, configure `PUMPPORTAL_API_KEY` and explicitly set `PUMPPORTAL_ENABLE_TRADES=true`. [PumpPortal documents](https://pumpportal.fun/data-api/real-time/) a funded linked wallet requirement and metered trade events (currently 0.01 SOL per 10,000 events). Token subscriptions are capped at 100 and expire after two minutes. Consider the data cost before enabling them.
3. Configure `SOLANA_RPC_URL` with enough capacity for confirmed account inspections. The public RPC can throttle these reads; unavailable evidence blocks entries. Configure the wallet's RPC separately in its dashboard settings if overriding the server default for live execution.
4. Supply `JUPITER_API_KEY` for quote/build access where required. Never put these secrets in source control or browser code.
5. Stay in SHADOW while collecting observations. This mode emits signals but does not create pretend fills or fictional PnL.

## What reaches an entry signal

`EARLY ACCUMULATION → CONFIRMATION → EXPANSION → EXTENDED → EXHAUSTED`, with explicit waiting/rejection reasons. Entry is only eligible during confirmation, not after expansion:

- A real creation event supplies the launch price anchor, mint, signature and receipt time. RPC verifies that the transaction created the mint and its derived Pump curve, and supplies chain creation time.
- Confirmed reads inspect legacy SPL mint/freeze permissions, token supply, the curve's program owner/discriminator/PDA, **real** SOL reserves, creator ownership and owner-aggregated holder balances. Virtual reserves are used for marginal price, never treated as withdrawable liquidity.
- Only the verified curve's derived token custody account is excluded from holder concentration. Incomplete holder coverage blocks; distinct wallet addresses are not proof of distinct people or benign funding.
- Real swaps build rolling windows. No random ticks, fake social scores, address-hash reputations or fabricated profitable-wallet histories contribute to eligibility.
- Default policy: at least 8 seconds observed, 6 buyer addresses, 1 SOL net buying over 10 seconds, ≥65% buy share, ≤35% from one buyer, positive flow in both 5-second halves, and ≥3 seconds of trade-backed confirmation, counted concurrently with the observation window.
- The gate requires ≥3 SOL verified real reserves, a safety inspection no older than 15 seconds, and a trade no older than 3 seconds. A launch expires at 120 seconds. These are provisional risk/observation settings, not optimized parameters.
- A >35% expansion from the initial observation permanently skips that candidate, even after a retracement. Short-window spikes, broken price structure, creator selling and feed gaps prevent chasing. Launch-time and inspection price observations both enforce the expansion ceiling.

The low real-reserve floor and launch run-up cap must be considered together: a bonding curve's virtual reserves are not liquidity. The old 8-SOL requirement plus a 25% launch-relative cap would exclude many zero-initial-buy curves before they could qualify.

## Live execution safeguards

Dedicated server signing requires `ENABLE_LIVE_TRADING=true`, explicit LIVE-mode confirmation, a connected dedicated signer, passed preflight, and wallet authorization. Only FULL_AUTONOMOUS permits automatic signal submission. The separate **Phantom approval** path requires manual LIVE enable and a fresh wallet signature for every transaction, not a dedicated keypair/preflight. It never authorizes background Phantom trading.

Before strategy entry: bounded cash/exposure/loss sizing, executable buy and sell quotes, ≤5% estimated round-trip cost including a conservative 0.0033 SOL transaction/rent reserve (not a positive-edge forecast), a fresh reinspection, a worst-fill no-chase ceiling and a final signal/mode check immediately before signing. Each candidate gets at most one automatic attempt. Missing routes never fall back to a simulated fill. Tiny orders can be blocked by transaction/rent costs even when an entry signal is confirmed; increasing frequency or chasing price is not a remedy for uneconomic order sizing.

The signer accepts a deliberately narrow transaction shape: **legacy-SPL, direct single-hop Jupiter V1 `route` ExactIn**, using the documented Raydium or Meteora adapters for new buys; Pump wrapped adapters are retained for exits only, canonical wallet ATAs, bounded compute fees, authorized SOL wrapping and WSOL cleanup. Lookup tables are resolved before checking recipients/authorities/amounts. Shared-account, V2, split, referral, unknown program/adapter and token-delegation instructions are rejected. This relies on the known Jupiter and adapter programs; it is not an independent audit of those contracts. Current provider payloads outside this subset will be blocked, not silently trusted.

Positions use verified token decimals and exact base units. Fills are derived from confirmed transaction balance deltas, not quotes. Stop/TP references use actual entry cost. Partial exits release proportional cost basis; a TP tier is filled only after settlement. Emergency flatten attempts real exits for dedicated-signer positions and requests explicit approval for Phantom positions; unconfirmed positions remain open. Price exits require a fresh quote. A stopped/failed data source cannot guarantee a stop-loss fill.

### Persistence and uncertain transactions

Run **one server process per wallet/state directory** on durable local storage. This is not a distributed order coordinator.

- `.execution-pending.json`: fsynced before broadcast, retaining the deterministic signature, original blockhash and expiry on send/confirmation uncertainty.
- `.trading-state.json`: fsynced settled positions, accounting, risk state and settled signatures before acknowledging an execution. On restart, settled signatures can clear their matching confirmed pending records. Startup returns to SHADOW, never auto-arms LIVE.
- UNKNOWN executions block new buys and same-mint resubmission. There is no automatic uncertain-fill reconciliation yet. Inspect `/api/wallet/diagnostics`, reconcile the signature and actual balances against the saved state, and do not delete journals or retry blindly. Manual recovery requires accounting review. Backup both files together, along with the signer through a separate secure process.
- Live legacy positions without exact base units are blocked from automatic selling until reconciled. Reclaim operates on tracked positions, not unrelated wallet holdings. Daily realized PnL is UTC-day settlement PnL, including partial exits.

## Supported scope and remaining limits

- Launch discovery currently covers PumpPortal Pump.fun creation events, **not every Solana launch venue**.
- Inspection supports verified legacy SPL Pump curves/creation layouts. Token-2022, mayhem/cashback, non-SOL quotes, migrated curves, differing creator/layout data and incomplete holder coverage are blocked. These restrictions can exclude many current launches; an empty scanner is not a reason to relax unknown checks.
- Feed timestamps are local receipt times; actual creation time comes from confirmed RPC. Provider delivery delay, RPC lag, missed events and chain rollback still exist. This does not claim validator-level or guaranteed sub-second detection.
- No verified funding graph, bundled-wallet classifier, holder census beyond the inspected accounts, social provider or profitable-wallet database is connected. The UI labels those gaps.
- Grok and historical backtest/audit/tuning tabs remain **synthetic demos**, not real performance or calibration evidence. The Grok demo starts paused with an empty $41 simulated baseline. None of those synthetic results sizes live entries.
- No live buy/sell, paid trade subscription or profitable forward test was performed for this change. Tests validate software behavior, not future returns. Validate live provider formats, observation coverage, rejection rates, fees, slippage and outcomes before risking funds.

## Regression coverage

`npm test` includes creation/curve/RPC fixtures, invalid and missing safety evidence, causal rolling windows, independent-wallet counting, accumulation versus spike/late-entry replay, stale/gapped feeds, the real coordinator in SHADOW, swap-instruction tampering, decimal math, settlement uncertainty, exact exits, partial accounting, hard risk limits and demo isolation. All execution tests use mocks, never a funded key or live transaction.

Protocol references: [Pump program](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md), [Pump IDL](https://github.com/pump-fun/pump-public-docs/blob/main/idl/pump.json), [Jupiter instruction IDL](https://github.com/jup-ag/instruction-parser/blob/main/src/idl/jupiter.ts).
