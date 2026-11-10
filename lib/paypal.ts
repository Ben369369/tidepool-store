import { ApiError, Client, Environment, OrdersController, PaymentsController } from "@paypal/paypal-server-sdk";

/**
 * PayPal infrastructure: credentials, the server SDK client (Orders v2 and
 * Payments), and the two REST calls the SDK doesn't cover (browser client
 * token and webhook signature verification).
 */

/** True only when PAYPAL_ENV is exactly "sandbox". Anything else talks to live PayPal. */
export function isPayPalSandbox(): boolean {
  return process.env.PAYPAL_ENV === "sandbox";
}

export function isPayPalConfigured(): boolean {
  return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
}

function apiBase(): string {
  return isPayPalSandbox() ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

/** JS SDK v6 core script for the current environment. */
export function paypalWebSdkUrl(): string {
  return isPayPalSandbox() ? "https://www.sandbox.paypal.com/web-sdk/v6/core" : "https://www.paypal.com/web-sdk/v6/core";
}

function credentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set");
  return { clientId, clientSecret };
}

let sdk: { orders: OrdersController; payments: PaymentsController } | null = null;

function getSdk() {
  if (!sdk) {
    const { clientId, clientSecret } = credentials();
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: clientId, oAuthClientSecret: clientSecret },
      environment: isPayPalSandbox() ? Environment.Sandbox : Environment.Production,
      timeout: 0,
    });
    sdk = { orders: new OrdersController(client), payments: new PaymentsController(client) };
  }
  return sdk;
}

export function paypalOrders(): OrdersController {
  return getSdk().orders;
}

export function paypalPayments(): PaymentsController {
  return getSdk().payments;
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = credentials();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function requestToken(params: URLSearchParams): Promise<string> {
  const res = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`PayPal token request failed with HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal token response had no access_token");
  return data.access_token;
}

/** PayPal rejects domains[] for localhost and bare IPs, so only real domain names are sent. */
function isRealDomain(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "127.0.0.1" || host === "::1" || host === "[::1]") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return host.includes(".");
}

/** Strips the port from a Host header value ("shop.example.com:443" → "shop.example.com"). */
export function hostnameFromHostHeader(hostHeader: string | null): string {
  if (!hostHeader) return "";
  const first = hostHeader.split(",")[0].trim();
  if (first.startsWith("[")) return first.slice(0, first.indexOf("]") + 1);
  return first.split(":")[0];
}

/** Browser-safe client token for the JS SDK v6. */
export async function generateClientToken(hostname: string): Promise<string> {
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    response_type: "client_token",
    intent: "sdk_init",
  });
  if (isRealDomain(hostname)) params.append("domains[]", hostname);
  return requestToken(params);
}

const VERIFY_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

/**
 * Verifies a webhook delivery with PayPal. The raw request body is spliced
 * into the payload unchanged: re-serializing the parsed event can alter it
 * and break verification.
 */
export async function verifyWebhookSignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set");

  const fields: Record<string, string> = {};
  for (const [field, header] of Object.entries(VERIFY_HEADERS)) {
    const value = headers.get(header); // Headers.get is case-insensitive
    if (!value) return false;
    fields[field] = value;
  }
  if (!rawBody.trim()) return false;

  const prefix = JSON.stringify({ ...fields, webhook_id: webhookId });
  const payload = `${prefix.slice(0, -1)},"webhook_event":${rawBody}}`;

  const accessToken = await requestToken(new URLSearchParams({ grant_type: "client_credentials" }));
  const res = await fetch(`${apiBase()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: payload,
    cache: "no-store",
  });
  if (!res.ok) {
    console.error("[paypal webhook] verification call failed", res.status, await res.text());
    return false;
  }
  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === "SUCCESS";
}

export type PayPalErrorInfo = { status: number | null; issue: string | null; message: string | null };

/** Pulls the HTTP status and first `details[].issue` (e.g. INSTRUMENT_DECLINED) out of an SDK error. */
export function paypalErrorInfo(err: unknown): PayPalErrorInfo {
  if (!(err instanceof ApiError)) return { status: null, issue: null, message: null };

  let parsed: unknown = err.result;
  if (!parsed && typeof err.body === "string") {
    try {
      parsed = JSON.parse(err.body);
    } catch {
      parsed = null;
    }
  }
  const data = (parsed ?? {}) as { details?: { issue?: string; description?: string }[]; message?: string };
  const detail = Array.isArray(data.details) ? data.details[0] : undefined;
  return {
    status: err.statusCode,
    issue: detail?.issue ?? null,
    message: detail?.description ?? data.message ?? null,
  };
}
