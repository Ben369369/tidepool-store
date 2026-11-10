import { randomUUID } from "node:crypto";
import {
  CaptureStatus,
  CheckoutPaymentIntent,
  OrderStatus,
  RefundStatus,
  type Order as PayPalOrder,
} from "@paypal/paypal-server-sdk";
import { db } from "@/lib/db";
import { centsToDecimalString, decimalStringToCents } from "@/lib/money";
import { createPendingOrderFromCart, markOrderCanceled, markOrderPaid, markOrderRefunded } from "@/lib/orders";
import { paypalErrorInfo, paypalOrders, paypalPayments } from "@/lib/paypal";

/** An error that is safe to show to the buyer, with the HTTP status for the route. */
export class PayPalCheckoutError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue: string | null = null,
  ) {
    super(message);
  }
}

/**
 * Creates the store order from the server-side cart (exactly as the Stripe
 * flow does) and a matching PayPal order. Nothing from the browser is used.
 */
export async function createPayPalOrderForCart(cartId: string, opts: { displayedTotal?: string } = {}) {
  const order = await createPendingOrderFromCart(cartId);
  const currencyCode = order.currency.toUpperCase();

  const itemTotalCents = order.items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  if (itemTotalCents !== order.totalCents) {
    throw new Error(`Order ${order.id}: item total ${itemTotalCents} does not match total ${order.totalCents}`);
  }

  const { result } = await paypalOrders().createOrder({
    paypalRequestId: `create-${order.id}`,
    prefer: "return=minimal",
    body: {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          referenceId: order.id,
          customId: order.id,
          // Show PayPal the total from the cart page. With promo codes coming, the
          // item breakdown won't add up to it, so it's only sent when no total is given.
          amount: opts.displayedTotal
            ? { currencyCode, value: opts.displayedTotal }
            : {
                currencyCode,
                value: centsToDecimalString(order.totalCents),
                breakdown: { itemTotal: { currencyCode, value: centsToDecimalString(itemTotalCents) } },
              },
          items: opts.displayedTotal ? undefined : order.items.map((item) => ({
            name: item.name.slice(0, 127),
            sku: item.productId.slice(0, 127),
            quantity: String(item.quantity),
            unitAmount: { currencyCode, value: centsToDecimalString(item.unitPriceCents) },
          })),
        },
      ],
    },
  });
  if (!result.id) throw new Error(`PayPal returned no order id for store order ${order.id}`);

  await db.order.update({
    where: { id: order.id },
    data: { paymentProvider: "paypal", paypalOrderId: result.id },
  });
  return { storeOrderId: order.id, paypalOrderId: result.id };
}

function firstCapture(order: PayPalOrder) {
  return order.purchaseUnits?.[0]?.payments?.captures?.[0];
}

function payerEmail(order: PayPalOrder): string | null {
  return order.paymentSource?.paypal?.emailAddress ?? order.payer?.emailAddress ?? null;
}

function declineMessage(issue: string | null): string {
  if (issue === "INSTRUMENT_DECLINED") {
    return "PayPal declined the payment method. Please choose another way to pay.";
  }
  if (issue === "PAYER_ACTION_REQUIRED") return "PayPal needs more information from you. Please try again.";
  return "PayPal couldn't complete the payment. Your cart is unchanged; please try again.";
}

export type CaptureOutcome = { storeOrderId: string; status: "paid" | "pending" };

/**
 * Captures an approved PayPal order and marks the store order paid through
 * markOrderPaid, after checking the capture is COMPLETED for the exact total.
 * Declines (HTTP 422) become a PayPalCheckoutError and leave the order unpaid.
 */
export async function capturePayPalOrder(
  paypalOrderId: string,
  options: { mockResponse?: string | null } = {},
): Promise<CaptureOutcome> {
  const order = await db.order.findUnique({ where: { paypalOrderId } });
  if (!order) throw new PayPalCheckoutError("Order not found", 404);
  if (order.status === "paid" || order.status === "refunded") return { storeOrderId: order.id, status: "paid" };
  if (order.status !== "pending") throw new PayPalCheckoutError(`This order is ${order.status}.`, 409);

  let captured: PayPalOrder;
  try {
    const { result } = await paypalOrders().captureOrder({
      id: paypalOrderId,
      // A mocked negative test gets its own key so it can't poison the real capture's idempotency key.
      paypalRequestId: options.mockResponse ? `capture-${order.id}-${randomUUID()}` : `capture-${order.id}`,
      paypalMockResponse: options.mockResponse ?? undefined,
      prefer: "return=representation",
    });
    captured = result;
  } catch (err) {
    const info = paypalErrorInfo(err);
    if (info.status === 422 && info.issue === "ORDER_ALREADY_CAPTURED") {
      captured = (await paypalOrders().getOrder({ id: paypalOrderId })).result;
    } else if (info.status === 422) {
      console.warn("[paypal capture] declined", order.id, info.issue, info.message);
      throw new PayPalCheckoutError(declineMessage(info.issue), 422, info.issue);
    } else {
      throw err;
    }
  }

  const capture = firstCapture(captured);
  if (!capture?.id) throw new PayPalCheckoutError(declineMessage(null), 422);

  if (capture.status === CaptureStatus.Pending) {
    // Funds not settled yet (e.g. eCheck). PAYMENT.CAPTURE.COMPLETED marks the order paid later.
    await db.order.update({ where: { id: order.id }, data: { paypalCaptureId: capture.id } });
    return { storeOrderId: order.id, status: "pending" };
  }
  if (captured.status !== OrderStatus.Completed || capture.status !== CaptureStatus.Completed) {
    console.warn("[paypal capture] not completed", order.id, captured.status, capture.status);
    throw new PayPalCheckoutError(declineMessage(null), 422, capture.status ?? null);
  }

  const amountCents = capture.amount ? decimalStringToCents(capture.amount.value) : -1;
  const currencyMatches = capture.amount?.currencyCode.toLowerCase() === order.currency.toLowerCase();
  if (amountCents !== order.totalCents || !currencyMatches) {
    console.error("[paypal capture] amount mismatch", order.id, capture.amount, order.totalCents);
    throw new PayPalCheckoutError("The captured amount doesn't match your order. Please contact us.", 422, "AMOUNT_MISMATCH");
  }

  await db.order.update({ where: { id: order.id }, data: { paypalCaptureId: capture.id } });
  await markOrderPaid(order.id, { amountCents, customerEmail: payerEmail(captured) });
  return { storeOrderId: order.id, status: "paid" };
}

/** Buyer closed the PayPal window: cancel the pending store order. The cart is left intact. */
export async function cancelPayPalOrder(paypalOrderId: string, cartId: string | null) {
  const order = await db.order.findUnique({ where: { paypalOrderId }, select: { id: true, cartId: true } });
  if (!order || !cartId || order.cartId !== cartId) return;
  await markOrderCanceled(order.id);
}

/** Fully refunds the PayPal capture of an order. */
export async function refundPayPalCapture(order: { id: string; paypalCaptureId: string | null }) {
  if (!order.paypalCaptureId) throw new Error(`Order ${order.id} has no PayPal capture`);
  try {
    const { result } = await paypalPayments().refundCapturedPayment({
      captureId: order.paypalCaptureId,
      paypalRequestId: `refund-${order.id}`,
      prefer: "return=minimal",
      body: {},
    });
    if (result.status === RefundStatus.Failed || result.status === RefundStatus.Cancelled) {
      throw new Error(`PayPal refund ${result.id} for order ${order.id} is ${result.status}`);
    }
    return result;
  } catch (err) {
    // Already refunded (e.g. from the PayPal dashboard): treat as done.
    if (paypalErrorInfo(err).issue === "CAPTURE_FULLY_REFUNDED") return null;
    throw err;
  }
}

type WebhookMoney = { currency_code?: string; value?: string };
type WebhookLink = { href?: string; rel?: string };
type WebhookResource = {
  id?: string;
  status?: string;
  amount?: WebhookMoney;
  custom_id?: string;
  links?: WebhookLink[];
  supplementary_data?: { related_ids?: { order_id?: string } };
};
export type PayPalWebhookEvent = { id: string; event_type: string; resource?: WebhookResource };

/** Finds the store order for a capture resource: by capture id, then PayPal order id, then custom_id. */
async function findOrderForCapture(capture: WebhookResource) {
  if (capture.id) {
    const byCapture = await db.order.findUnique({ where: { paypalCaptureId: capture.id } });
    if (byCapture) return byCapture;
  }
  const paypalOrderId = capture.supplementary_data?.related_ids?.order_id;
  if (paypalOrderId) {
    const byOrder = await db.order.findUnique({ where: { paypalOrderId } });
    if (byOrder) return byOrder;
  }
  if (capture.custom_id) {
    const byCustomId = await db.order.findUnique({ where: { id: capture.custom_id } });
    if (byCustomId?.paymentProvider === "paypal") return byCustomId;
  }
  return null;
}

/** The refund's "up" link points to /v2/payments/captures/{captureId}. */
function captureIdFromRefund(refund: WebhookResource): string | null {
  for (const link of refund.links ?? []) {
    if (link.rel !== "up" || !link.href) continue;
    const match = /\/v2\/payments\/captures\/([^/?#]+)/.exec(link.href);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

function moneyToCents(money: WebhookMoney | undefined): number | null {
  if (!money?.value) return null;
  try {
    return decimalStringToCents(money.value);
  } catch {
    return null;
  }
}

export async function handlePayPalWebhookEvent(event: PayPalWebhookEvent) {
  const resource = event.resource ?? {};
  switch (event.event_type) {
    case "PAYMENT.CAPTURE.COMPLETED": {
      if (resource.status && resource.status !== "COMPLETED") break;
      const order = await findOrderForCapture(resource);
      if (!order) {
        console.warn("[paypal webhook] no order for capture", resource.id);
        break;
      }
      if (order.status === "paid" || order.status === "refunded") break;
      const amountCents = moneyToCents(resource.amount);
      if (amountCents !== order.totalCents || resource.amount?.currency_code?.toLowerCase() !== order.currency) {
        console.error("[paypal webhook] amount mismatch", order.id, resource.amount, order.totalCents);
        break;
      }
      if (resource.id && order.paypalCaptureId !== resource.id) {
        await db.order.update({ where: { id: order.id }, data: { paypalCaptureId: resource.id } });
      }
      await markOrderPaid(order.id, { amountCents });
      break;
    }
    case "PAYMENT.CAPTURE.DENIED": {
      const order = await findOrderForCapture(resource);
      if (order) await markOrderCanceled(order.id); // pending orders only
      break;
    }
    case "PAYMENT.CAPTURE.REFUNDED": {
      const captureId = captureIdFromRefund(resource);
      if (!captureId) break;
      const order = await db.order.findUnique({ where: { paypalCaptureId: captureId } });
      if (!order || order.status !== "paid") break;
      const refundedCents = moneyToCents(resource.amount);
      if (refundedCents !== null && refundedCents < order.totalCents) break; // partial refunds are out of scope
      await markOrderRefunded(order.id);
      break;
    }
  }
}
