# Trade with your existing Phantom wallet

Phantom now signs each trade through its browser approval popup. You do not need a dedicated trading keypair, a seed phrase import, or a separate funded trading wallet. The existing server-signing controls remain under an optional advanced section and are not needed for this flow.

## Local setup

1. Use this branch, install dependencies with `npm ci`, and open the application directly in a browser with Phantom installed. Embedded previews and this project's sandbox browser do not include your Phantom extension/account.
2. Configure the local server's `.env`:

   ```env
   ENABLE_LIVE_TRADING=true
   JUPITER_API_KEY=your_jupiter_api_key
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   EARLY_FEED_ENABLED=false
   EARLY_FEED_PROVIDER=NONE
   PUMPPORTAL_ENABLE_TRADES=false
   ```

   Use an RPC endpoint you trust; the public endpoint can throttle requests. Jupiter documents API-key authentication for the existing quote/build API: [API reference](https://developers.jup.ag/docs/api-reference/swap/v1/quote), [key portal](https://developers.jup.ag/portal). `JUPITER_API_KEY` is a provider credential, **not your Phantom private key**. Keep credentials on the local server and out of chat, source control and browser bundles. The wallet defaults to `SOLANA_RPC_URL`; a separately configured wallet RPC remains usable.
3. Restart with `npm run dev`, then open `http://localhost:3000` directly.
4. Open **Real Wallet / Phantom** and click **Connect Phantom**. Select the account you intend to trade from.
5. Read the mainnet warning, tick its acknowledgement, and click **Enable manual Phantom trading**. This enters LIVE mode for manual approvals and turns dedicated autotrading OFF. It does not submit a transaction.
6. For a manual swap, paste the token mint, choose the SOL amount, and acknowledge that your manual selection is not a bot-approved early entry. Click **Review buy in Phantom**, inspect the actual popup, and approve or reject.
7. Wait for **confirmed on-chain** feedback before treating the trade as filled. Tracked Phantom positions show **Review 50% sell** and **Review full sell in Phantom**. Each exit gets its own popup.

The scanner may still say launch discovery is disabled. That does **not** block a manually selected Phantom swap. Automated launch discovery is a separate capability; a disabled or unsupported market feed cannot generate real strategy signals.

## Approval and safety behavior

- Preparation only creates a server-validated unsigned transaction. The browser calls `signTransaction`, never `signAndSendTransaction`. The local server validates the approved signature/message before broadcasting.
- The required signer must be the connected Phantom account. Changing the account, transaction instructions, recipients, amounts or original message invalidates approval. The server verifies Ed25519 signatures, exact quote intent and the restricted swap instruction shape.
- Normal manual approvals expire within 15 seconds, including preparation time. If you take longer, the app rejects the expired approval instead of sending an old quote. Request a new review; it never automatically replaces/re-signs your transaction.
- A scanner-originated order still uses the original early-entry execution guards. Those signals have a much shorter lifetime and price ceiling. Human approval may be too slow; the trade is rejected rather than chasing.
- Existing size, allocation, gas reserve, position/exposure, loss, slippage and kill-switch limits still apply. Connecting Phantom does not increase limits or buy anything.
- A **manual** swap checks transaction integrity and risk limits, not complete launch age, holder concentration, liquidity withdrawal rights or calibrated expected returns. Its explicit manual-risk acknowledgement is not an early-entry approval.
- The existing executor supports a restricted legacy-SPL, direct Jupiter V1 transaction shape. Unsupported routes, Token-2022 layouts and new Pump buys remain blocked. Phantom signing does not make every Jupiter route supported. The upstream Metis V1 API is documented as superseded; this change does not migrate routing or weaken attestation.
- Cancellation or a rejected/expired approval does not broadcast. A local journal failure before broadcast is reported as a storage rejection. Once a send has been attempted, an uncertain result retains its pending journal and blocks blind retries.
- Signature identity is checked against persisted settlement history before rebroadcast and before accounting. Repeated signed bytes cannot produce a second recorded fill.

## Exits need approval too

Phantom-created positions are marked `signingMethod: PHANTOM`. The bot can recommend a stop-loss, take-profit or emergency exit, but **cannot silently sell from Phantom**. Keep the app open and approve exits yourself. A stop recommendation is not a guaranteed fill or automatic downside protection.

The panel sells only exact tracked position units belonging to the selected wallet. It does not liquidate unrelated wallet holdings. Confirmed partial exits release proportional cost basis; full exits move the position to closed accounting. SOL fees/rent and actual token balance deltas determine the recorded fill. Unknown outcomes are not represented as successful sales.

## Server routes

- `POST /api/wallet/phantom/enable`: connected owner plus explicit live disclaimer acknowledgement.
- `POST /api/wallet/phantom/prepare`: BUY/SELL intent. A manual BUY requires `requireEarlySignal: false` and `manualRiskAcknowledged: true`; scanner BUY requires `requireEarlySignal: true`. Returns short-lived approval ID, unsigned transaction and summary.
- `POST /api/wallet/phantom/submit`: approval ID and signed transaction bytes. A valid intent is single-use and serialized per wallet; invalid signatures do not consume an otherwise valid intent. Message/signature, current context, risk, quote and blockhash are revalidated.
- `POST /api/wallet/phantom/cancel`: removes unused preparation only. Cannot erase an in-flight or uncertain execution.

Unused preparations are bounded and expire. Restarting loses unsigned preparations and manual enablement, never durable pending execution or settled position accounting.

## Validation and remaining limits

Offline tests cover browser cancellation, account/message changes, expiry, a single active approval, cryptographic signatures, no server signing, quote/mint/amount validation, real settlement code with mocked RPC, partial/full exits, duplicate settled signatures, journal failures, and ambiguous sends. A real Chrome smoke test exercises transaction deserialization and a mocked Phantom rejection, with prepare/cancel calls but no submit. No real wallet, API key, paid feed or mainnet trade was used for validation.

Use one local process with durable state storage. This remains a local POC with unauthenticated control APIs, not an internet-facing wallet service. Do not expose it publicly or switch the active wallet during an in-flight transaction. A funded mainnet round trip has not been validated; no profitability or universal route-compatibility claim is made.
