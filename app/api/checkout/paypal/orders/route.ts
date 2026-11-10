import { NextResponse } from "next/server";
import { getCartId } from "@/lib/cart";
import { EmptyCartError } from "@/lib/orders";
import { createPayPalOrderForCart } from "@/lib/paypal-checkout";

/**
 * Creates the store order and the PayPal order from the server-side cart.
 * The request body is ignored: amounts and items come from the database.
 */
export async function POST() {
  const cartId = await getCartId();
  if (!cartId) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });

  try {
    const { paypalOrderId } = await createPayPalOrderForCart(cartId);
    return NextResponse.json({ orderId: paypalOrderId });
  } catch (err) {
    if (err instanceof EmptyCartError) return NextResponse.json({ error: "Your cart is empty." }, { status: 400 });
    console.error("[paypal create-order]", err);
    return NextResponse.json({ error: "We couldn't start checkout. Please try again." }, { status: 500 });
  }
}
