import type { HealthDataResponse } from "./types";

export async function fetchHealthData(signal?: AbortSignal): Promise<HealthDataResponse> {
  const response = await fetch("/api/health-data", { signal });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<HealthDataResponse>;
}

export function openHealthSocket(onMessage: (message: unknown) => void) {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}/ws`);
  socket.addEventListener("message", (event) => {
    try {
      onMessage(JSON.parse(event.data));
    } catch {
      onMessage({ type: "unknown", raw: event.data });
    }
  });
  return socket;
}
