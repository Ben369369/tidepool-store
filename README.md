# Tidepool Goods (store-a)

A small Next.js store that takes payment through **Stripe Checkout Sessions** (test mode only).
It's the Stripe-only starting point that PayPal Checkout Integrator adds PayPal checkout to.

Stack: Next.js 16 (App Router, TypeScript), Prisma 7 + SQLite (better-sqlite3 adapter), Stripe, Tailwind, Playwright.

## Run it

```bash
pnpm install                 # also runs `prisma generate`
cp .env.example .env.local   # then set STRIPE_SECRET_KEY=sk_test_...
pnpm setup                   # migrate + seed prisma/dev.db
pnpm dev                     # http://localhost:3000
```

Admin: http://localhost:3000/admin/orders (user `admin`, password `ADMIN_PASSWORD`).

Optional, to receive Stripe webhooks locally:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe   # put the whsec_... in STRIPE_WEBHOOK_SECRET
```

Webhooks aren't required: the return route confirms the Checkout Session with Stripe's API itself.

## Tests

```bash
pnpm exec playwright install chromium   # once
pnpm test:e2e
```

This creates a fresh `prisma/e2e.db`, builds, starts on port 3100, and runs:

- `e2e/cart.spec.ts`: cart math, server-side prices, cancel keeps the cart, and admin auth
- `e2e/stripe-checkout.spec.ts`: a real Stripe test-mode purchase (card 4242 4242 4242 4242), checked in the DB and in Stripe's API, then an admin refund (skipped if `STRIPE_SECRET_KEY` isn't set)

## Where things are

| Path | What |
|---|---|
| `lib/orders.ts` | All order logic: create from cart, mark paid, refunded, or canceled, webhook dedupe |
| `lib/cart.ts` | Cookie cart, with prices always read from the DB |
| `lib/stripe.ts` | Stripe client, Checkout Session creation and confirmation, refunds |
| `app/api/checkout/stripe/route.ts` | Creates the pending order and redirects to Stripe |
| `app/api/checkout/stripe/return/route.ts` | Stripe returns here; confirms the session with Stripe, then redirects to `/checkout/success` |
| `app/api/webhooks/stripe/route.ts` | Verified Stripe webhooks (`checkout.session.*`, `charge.refunded`) |
| `app/api/admin/orders/[id]/refund/route.ts` | Admin refund |
| `app/cart/page.tsx` | Cart and checkout buttons |
| `prisma/schema.prisma` | Product, Cart, CartItem, Order, OrderItem, ProcessedWebhookEvent |

Order statuses: `pending` → `paid` → `refunded`, or `pending` → `canceled`. Money is stored in integer cents.

## PayPal (sandbox)

The cart page also offers PayPal (JS SDK v6 `<paypal-button>`, Pay Later button and messaging) next to the Stripe button.

- Env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` (`sandbox` | `production`). The buttons only render when the client id and secret are set.
- Webhook: point a PayPal webhook at `<APP_URL>/api/webhooks/paypal` and subscribe to `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED` and `PAYMENT.CAPTURE.REFUNDED`. Every event is signature-verified with PayPal and deduplicated in `ProcessedWebhookEvent` (`paypal:<event id>`).
- Negative testing: in the sandbox only, a `PayPal-Mock-Response` header sent to `POST /api/checkout/paypal/capture` is forwarded to PayPal's capture call, e.g. `{"mock_application_codes":"INSTRUMENT_DECLINED"}`.
- Admin refunds use the same button; `proxy.ts` routes PayPal orders to `app/api/admin/orders/[id]/refund/paypal/route.ts`.

| Path | What |
|---|---|
| `lib/paypal.ts` | PayPal SDK client, client token, webhook signature verification |
| `lib/paypal-checkout.ts` | Create/capture/cancel/refund PayPal orders against store orders, webhook handlers |
| `app/api/checkout/paypal/*` | `client-token`, `orders`, `capture`, `cancel` routes used by `components/PayPalCheckout.tsx` |
| `app/api/webhooks/paypal/route.ts` | Verified PayPal webhooks |
