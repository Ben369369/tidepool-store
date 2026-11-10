import { NextResponse } from "next/server";
import { getCartId } from "@/lib/cart";
import { EmptyCartError } from "@/lib/orders";
import { createPayPalOrderForCart } from "@/lib/paypal-checkout";

/**
 * Creates the store order and the PayPal order from the server-side cart.
 * The total shown on the cart page is passed along so PayPal displays exactly
 * what the shopper saw (prep for promo codes, which aren't in the cart model yet).
 */
export async function POST(request: Request) {
  const { amount } = (await request.json().catch(() => ({}))) as { amount?: unknown };
  const cartId = await getCartId();
  if (!cartId) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  try {
    const { paypalOrderId } = await createPayPalOrderForCart(cartId, {
      displayedTotal: typeof amount === "string" ? amount : undefined,
    });
    return NextResponse.json({ orderId: paypalOrderId });
  } catch (err) {
    if (err instanceof EmptyCartError) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    console.error("[paypal create-order]", err);
    return NextResponse.json({ error: "We couldn't start checkout. Please try again." }, { status: 500 });
  }
}
