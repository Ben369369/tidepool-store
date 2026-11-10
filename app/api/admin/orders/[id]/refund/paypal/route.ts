import { NextResponse, type NextRequest } from "next/server";
import { getOrder, markOrderRefunded } from "@/lib/orders";
import { refundPayPalCapture } from "@/lib/paypal-checkout";

/**
 * Admin action: fully refund a PayPal-paid order. proxy.ts rewrites the admin
 * refund form's POST /api/admin/orders/:id/refund here for PayPal orders.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/admin/orders/[id]/refund/paypal">) {
  const { id } = await ctx.params;
  const order = await getOrder(id);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const back = new URL("/admin/orders", request.url);
  if (order.status === "refunded") return NextResponse.redirect(back, 303);
  if (order.status !== "paid") {
    back.searchParams.set("error", `Order is ${order.status}, not paid`);
    return NextResponse.redirect(back, 303);
  }
  if (order.paymentProvider !== "paypal" && !order.paypalCaptureId) {
    back.searchParams.set("error", "Order was not paid with PayPal");
    return NextResponse.redirect(back, 303);
  }

  try {
    await refundPayPalCapture(order);
    await markOrderRefunded(order.id);
  } catch (err) {
    console.error("[refund]", err);
    back.searchParams.set("error", "Refund failed");
  }
  return NextResponse.redirect(back, 303);
}
