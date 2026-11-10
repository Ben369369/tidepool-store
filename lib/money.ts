export function formatCents(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * Integer cents → decimal string with two places (1999 → "19.99"), as payment
 * APIs like PayPal expect. Integer math only, so there is no floating-point drift.
 */
export function centsToDecimalString(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error(`Invalid cents amount: ${cents}`);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

/**
 * Decimal string → integer cents ("19.99" → 1999, "20" → 2000, "7.5" → 750).
 * Parses the integer and fraction parts separately; never goes through a float.
 */
export function decimalStringToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid decimal amount: ${value}`);
  const whole = Number.parseInt(match[1], 10);
  const fraction = Number.parseInt((match[2] ?? "").padEnd(2, "0"), 10);
  const cents = whole * 100 + fraction;
  if (!Number.isSafeInteger(cents)) throw new Error(`Amount out of range: ${value}`);
  return cents;
}
