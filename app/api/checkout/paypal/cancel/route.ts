import { NextResponse, type NextRequest } from "next/server";
import { getCartId } from "@/lib/cart";
import { cancelPayPalOrder } from "@/lib/paypal-checkout";

/** The buyer closed PayPal without paying: cancel the pending store order, keep the cart. */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const orderId =
    typeof body === "object" && body !== null && "orderId" in body && typeof body.orderId === "string"
      ? body.orderId
      : null;
  if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

  try {
    await cancelPayPalOrder(orderId, await getCartId());
  } catch (err) {
    console.error("[paypal cancel]", err);
  }
  return NextResponse.json({ canceled: true });
}
