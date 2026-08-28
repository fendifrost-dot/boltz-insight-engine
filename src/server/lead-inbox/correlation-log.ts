/** Structured server logs keyed by correlation id without message bodies or secrets. */
export function logCorrelation(
  correlationId: string | null | undefined,
  event: string,
  fields?: Record<string, unknown>,
): void {
  const payload = {
    correlation_id: correlationId ?? null,
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
}
