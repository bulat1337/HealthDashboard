import type { HealthDataResponse } from "./types";

export async function fetchHealthData(signal?: AbortSignal): Promise<HealthDataResponse> {
  const response = await fetch("/api/health-data", { signal });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<HealthDataResponse>;
}

export async function refreshMoneyData(signal?: AbortSignal) {
  const response = await fetch("/api/money-data/refresh", {
    method: "POST",
    signal
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

export async function updatePartnerMoneyData(
  input: { partnerMoney: number; partnerCreditCardDebt: number },
  signal?: AbortSignal
) {
  const response = await fetch("/api/money-data/partner", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input),
    signal
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<unknown>;
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
