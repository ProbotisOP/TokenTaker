# Early-entry timing and evidence

## Status and scope

This change preserves feed → coordinator → inspection/safety → entry decision → risk sizing → wallet/Jupiter → settlement. It does **not** establish positive expected net returns or add a non-Pump live data provider.

Phantom is a wallet, not a launch venue or market-event feed. Browser connection supplies an address; autonomous signing still uses the existing dedicated local trading signer. Never export a primary Phantom wallet's secret to enable the scanner.

No provider is selected by default (`EARLY_FEED_PROVIDER=NONE`). The old PumpPortal adapter remains explicitly selectable for observations, but new Pump buys are blocked in the coordinator and at Jupiter instruction attestation. Existing Pump positions retain SELL support. There is no non-Pump discovery/inspection adapter yet, so the requested non-Pump strategy cannot run live until one is verified. Do not restore DexScreener boosts or synthetic safety flags as a substitute.

## Entry logic

The stage and decision are separate:

| Stage | Meaning | Entry behavior |
|---|---|---|
| EARLY ACCUMULATION | Building or waiting for adequate causal evidence | WAIT, with the missing evidence named |
| CONFIRMATION | Distributed retained buying persists, price structure holds | WAIT until both observation and confirmation requirements hold; then BUY setup |
| EXPANSION | Short-window expansion or sharp price acceleration observed | Permanently skip |
| EXTENDED | Launch or confirmed-entry price ceiling breached | Permanently skip, even after retracement |
| EXHAUSTED | Structure broke or the confirmed signal aged out | No new entry |

Safety rejection and launch expiry have separate REJECTED/EXPIRED states. Display labels include `BUY — CLEAN EARLY ENTRY`, `WAIT — EARLY SETUP, NEED CONFIRMATION`, and `REJECT — TOO EXTENDED`. BUY is not a fill or return forecast.

### What changes timing

The old engine waited eight seconds, then began a separate three-second confirmation timer. The new engine counts sustained evidence during that observation period. Both requirements remain in force; only new trades advance confirmation. Wall-clock polling cannot manufacture persistence. Gaps reset the evidence clock.

The original minimum age, unique buyers, net flow, buy share, per-wallet share, liquidity and expansion ceilings are unchanged. Additional guards cover:

- Retained buyer addresses, not just gross buys; addresses are not proof of independent people.
- Price and volume changes across adjacent flow windows, with sharp price acceleration preventing entry.
- Pre-expansion pullback recovery plus renewed accumulation. No dip-buy reset after expansion.
- Flow-weighted observed price anchor and extension. This is a marginal-price anchor, **not an executable VWAP or fill**.
- Point-in-time liquidity withdrawal, holder growth and concentration changes. Holder counts are supplied only when inspected owner balances account for the entire supply; unknown coverage remains unknown.
- A fixed confirmation identity and expiry. Breached entry ceilings never renew after a retracement.

Profitable-wallet histories, funding clusters and verified wallet quality remain **unavailable**. Retained observed buying is not relabeled as smart money. No numerical net-return prediction is invented.

## Execution integration

The existing portfolio/risk and wallet interlocks still apply. Signal and one-click HTTP entries require a coordinator-issued signal; unknown/evicted tokens do not fall back to manual execution. The explicitly operator-requested preflight micro-trade remains separate from strategy entry.

Before a strategy BUY, the wallet:

1. Checks the exact buy quote and token decimals.
2. Requests an exit quote for the **minimum** tokens the buy can deliver, validates its mints/amount/slippage/impact, and builds/attests an unsigned exit transaction against the existing supported adapters. It never signs that preflight exit.
3. Checks the conservative round-trip cost, including the existing 0.0033 SOL fee/rent reserve. The 5% budget is a loss/cost bound, **not proof of positive expected edge**. Very small orders can fail this budget.
4. Applies the minimum of launch, accumulation-anchor and confirmed-signal ceilings to the worst executable buy price.
5. Rechecks the signal, safety, mode, risk, both quote ages, and elapsed execution time before signing through the existing final guard.

Provisional additions: 5% anchor extension, 2% confirmed-price drift, 3-second signal lifetime, 2.5-second preparation budget and 1.5-second quote age. These are uncalibrated safety guardrails. They may block most entries on slow RPCs or unsupported routes. They are not relaxed to produce trades. Redundant coordinator round-trip quotes were removed; the wallet checks the actual final order instead.

These checks cannot guarantee landing latency, an eventual exit, a stop-loss fill or a net profit. The unsigned exit build can itself fail before the token is held; that blocks entry rather than assuming exitability.

## Measured regression result

Run:

```sh
npm run benchmark:entry
```

The frozen reference is `7a1bc7caf2c731f16a22695662adfa37b6ad0d23`, copied into `tests/fixtures/legacyEarlyEntryEngine.ts` with only import paths changed.

**Synthetic control-flow fixture, not historical performance:** one 0.4 SOL buy each second, eight rotating buyers, fresh mocked safety, and a price increase of 0.2% of launch price per second.

| Measurement | Frozen engine | New engine |
|---|---:|---:|
| First BUY setup after launch | 11 seconds | 9 seconds |
| Observed price, launch = 1 | 1.022 | 1.018 |
| Launch-relative run-up at setup | 2.2% | 1.8% |

This demonstrates two seconds less avoidable signal delay with unchanged original evidence requirements. It does **not** measure landed entry prices or net returns. A synthetic quote at 1.10 is also rejected by the new confirmed-price ceiling even though it is below the old 1.35 launch ceiling.

Tests cover timer-only confirmation, gaps, parabolic expansion, latched extension, pullback recovery, holder/liquidity deterioration, missing quality evidence, quote costs/age, latency, exit attestation, signal API bypasses, and revalidation before signing.

## Historical validation: what is and is not available

Inspection of all locally available branch histories found no captured launch/event universe or point-in-time quote/account archive. The existing backtester, counterfactual corpus and tuner generate synthetic tokens and outcomes. They cannot determine which early conditions actually preceded profitable real moves.

The new offline tool is a **fixed-policy temporal OOS audit**, not a trained model or completed walk-forward optimization. It freezes policy before evaluating chronologically held-out launch episodes, uses expanding dedicated training partitions, embargoes/purges overlapping label horizons, and never reuses OOS tokens. Because there is no fitting, the training partitions are reserved, not used to claim learned alpha.

```sh
npm run validate:entry -- --input capture.json --config audit-config.json --output audit.json
```

Without input it fails. Synthetic input requires `--allow-synthetic` and stays labeled synthetic. Output files are created exclusively, not overwritten.

The exact versioned input and config contracts are exported from `src/trading/entryTimingValidation.ts` (`TimingDataset`, `LaunchEpisode`, `Quote`, `AuditConfig`). `DEFAULT_AUDIT_CONFIG` is usable without a config file, but size/latency/horizon must match the intended experiment before holding out data.

A capture must supply:

- The whole discovery universe, including losses, rejects, no-route launches and failed setups, with selection policy and source.
- Unique launch/token/event identifiers, verified creation/anchor availability, ordered event and receipt times, creator identity available at that anchor, and capture end.
- Trade and point-in-time inspection observations, not today's RPC values backfilled into the past.
- A predeclared decision clock including all receipt events and at most one-second gaps, through launch expiry. Coverage declarations for the market and inspection streams need an independently reviewable archive source/digest. Missing declarations or clock gaps are unresolved, not zero-return abstentions.
- Exact-size quote observations with input/output amounts in human SOL/token units, receipt/observation/expiry times, route availability, separately charged costs, source/digest, simulation result and supported-executor evidence. Output already includes spread, route fees and slippage; separate SOL fees/rent are charged once.
- Contemporaneous supported exit quotes for entry eligibility and separate fixed-horizon exit quotes for outcomes. Missing entry, preflight or exit evidence stays in the denominator and nulls aggregate net results. No spot-price fills, interpolation or eventual-peak exits are used.

The candidate replay applies the production numerical execution guard and consumes intervening market evidence. The reference applies the legacy launch ceiling/cost gate. Neither replays an actual portfolio, RPC inspector, instruction bytes or landed transaction. Route/coverage/digest declarations are assertions, not independently authenticated by the CLI. Quote precision and size mapping need archive review. A fresh exact-size quote at signal time is required to report executable-reference price extension.

**Still required:** choose non-Pump venues and an approved read-only provider; supply genuine complete event and executable-quote captures; validate a venue-specific pool/safety adapter; then preregister parameters/splits, run the audit and assess net outcomes, rejection/coverage rates and downside on untouched data. No claim of improved real expected net returns is made until that evidence exists.
