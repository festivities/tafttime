export type Notifier = (title: string, message: string) => Promise<void>;

export function createNtfyNotifier(
  topic: string | undefined,
  server = "https://ntfy.sh",
  token?: string
): Notifier {
  return async (title, message) => {
    if (!topic) return;

    const headers: Record<string, string> = {
      "Content-Type": "text/plain; charset=utf-8",
      Title: title,
      Priority: "high",
      Tags: "tafttime,archershub",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${server.replace(/\/$/, "")}/${topic}`, {
      method: "POST",
      headers,
      body: message,
    });
    if (!response.ok) {
      throw new Error(`ntfy returned HTTP ${response.status}`);
    }
  };
}

export async function notifySafely(
  notify: Notifier,
  title: string,
  message: string
): Promise<void> {
  try {
    await notify(title, message);
  } catch (error) {
    console.error(
      `Notification failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
  }
}
