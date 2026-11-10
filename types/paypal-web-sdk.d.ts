/**
 * Minimal declarations for the parts of the PayPal JS SDK v6 this store uses.
 * The SDK ships no TypeScript types; keep this in sync with
 * https://docs.paypal.ai/payments/methods/paypal/sdk/js/v6 if more is used.
 */
import type { DetailedHTMLProps, HTMLAttributes } from "react";

export type PayPalApproveData = { orderId: string; payerId?: string };
export type PayPalCancelData = { orderId?: string } | undefined;

export type PayPalPaymentSessionCallbacks = {
  onApprove: (data: PayPalApproveData) => void | Promise<void>;
  onCancel?: (data?: PayPalCancelData) => void;
  onError?: (error: Error) => void;
};

export type PayPalPaymentSession = {
  start: (
    options: { presentationMode: "auto" | "popup" | "modal" | "redirect" | "payment-handler" },
    orderPromise: Promise<{ orderId: string }>,
  ) => Promise<void>;
  destroy?: () => void;
  cancel?: () => void;
};

export type PayPalEligibleMethods = {
  isEligible: (method: "paypal" | "paylater" | "credit" | "venmo" | (string & {})) => boolean;
  getDetails: (method: "paylater" | "credit" | (string & {})) => { productCode?: string; countryCode?: string } | undefined;
};

export type PayPalSdkInstance = {
  findEligibleMethods: (options: { currencyCode: string }) => Promise<PayPalEligibleMethods>;
  createPayPalOneTimePaymentSession: (callbacks: PayPalPaymentSessionCallbacks) => PayPalPaymentSession;
  createPayLaterOneTimePaymentSession: (callbacks: PayPalPaymentSessionCallbacks) => PayPalPaymentSession;
  createPayPalMessages: (options: { currencyCode: string }) => unknown;
};

export type PayPalWebSdk = {
  createInstance: (options: {
    clientToken: string;
    components: ("paypal-payments" | "paypal-messages" | (string & {}))[];
    pageType?: "checkout" | "cart" | "product-details" | "home" | (string & {});
  }) => Promise<PayPalSdkInstance>;
};

/** <paypal-pay-later-button> needs these set as DOM properties (not attributes). */
export type PayPalPayLaterButtonElement = HTMLElement & { productCode?: string; countryCode?: string };

type CustomElementProps<E extends HTMLElement = HTMLElement> = DetailedHTMLProps<HTMLAttributes<E>, E>;

declare global {
  interface Window {
    paypal?: PayPalWebSdk;
  }
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": CustomElementProps & { type?: "pay" | "checkout" | "buynow" | "subscribe" };
      "paypal-pay-later-button": CustomElementProps<PayPalPayLaterButtonElement>;
      "paypal-message": CustomElementProps & {
        "auto-bootstrap"?: boolean;
        amount?: string;
        "currency-code"?: string;
      };
    }
  }
}
