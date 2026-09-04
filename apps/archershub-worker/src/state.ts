export type WorkerState =
  | "AUTHENTICATED"
  | "WAITING_FOR_REAUTHENTICATION"
  | "PROVIDER_UNAVAILABLE";

export function errorCategory(error: unknown): WorkerState {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AUTHENTICATION_REQUIRED")) {
    return "WAITING_FOR_REAUTHENTICATION";
  }
  return "PROVIDER_UNAVAILABLE";
}
