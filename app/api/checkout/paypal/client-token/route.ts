import { NextResponse, type NextRequest } from "next/server";
import { generateClientToken, hostnameFromHostHeader } from "@/lib/paypal";

/** Browser-safe client token for the PayPal JS SDK v6. */
export async function GET(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
  try {
    const clientToken = await generateClientToken(hostnameFromHostHeader(host));
    return NextResponse.json({ clientToken }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[paypal client-token]", err);
    return NextResponse.json({ error: "PayPal is unavailable" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
