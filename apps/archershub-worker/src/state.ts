export type WorkerState =
  | "AUTHENTICATED"
  | "WAITING_FOR_REAUTHENTICATION"
  | "PROVIDER_UNAVAILABLE"
  | "PUBLICATION_FAILED";

export function errorCategory(error: unknown): WorkerState {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("AUTHENTICATION_REQUIRED")) {
    return "WAITING_FOR_REAUTHENTICATION";
  }
  if (message.includes("PUBLICATION_ERROR")) return "PUBLICATION_FAILED";
  return "PROVIDER_UNAVAILABLE";
}
