import type {
  HealthDataResponse,
  MoneyRecordUpdate,
  SportActivityKey,
  SportDataResponse,
  SportMaxReps,
  SportWorkoutDelete
} from "./types";
import type { FitbitDataResponse } from "./fitbit-types";

async function fitbitRequest(url: string, method: "GET" | "POST", signal?: AbortSignal) {
  const response = await fetch(url, { method, signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(error.error || "Не удалось загрузить Fitbit. Попробуйте ещё раз.");
  }
  return response;
}

export async function fetchFitbitData(signal?: AbortSignal): Promise<FitbitDataResponse> {
  return (await fitbitRequest("/api/fitbit-data", "GET", signal)).json();
}

export async function refreshFitbitData(userId: string): Promise<FitbitDataResponse> {
  return (await fitbitRequest(`/api/fitbit/${encodeURIComponent(userId)}/refresh`, "POST")).json();
}

export async function connectFitbit(userId: string, workoutDeletion = false): Promise<string> {
  const result = await (await fitbitRequest(`/api/fitbit/${encodeURIComponent(userId)}/connect${workoutDeletion ? "?workoutDeletion=true" : ""}`, "POST")).json() as { url: string };
  return result.url;
}

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

export async function fetchSportData(signal?: AbortSignal): Promise<SportDataResponse> {
  const response = await fetch("/api/sport-data", { signal });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<SportDataResponse>;
}

export async function deleteSportWorkouts(input: SportWorkoutDelete) {
  const response = await fetch("/api/sport-data/workouts/delete", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Не удалось удалить тренировку. Попробуйте ещё раз.");
  return result as { data: SportDataResponse["data"]; provider: { status: string; message: string } };
}

export async function updateSportDay(
  input: {
    userId: string;
    date: string;
    sick?: boolean;
    activities: SportActivityKey[];
    runDistanceKm?: number | null;
    maxReps?: SportMaxReps;
  },
  signal?: AbortSignal
) {
  const response = await fetch("/api/sport-data/day", {
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
  return response.json() as Promise<{ ok: true; updatedAt: string; data: SportDataResponse["data"] }>;
}

export async function updateMoneyRecordData(rowId: number, input: MoneyRecordUpdate, signal?: AbortSignal) {
  const response = await fetch(`/api/money-data/records/${rowId}`, {
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
