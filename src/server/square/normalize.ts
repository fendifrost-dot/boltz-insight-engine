/** Digits used for lead matching. US numbers collapse to 10 digits. */
export function phoneKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length >= 8 && digits.length <= 15) return digits;
  return null;
}

/** E.164 storage form. Returns null when the value is not a usable phone. */
export function phoneE164(raw: string | null | undefined): string | null {
  const key = phoneKey(raw);
  if (!key) return null;
  if (key.length === 10) return `+1${key}`;
  return `+${key}`;
}

export function emailKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 320) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function phoneLookupValues(raw: string | null | undefined): string[] {
  const stored = phoneE164(raw);
  const key = phoneKey(raw);
  const values = new Set<string>();
  if (stored) values.add(stored);
  if (key && key.length === 10) {
    values.add(key);
    values.add(`1${key}`);
    values.add(`+1${key}`);
  }
  return [...values];
}
