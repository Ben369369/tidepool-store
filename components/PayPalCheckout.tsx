"use client";

import { useEffect, useRef, useState } from "react";
import type {
  PayPalCancelData,
  PayPalPayLaterButtonElement,
  PayPalPaymentSession,
  PayPalPaymentSessionCallbacks,
} from "@/types/paypal-web-sdk";

const GENERIC_ERROR = "PayPal ran into a problem. Please try again or pay with card.";

let sdkScript: Promise<void> | null = null;

/** Loads the JS SDK v6 core script once per page. */
function loadPayPalSdk(src: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  sdkScript ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      sdkScript = null;
      script.remove();
      reject(new Error("Failed to load the PayPal SDK"));
    };
    document.head.appendChild(script);
  });
  return sdkScript;
}

async function readJson(res: Response): Promise<{ error?: string; [key: string]: unknown }> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return {};
  }
}

/** PayPal + Pay Later buttons and Pay Later messaging for the cart page. */
export function PayPalCheckout({ amount, sdkUrl }: { amount: string; sdkUrl: string }) {
  const [paypalSession, setPayPalSession] = useState<PayPalPaymentSession | null>(null);
  const [payLater, setPayLater] = useState<{
    session: PayPalPaymentSession;
    productCode?: string;
    countryCode?: string;
  } | null>(null);
  const [showMessage, setShowMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [busy, setBusy] = useState(false);

  const lastOrderId = useRef<string | null>(null);
  const createOrderError = useRef<string | null>(null);
  const payLaterButton = useRef<PayPalPayLaterButtonElement>(null);

  useEffect(() => {
    let active = true;
    const sessions: PayPalPaymentSession[] = [];

    const callbacks: PayPalPaymentSessionCallbacks = {
      async onApprove({ orderId }) {
        setBusy(true);
        try {
          const res = await fetch("/api/checkout/paypal/capture", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId }),
          });
          const data = await readJson(res);
          if (!res.ok || typeof data.redirectUrl !== "string") {
            setError(data.error ?? GENERIC_ERROR);
            setBusy(false);
            return;
          }
          window.location.assign(data.redirectUrl);
        } catch {
          setError(GENERIC_ERROR);
          setBusy(false);
        }
      },
      onCancel(data?: PayPalCancelData) {
        setBusy(false);
        setCanceled(true);
        const orderId = data?.orderId ?? lastOrderId.current;
        if (orderId) {
          fetch("/api/checkout/paypal/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId }),
            keepalive: true,
          }).catch(() => {});
        }
      },
      onError(err) {
        console.error("[paypal]", err);
        setBusy(false);
        setError(createOrderError.current ?? GENERIC_ERROR);
      },
    };

    (async () => {
      await loadPayPalSdk(sdkUrl);
      const res = await fetch("/api/checkout/paypal/client-token", { cache: "no-store" });
      const data = await readJson(res);
      if (!res.ok || typeof data.clientToken !== "string") throw new Error(data.error ?? "No client token");
      if (!active || !window.paypal) return;

      const sdk = await window.paypal.createInstance({
        clientToken: data.clientToken,
        components: ["paypal-payments", "paypal-messages"],
        pageType: "checkout",
      });
      if (!active) return;

      try {
        sdk.createPayPalMessages({ currencyCode: "USD" });
        setShowMessage(true);
      } catch (err) {
        console.warn("[paypal] messages unavailable", err);
      }

      const methods = await sdk.findEligibleMethods({ currencyCode: "USD" });
      if (!active) return;

      if (methods.isEligible("paypal")) {
        const session = sdk.createPayPalOneTimePaymentSession(callbacks);
        sessions.push(session);
        setPayPalSession(session);
      }
      if (methods.isEligible("paylater")) {
        const details = methods.getDetails("paylater");
        const session = sdk.createPayLaterOneTimePaymentSession(callbacks);
        sessions.push(session);
        setPayLater({ session, productCode: details?.productCode, countryCode: details?.countryCode });
      }
    })().catch((err) => {
      console.error("[paypal] setup failed", err);
      if (active) setError("PayPal is unavailable right now. You can still pay with card.");
    });

    return () => {
      active = false;
      for (const session of sessions) session.destroy?.();
    };
  }, [sdkUrl]);

  useEffect(() => {
    const button = payLaterButton.current;
    if (!button || !payLater) return;
    button.productCode = payLater.productCode;
    button.countryCode = payLater.countryCode;
  }, [payLater]);

  /** Creates the order on the server; amounts come from the server-side cart. */
  async function createOrder(): Promise<{ orderId: string }> {
    const res = await fetch("/api/checkout/paypal/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount }),
    });
    const data = await readJson(res);
    if (!res.ok || typeof data.orderId !== "string") {
      createOrderError.current = data.error ?? GENERIC_ERROR;
      throw new Error(createOrderError.current);
    }
    lastOrderId.current = data.orderId;
    return { orderId: data.orderId };
  }

  async function start(session: PayPalPaymentSession) {
    if (busy) return;
    setError(null);
    setCanceled(false);
    createOrderError.current = null;
    lastOrderId.current = null;
    // The order promise is handed to start() un-awaited so PayPal can open its window right away.
    const orderPromise = createOrder();
    try {
      await session.start({ presentationMode: "auto" }, orderPromise);
    } catch (err) {
      console.error("[paypal] start failed", err);
      setError(createOrderError.current ?? GENERIC_ERROR);
    }
  }

  return (
    <>
      {showMessage && (
        <paypal-message
          auto-bootstrap
          amount={amount}
          currency-code="USD"
          data-testid="paypal-pay-later-message"
          className="order-first block text-sm"
        />
      )}

      {error && (
        <p role="alert" data-testid="paypal-error" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {canceled && !error && (
        <p
          role="status"
          data-testid="paypal-cancel-message"
          className="rounded-md bg-stone-100 px-4 py-3 text-sm text-stone-700"
        >
          PayPal checkout was canceled. Your cart is still here.
        </p>
      )}

      <paypal-button
        type="pay"
        data-testid="checkout-paypal"
        className="block w-full"
        hidden={!paypalSession}
        aria-disabled={busy || undefined}
        onClick={() => paypalSession && start(paypalSession)}
      />
      {payLater && (
        <paypal-pay-later-button
          ref={payLaterButton}
          data-testid="checkout-paypal-pay-later"
          className="block w-full"
          aria-disabled={busy || undefined}
          onClick={() => start(payLater.session)}
        />
      )}
    </>
  );
}
