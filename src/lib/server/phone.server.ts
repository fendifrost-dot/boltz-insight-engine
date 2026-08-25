/**
 * Phone normalization to E.164. Defaults to US (+1) when a 10-digit national
 * number is provided. Returns null when the input cannot be normalized.
 */

export function normalizeToE164(raw: string | null | undefined, defaultCountry = "US"): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) {
    const body = digits.slice(1).replace(/\D/g, "");
    if (body.length < 8 || body.length > 15) return null;
    if (!/^[1-9]/.test(body)) return null;
    return `+${body}`;
  }

  const onlyDigits = digits.replace(/\D/g, "");
  if (defaultCountry === "US" || defaultCountry === "CA") {
    if (onlyDigits.length === 10) return `+1${onlyDigits}`;
    if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) return `+${onlyDigits}`;
  }

  if (onlyDigits.length >= 8 && onlyDigits.length <= 15 && /^[1-9]/.test(onlyDigits)) {
    return `+${onlyDigits}`;
  }

  return null;
}

export function phonesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeToE164(a);
  const nb = normalizeToE164(b);
  if (!na || !nb) return false;
  return na === nb;
}
