import { db } from "@/lib/db";

/**
 * True when the order was paid (or is being paid) through PayPal. Stripe
 * orders leave paymentProvider null. Kept free of the PayPal SDK so proxy.ts
 * can use it cheaply.
 */
export async function isPayPalOrder(orderId: string): Promise<boolean> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { paymentProvider: true, paypalCaptureId: true },
  });
  return order?.paymentProvider === "paypal" || Boolean(order?.paypalCaptureId);
}
