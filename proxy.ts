import { NextResponse, type NextRequest } from "next/server";
import { isPayPalOrder } from "@/lib/payment-provider";

const REFUND_PATH = /^\/api\/admin\/orders\/([^/]+)\/refund\/?$/;

/** After auth: PayPal orders' refund action goes to the PayPal refund route; everything else is unchanged. */
async function routeAuthorized(request: NextRequest) {
  const match = request.method === "POST" ? REFUND_PATH.exec(request.nextUrl.pathname) : null;
  if (match) {
    const orderId = decodeURIComponent(match[1]);
    if (await isPayPalOrder(orderId)) {
      const target = request.nextUrl.clone();
      target.pathname = `/api/admin/orders/${encodeURIComponent(orderId)}/refund/paypal`;
      return NextResponse.rewrite(target);
    }
  }
  return NextResponse.next();
}

/** HTTP basic auth for the admin pages and admin API (user "admin", password ADMIN_PASSWORD). */
export async function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return new NextResponse("ADMIN_PASSWORD is not set", { status: 503 });

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, ...rest] = atob(encoded).split(":");
    if (user === "admin" && rest.join(":") === password) return routeAuthorized(request);
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Store admin"' },
  });
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
