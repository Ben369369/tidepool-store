import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { recordWebhookEventOnce } from "@/lib/orders";
import { verifyWebhookSignature } from "@/lib/paypal";
import { handlePayPalWebhookEvent, type PayPalWebhookEvent } from "@/lib/paypal-checkout";

export async function POST(request: NextRequest) {
  if (!process.env.PAYPAL_WEBHOOK_ID) {
    return NextResponse.json({ error: "Webhook id not configured" }, { status: 500 });
  }

  // Raw body, verified exactly as received.
  const rawBody = await request.text();

  let verified: boolean;
  try {
    verified = await verifyWebhookSignature(request.headers, rawBody);
  } catch (err) {
    console.error("[paypal webhook] verification error", err);
    return NextResponse.json({ error: "Verification unavailable" }, { status: 500 });
  }
  if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 400 });

  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(rawBody) as PayPalWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (typeof event?.id !== "string" || typeof event.event_type !== "string") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const isNew = await recordWebhookEventOnce("paypal", event.id, event.event_type);
  if (!isNew) return NextResponse.json({ received: true, duplicate: true });

  try {
    await handlePayPalWebhookEvent(event);
  } catch (err) {
    // Forget the event so PayPal's retry is processed.
    await db.processedWebhookEvent.delete({ where: { id: `paypal:${event.id}` } }).catch(() => {});
    console.error("[paypal webhook]", event.event_type, err);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
