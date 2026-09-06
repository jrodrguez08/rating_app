export type OperationalLogValue = string | number | boolean | null;

export type OperationalLogger = (message: string) => void;

export function emitOperationalLog(
  log: OperationalLogger,
  event: string,
  fields: Record<string, OperationalLogValue>,
): void {
  try {
    log(JSON.stringify({ event, ...fields }));
  } catch {
    // Operational logging is best-effort and must never alter synchronization.
  }
}
