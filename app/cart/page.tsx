import Link from "next/link";
import { getCurrentCart } from "@/lib/cart";
import { centsToDecimalString, formatCents } from "@/lib/money";
import { isPayPalConfigured, paypalWebSdkUrl } from "@/lib/paypal";
import { PayPalCheckout } from "@/components/PayPalCheckout";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  checkout_failed: "We couldn't start checkout. Please try again.",
};

export default async function CartPage({ searchParams }: PageProps<"/cart">) {
  const cart = await getCurrentCart();
  const { error } = await searchParams;
  const errorMessage = typeof error === "string" ? (ERRORS[error] ?? "Something went wrong.") : null;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">Your cart</h1>

      {errorMessage && (
        <p role="alert" data-testid="cart-error" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}

      {cart.lines.length === 0 ? (
        <p data-testid="cart-empty" className="text-stone-600">
          Your cart is empty. <Link href="/" className="underline">Keep shopping</Link>.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-stone-200 border-y border-stone-200" data-testid="cart-lines">
            {cart.lines.map((line) => (
              <li key={line.productId} className="flex items-center gap-4 py-4" data-testid={`cart-line-${line.slug}`}>
                <div className="flex-1">
                  <Link href={`/products/${line.slug}`} className="font-medium hover:underline">
                    {line.name}
                  </Link>
                  <p className="text-sm text-stone-500">{formatCents(line.unitPriceCents)} each</p>
                </div>
                <form action="/api/cart" method="post" className="flex items-center gap-2">
                  <input type="hidden" name="action" value="set" />
                  <input type="hidden" name="productId" value={line.productId} />
                  <input type="hidden" name="redirectTo" value="/cart" />
                  <input
                    type="number"
                    name="quantity"
                    defaultValue={line.quantity}
                    min={0}
                    max={99}
                    aria-label={`Quantity of ${line.name}`}
                    data-testid="line-quantity"
                    className="w-16 rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
                  <button type="submit" className="text-sm underline" data-testid="line-update">
                    Update
                  </button>
                </form>
                <form action="/api/cart" method="post">
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="productId" value={line.productId} />
                  <input type="hidden" name="redirectTo" value="/cart" />
                  <button type="submit" className="text-sm text-stone-500 underline" data-testid="line-remove">
                    Remove
                  </button>
                </form>
                <span className="w-24 text-right font-medium" data-testid="line-total">
                  {formatCents(line.lineTotalCents)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-baseline justify-between">
            <span className="text-stone-600">Subtotal</span>
            <span className="text-xl font-semibold" data-testid="cart-subtotal">
              {formatCents(cart.subtotalCents, cart.currency)}
            </span>
          </div>

          <div className="mt-6 flex flex-col gap-3" data-testid="checkout-options">
            <form action="/api/checkout/stripe" method="post">
              <button
                type="submit"
                data-testid="checkout-stripe"
                className="w-full rounded-md bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-500"
              >
                Pay with card
              </button>
            </form>
            {/* PayPal buttons; its Pay Later message is ordered first, directly under the subtotal. */}
            {isPayPalConfigured() && (
              <PayPalCheckout amount={centsToDecimalString(cart.subtotalCents)} sdkUrl={paypalWebSdkUrl()} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
