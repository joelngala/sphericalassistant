# Stripe Test Mode Setup

Use this to run the live Stripe demo flow (real Stripe API, test cards only).

## 1) Frontend env

Create/update `.env`:

```bash
VITE_API_BASE_URL=https://<your-worker>.workers.dev
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
VITE_GOOGLE_CLIENT_ID=...
```

`VITE_STRIPE_PUBLISHABLE_KEY` enables live billing mode in the Billing tab.

## 2) Worker secret

Set Stripe secret on the Cloudflare Worker:

```bash
npx wrangler secret put STRIPE_SECRET_KEY
```

Paste your `sk_test_...` key when prompted.

## 3) Run locally

Terminal A (worker):

```bash
npx wrangler dev
```

Terminal B (frontend):

```bash
npm run dev
```

Open any case -> `Billing` tab.

## 4) Demo flow

1. Create plan -> click `Create plan & send payment link`.
2. Stripe Checkout opens in a new tab.
3. Test success card: `4242 4242 4242 4242`.
4. Back in app: click `Sync from Stripe`.

Failure scenarios (for retries/past-due demos) can be tested with Stripe test cards from Stripe docs.
