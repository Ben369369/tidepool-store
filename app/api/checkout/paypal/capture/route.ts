import { NextResponse, type NextRequest } from "next/server";
import { isPayPalSandbox } from "@/lib/paypal";
import { capturePayPalOrder, PayPalCheckoutError } from "@/lib/paypal-checkout";

/** Captures an approved PayPal order (called from the buttons' onApprove). */
export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  const orderId =
    typeof body === "object" && body !== null && "orderId" in body && typeof body.orderId === "string"
      ? body.orderId
      : null;
  if (!orderId) return NextResponse.json({ error: "Missing orderId" }, { status: 400 });

  // Negative testing: forward PayPal-Mock-Response only in the sandbox, never live.
  const mockResponse = isPayPalSandbox() ? request.headers.get("paypal-mock-response") : null;

  try {
    const { storeOrderId, status } = await capturePayPalOrder(orderId, { mockResponse });
    return NextResponse.json({
      orderId: storeOrderId,
      status,
      redirectUrl: `/checkout/success?order_id=${encodeURIComponent(storeOrderId)}`,
    });
  } catch (err) {
    if (err instanceof PayPalCheckoutError) {
      return NextResponse.json({ error: err.message, issue: err.issue }, { status: err.status });
    }
    console.error("[paypal capture]", err);
    return NextResponse.json({ error: "We couldn't complete the payment. Please try again." }, { status: 500 });
  }
}
