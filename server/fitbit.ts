import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  CodeChallengeMethod,
  OAuth2Client,
  Credentials,
} from "google-auth-library";
import { atomicWrite } from "./atomic-write.js";
import type { RawMeasurement } from "./health-ingest.js";
import {
  emptyScaleExport, exportScalePoints, planScaleExport, SCALE_READ_SCOPE, SCALE_WRITE_SCOPE,
  ScaleRequestError, type ScaleExportState,
} from "./fitbit-scale.js";
import {
  addDays,
  list,
  localDate,
  mergeFitbitData,
  object,
  type FitbitSource,
  type FitbitSourceResult,
} from "./fitbit-data.js";
import type {
  FitbitDataResponse,
  FitbitDay,
  FitbitExercise,
  FitbitProfile,
} from "../src/fitbit-types.js";

const API = "https://health.googleapis.com/v4";
const PREFIX = "https://www.googleapis.com/auth/googlehealth.";
const WORKOUT_WRITE_SCOPE = `${PREFIX}activity_and_fitness.writeonly`;
const SCOPES = {
  activity: `${PREFIX}activity_and_fitness.readonly`,
  sleep: `${PREFIX}sleep.readonly`,
  vitals: `${PREFIX}health_metrics_and_measurements.readonly`,
};
const SOURCES: {
  source: FitbitSource;
  scope: keyof typeof SCOPES;
  rollup?: boolean;
}[] = [
  { source: "steps", scope: "activity", rollup: true },
  { source: "distance", scope: "activity", rollup: true },
  { source: "total-calories", scope: "activity", rollup: true },
  { source: "active-zone-minutes", scope: "activity", rollup: true },
  { source: "sleep", scope: "sleep" },
  { source: "heart-rate", scope: "vitals" },
  { source: "daily-heart-rate-zones", scope: "vitals" },
  { source: "daily-resting-heart-rate", scope: "vitals" },
  { source: "daily-heart-rate-variability", scope: "vitals" },
  { source: "daily-oxygen-saturation", scope: "vitals" },
  { source: "daily-respiratory-rate", scope: "vitals" },
  { source: "daily-sleep-temperature-derivations", scope: "vitals" },
  { source: "exercise", scope: "activity" },
];

type ProfileConfig = { userId: string; email: string; timezone: string };
type Settings = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  profiles: ProfileConfig[];
};
type StoredProfile = {
  subject: string;
  tokens: Credentials;
  days: FitbitDay[];
  exercises: FitbitExercise[];
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
  warnings: string[];
  scaleExport?: ScaleExportState;
};
type PendingAuth = {
  userId: string;
  verifier: string;
  cookie: string;
  expires: number;
  nonce: string;
};

class FitbitError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

function settingsFromEnvironment(): Settings | null {
  const credentialsFile = process.env.FITBIT_OAUTH_CREDENTIALS_FILE;
  const profilesFile = process.env.FITBIT_PROFILES_FILE;
  const redirectUri = process.env.FITBIT_REDIRECT_URI;
  if (!credentialsFile || !profilesFile || !redirectUri) return null;
  const credentials = object(
    object(JSON.parse(fs.readFileSync(credentialsFile, "utf8"))).web,
  );
  const profiles = list(
    object(JSON.parse(fs.readFileSync(profilesFile, "utf8"))).profiles,
  ).map((profile) => ({
    userId: String(profile.dashboardUser ?? ""),
    email: String(profile.email ?? "")
      .toLowerCase()
      .trim(),
    timezone: String(profile.timezone ?? "Europe/Moscow"),
  }));
  const url = new URL(redirectUri);
  if (
    url.pathname !== "/api/fitbit/oauth/callback" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    throw new Error("Invalid Fitbit redirect URI");
  }
  if (
    typeof credentials.client_id !== "string" ||
    typeof credentials.client_secret !== "string" ||
    !profiles.length
  )
    throw new Error("Invalid Fitbit configuration");
  const users = new Set<string>(),
    emails = new Set<string>();
  for (const profile of profiles) {
    if (
      !profile.userId ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email) ||
      users.has(profile.userId) ||
      emails.has(profile.email)
    )
      throw new Error("Invalid Fitbit profiles");
    new Intl.DateTimeFormat("en", { timeZone: profile.timezone });
    users.add(profile.userId);
    emails.add(profile.email);
  }
  return {
    clientId: credentials.client_id,
    clientSecret: credentials.client_secret,
    redirectUri,
    profiles,
  };
}

function civil(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return { date: { year, month, day } };
}

export function fitbitErrorMessage(code: string) {
  const messages: Record<string, string> = {
    configuration: "Проверьте настройки подключения Fitbit на сервере.",
    storage:
      "Не удалось прочитать сохранённые данные Fitbit. Проверьте хранилище на сервере.",
    reauthorize: "Доступ к Fitbit истёк. Подключите свой аккаунт повторно.",
    account: "Выберите Google-аккаунт, закреплённый за этим профилем.",
    account_link:
      "Сначала войдите с этим аккаунтом в Google Health на телефоне и синхронизируйте браслет.",
    scope: "Разрешите чтение хотя бы одной группы данных Fitbit.",
    state: "Ссылка подключения истекла. Начните подключение ещё раз.",
    cancelled: "Подключение отменено. Его можно повторить в любое время.",
    sync: "Fitbit временно недоступен. Сохранённые показатели доступны; повторите обновление позже.",
    rate_limit:
      "Google временно ограничил запросы. Обновление повторится автоматически.",
  };
  return messages[code] ?? messages.sync;
}

export function createFitbitIntegration(options: {
  getUsers: () => { id: string; name: string }[];
  getScaleMeasurements?: () => RawMeasurement[];
  onUpdate: () => void;
  onExercises?: (userId: string, exercises: FitbitExercise[], window: { start: string; end: string }) => void;
}) {
  const router = express.Router();
  const stateDir =
    process.env.FITBIT_STATE_DIR ||
    path.join(os.homedir(), ".local", "state", "health-dashboard", "fitbit");
  let settings: Settings | null = null;
  let configurationError = false;
  try {
    settings = settingsFromEnvironment();
  } catch {
    configurationError = true;
    console.error(
      "Fitbit configuration is invalid; check local credential and profile files.",
    );
  }
  const pending = new Map<string, PendingAuth>();
  const running = new Map<string, Promise<void>>();
  const transientErrors = new Map<string, string>();
  const scaleReruns = new Set<string>();
  const fullReruns = new Set<string>();
  const runningScaleOnly = new Set<string>();

  const fileFor = (userId: string) =>
    path.join(
      stateDir,
      `${createHash("sha256").update(userId).digest("hex").slice(0, 24)}.json`,
    );
  function read(userId: string): StoredProfile | null {
    const filename = fileFor(userId);
    if (!fs.existsSync(filename)) return null;
    const stored = JSON.parse(
      fs.readFileSync(filename, "utf8"),
    ) as StoredProfile;
    if (
      !stored.subject ||
      !stored.tokens ||
      !Array.isArray(stored.days) ||
      !Array.isArray(stored.exercises) ||
      (stored.scaleExport && (!stored.scaleExport.records || typeof stored.scaleExport.records !== "object" || Array.isArray(stored.scaleExport.records)))
    )
      throw new FitbitError("storage");
    return stored;
  }
  function write(userId: string, stored: StoredProfile) {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    atomicWrite(fileFor(userId), `${JSON.stringify(stored)}\n`);
    fs.chmodSync(fileFor(userId), 0o600);
  }
  async function client() {
    if (!settings) throw new FitbitError("configuration");
    const { OAuth2Client } = await import("google-auth-library");
    return new OAuth2Client({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: settings.redirectUri,
    });
  }
  function profileConfig(userId: string) {
    return settings?.profiles.find((profile) => profile.userId === userId);
  }
  function knownUser(userId: string) {
    return options.getUsers().some((user) => user.id === userId);
  }

  function snapshot(): FitbitDataResponse {
    return {
      generatedAt: new Date().toISOString(),
      profiles: options.getUsers().map((user): FitbitProfile => {
        let stored: StoredProfile | null = null;
        let storageError = false;
        try {
          stored = read(user.id);
        } catch {
          storageError = true;
        }
        const canConnect = Boolean(settings && profileConfig(user.id));
        const errorCode = storageError
          ? "storage"
          : (transientErrors.get(user.id) ??
            (configurationError || (stored && !canConnect)
              ? "configuration"
              : stored?.error));
        return {
          userId: user.id,
          name: user.name,
          canConnect,
          canDeleteWorkouts: Boolean(canConnect && stored?.tokens.scope?.split(" ").includes(WORKOUT_WRITE_SCOPE) &&
            errorCode !== "reauthorize"),
          status: running.has(user.id)
            ? "syncing"
            : errorCode === "reauthorize"
              ? "reauthorize"
              : errorCode
                ? "error"
                : stored
                  ? "connected"
                  : canConnect
                    ? "disconnected"
                    : "not_configured",
          lastSyncAt: stored?.lastSyncAt ?? null,
          lastAttemptAt: stored?.lastAttemptAt ?? null,
          error: errorCode ? fitbitErrorMessage(errorCode) : null,
          warnings: stored?.warnings ?? [],
          days: stored?.days ?? [],
          exercises: stored?.exercises ?? [],
          scaleSync: scaleSnapshot(user.id, stored),
        };
      }),
    };
  }

  function scaleSnapshot(userId: string, stored: StoredProfile | null): FitbitProfile["scaleSync"] {
    if (!options.getScaleMeasurements) return undefined;
    const state = stored?.scaleExport;
    let total = 0, synced = 0, skipped = 0;
    let sourceError = false;
    try {
      const plan = planScaleExport(options.getScaleMeasurements(), userId, profileConfig(userId)?.timezone ?? "UTC");
      total = plan.points.length;
      skipped = plan.skipped;
      synced = plan.points.filter((point) => state?.records[point.key]?.fingerprint === point.fingerprint && !state.records[point.key]?.pending).length;
    } catch { sourceError = true; }
    const scopes = new Set((stored?.tokens.scope ?? "").split(" "));
    const permission = scopes.has(SCALE_WRITE_SCOPE) && scopes.has(SCALE_READ_SCOPE);
    const code = sourceError ? "source" : state?.error;
    const messages: Record<string, string> = {
      source: "Не удалось прочитать измерения Xiaomi. Отправка повторится после восстановления источника.",
      scope: "Разрешите передачу измерений Xiaomi через повторное подключение Fitbit.",
      reauthorize: "Подключите Fitbit снова, чтобы продолжить передачу измерений Xiaomi.",
      confirming: "Проверяем, сохранил ли Fitbit отправленные измерения. Повторная запись ожидает подтверждения.",
      invalid: "Fitbit отклонил часть показателей. Остальные измерения продолжают отправляться.",
      missing: "Запись Fitbit удалена. Восстановим её при следующем обновлении.",
      rate_limit: "Fitbit ограничил частоту запросов. Отправка продолжится автоматически.",
      sync: "Не удалось отправить часть измерений Xiaomi. Проверка и отправка повторятся автоматически.",
    };
    return {
      status: !stored ? "disconnected" : !permission || code === "scope" || code === "reauthorize" ? "permission_required"
        : running.has(userId) ? "syncing" : code && code !== "confirming" ? "error" : synced < total ? "pending" : "synced",
      total, synced, pending: total - synced, skipped,
      lastSyncAt: state?.lastSyncAt ?? null, lastMeasurementAt: state?.lastMeasurementAt ?? null,
      error: code ? messages[code] ?? messages.sync : null,
    };
  }

  async function request(
    oauth: OAuth2Client,
    endpoint: string,
    body?: unknown,
    writeMethod?: "POST" | "PATCH",
  ) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let token: string | null | undefined;
      try {
        token = (await oauth.getAccessToken()).token;
      } catch (error) {
        const data = object(object(object(error).response).data);
        if (data.error === "invalid_grant")
          throw new FitbitError("reauthorize");
        throw new FitbitError("sync");
      }
      if (!token) throw new FitbitError("reauthorize");
      let response: Response;
      try { response = await fetch(`${API}/${endpoint}`, {
        method: writeMethod ?? (body ? "POST" : "GET"),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(25_000),
      }); } catch {
        if (writeMethod) throw new ScaleRequestError("sync");
        throw new FitbitError("sync");
      }
      if (response.ok) return object(await response.json());
      if (writeMethod) {
        // POSTs have server-assigned IDs and must not be retried after an ambiguous failure.
        throw new ScaleRequestError(response.status === 401 ? "reauthorize" : response.status === 403 ? "scope"
          : response.status === 429 ? "rate_limit" : response.status === 400 || response.status === 422 ? "invalid"
            : response.status === 404 ? "missing" : "sync", response.status >= 400 && response.status < 500 && response.status !== 408);
      }
      if (response.status === 401) throw new FitbitError("reauthorize");
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        const wait = Math.min(
          15_000,
          Math.max(
            1_000 * 2 ** attempt,
            Number(response.headers.get("retry-after") || 0) * 1000,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      if (response.status === 429) throw new FitbitError("rate_limit");
      if (response.status === 403) throw new FitbitError("scope");
      if (response.status === 400) {
        const error = object(object(await response.json()).error);
        if (
          list(error.details).some(
            (detail) => detail.reason === "ACCOUNT_NOT_LINKED",
          )
        )
          throw new FitbitError("account_link");
      }
      throw new FitbitError("sync");
    }
    throw new FitbitError("sync");
  }

  async function fetchSource(
    oauth: OAuth2Client,
    source: FitbitSource,
    start: string,
    end: string,
    rollup: boolean,
  ) {
    const points: Record<string, unknown>[] = [];
    // Bound the larger pulse stream to one day; other sources support 14-day windows.
    const chunkDays = source === "heart-rate" ? 1 : 14;
    for (
      let chunkStart = start;
      chunkStart < end;
      chunkStart = addDays(chunkStart, chunkDays)
    ) {
      const chunkEnd =
        addDays(chunkStart, chunkDays) < end ? addDays(chunkStart, chunkDays) : end;
      let pageToken: string | undefined;
      const seenTokens = new Set<string>();
      do {
        const endpoint = `users/me/dataTypes/${source}/dataPoints`;
        let response: Record<string, unknown>;
        if (rollup) {
          response = await request(oauth, `${endpoint}:dailyRollUp`, {
            range: { start: civil(chunkStart), end: civil(chunkEnd) },
            windowSizeDays: 1,
            dataSourceFamily: "users/me/dataSourceFamilies/google-wearables",
            ...(pageToken ? { pageToken } : {}),
          });
          points.push(...list(response.rollupDataPoints));
        } else {
          const field = source.replaceAll("-", "_");
          const dateField =
            source === "sleep"
              ? "sleep.interval.civil_end_time"
              : source === "exercise"
                ? "exercise.interval.civil_start_time"
                : source === "heart-rate"
                  ? "heart_rate.sample_time.civil_time"
                  : `${field}.date`;
          const query = new URLSearchParams({
            filter: `${dateField} >= "${chunkStart}" AND ${dateField} < "${chunkEnd}"`,
            pageSize: source === "heart-rate" ? "10000" : "1000",
          });
          if (source === "sleep" || source === "exercise")
            query.set("pageSize", "25");
          query.set(
            "dataSourceFamily",
            "users/me/dataSourceFamilies/google-wearables",
          );
          if (pageToken) query.set("pageToken", pageToken);
          response = await request(oauth, `${endpoint}:reconcile?${query}`);
          points.push(...list(response.dataPoints));
        }
        pageToken =
          typeof response.nextPageToken === "string" && response.nextPageToken
            ? response.nextPageToken
            : undefined;
        if (pageToken && seenTokens.has(pageToken))
          throw new FitbitError("sync");
        if (pageToken) seenTokens.add(pageToken);
        if (seenTokens.size > 500) throw new FitbitError("sync");
      } while (pageToken);
    }
    return { source, points };
  }

  async function performSync(userId: string, scaleOnly = false) {
    const config = profileConfig(userId);
    if (!config) return;
    let stored = read(userId);
    if (!stored) return;
    const subject = stored.subject;
    if (!scaleOnly) {
      stored.lastAttemptAt = new Date().toISOString();
      stored.error = null;
      write(userId, stored);
    }
    const oauth = await client();
    oauth.setCredentials(stored.tokens);
    oauth.on("tokens", (tokens) => {
      const current = read(userId);
      if (current?.subject === subject) {
        current.tokens = { ...current.tokens, ...tokens, id_token: undefined };
        write(userId, current);
      }
    });
    try {
      if (options.getScaleMeasurements && settings) {
        const granted = new Set((stored.tokens.scope ?? "").split(" "));
        if (granted.has(SCALE_READ_SCOPE) && granted.has(SCALE_WRITE_SCOPE)) {
          try {
            const plan = planScaleExport(options.getScaleMeasurements(), userId, config.timezone);
            await exportScalePoints({
              points: plan.points, state: stored.scaleExport ?? emptyScaleExport(), clientId: settings.clientId,
              request: async (endpoint, method, body) => {
                try { return await request(oauth, endpoint, body, method === "GET" ? undefined : method); }
                catch (error) {
                  if (error instanceof FitbitError) throw new ScaleRequestError(error.code, true);
                  throw error;
                }
              },
              save: (state) => {
                const current = read(userId);
                if (current?.subject !== subject) throw new ScaleRequestError("reauthorize", true);
                current.scaleExport = state;
                write(userId, current);
              },
            });
          } catch {
            const current = read(userId);
            if (current?.subject === subject) {
              current.scaleExport ??= emptyScaleExport();
              current.scaleExport.error = "source";
              write(userId, current);
            }
          }
        }
      }
      if (scaleOnly) return;
      const today = localDate(new Date(), config.timezone);
      const lastDate = stored.lastSyncAt
        ? localDate(new Date(stored.lastSyncAt), config.timezone)
        : null;
      const start =
        !lastDate || lastDate < addDays(today, -29)
          ? addDays(today, -29)
          : lastDate < addDays(today, -13)
            ? addDays(lastDate, -2)
            : addDays(today, -13);
      const end = addDays(today, 1);
      const granted = new Set((stored.tokens.scope ?? "").split(" "));
      const results: FitbitSourceResult[] = [];
      const failed = new Set<string>();
      for (const definition of SOURCES) {
        if (!granted.has(SCOPES[definition.scope])) {
          failed.add(definition.scope);
          continue;
        }
        try {
          // Intraday history is backfilled once; subsequent passes reread three days.
          const sourceStart = definition.source === "heart-rate" &&
            stored.days.some((day) => day.heartRate?.length) &&
            lastDate !== null && lastDate >= addDays(today, -2)
            ? addDays(today, -2) : start;
          results.push({
            ...await fetchSource(oauth, definition.source, sourceStart, end, definition.rollup === true),
            windowStart: sourceStart,
          });
        } catch (error) {
          if (
            error instanceof FitbitError &&
            ["reauthorize", "rate_limit", "account_link"].includes(error.code)
          )
            throw error;
          failed.add(definition.scope);
        }
      }
      if (!results.length) throw new FitbitError("sync");
      // Token refreshes may have changed credentials while data was downloading.
      stored = read(userId)!;
      if (stored.subject !== subject) return;
      const merged = mergeFitbitData(
        stored,
        results,
        start,
        end,
        config.timezone,
      );
      const scopeLabels: Record<string, string> = {
        activity: "активность",
        sleep: "сон",
        vitals: "показатели организма",
      };
      write(userId, {
        ...stored,
        ...merged,
        error: null,
        lastSyncAt: new Date().toISOString(),
        warnings: failed.size
          ? [
              `Часть данных не обновилась: ${[...failed].map((scope) => scopeLabels[scope]).join(", ")}. Проверьте разрешения или повторите обновление позже. Сохранённые значения показаны, если они есть.`,
            ]
          : [],
      });
      if (results.some((result) => result.source === "exercise")) {
        options.onExercises?.(userId, merged.exercises, { start, end });
      }
      transientErrors.delete(userId);
    } catch (error) {
      const current = read(userId);
      if (current?.subject === subject)
        write(userId, {
          ...current,
          error: error instanceof FitbitError ? error.code : "sync",
        });
    }
  }

  function sync(userId: string, scaleOnly = false) {
    if (running.has(userId)) {
      if (scaleOnly) scaleReruns.add(userId);
      else if (runningScaleOnly.has(userId)) fullReruns.add(userId);
      return running.get(userId)!;
    }
    if (scaleOnly) runningScaleOnly.add(userId);
    const task = Promise.resolve()
      .then(async () => {
        await performSync(userId, scaleOnly);
        // An ingest arriving during a scan gets a second pass with the newest source.
        while (scaleReruns.has(userId) || fullReruns.has(userId)) {
          const full = fullReruns.delete(userId);
          scaleReruns.delete(userId);
          if (full) runningScaleOnly.delete(userId);
          else runningScaleOnly.add(userId);
          await performSync(userId, !full);
        }
      })
      .catch(() => {
        transientErrors.set(userId, "storage");
      })
      .finally(() => {
        running.delete(userId);
        runningScaleOnly.delete(userId);
        scaleReruns.delete(userId);
        fullReruns.delete(userId);
        options.onUpdate();
      });
    running.set(userId, task);
    options.onUpdate();
    return task;
  }

  router.get("/fitbit-data", (_request, response) => response.json(snapshot()));
  router.post("/fitbit/:userId/refresh", (request, response) => {
    const userId = String(request.params.userId);
    if (!knownUser(userId)) {
      response.status(404).json({ error: "Профиль не найден" });
      return;
    }
    try {
      const stored = read(userId);
      if (!stored || !profileConfig(userId)) {
        response.status(409).json({ error: "Сначала подключите Fitbit" });
        return;
      }
      if (
        runningScaleOnly.has(userId) || (!running.has(userId) &&
        (!stored.lastAttemptAt ||
          Date.now() - Date.parse(stored.lastAttemptAt) > 60_000))
      )
        void sync(userId);
      response.status(202).json(snapshot());
    } catch {
      response.status(503).json({ error: fitbitErrorMessage("storage") });
    }
  });

  router.post("/fitbit/:userId/connect", async (request, response) => {
    const userId = String(request.params.userId);
    const config = profileConfig(userId);
    if (!knownUser(userId) || !settings || !config) {
      response
        .status(503)
        .json({ error: "Подключение Fitbit ещё не настроено" });
      return;
    }
    if (request.headers.origin !== new URL(settings.redirectUri).origin) {
      response
        .status(403)
        .json({ error: "Откройте дашборд по адресу подключения Fitbit" });
      return;
    }
    if (running.has(userId)) {
      response
        .status(409)
        .json({ error: "Дождитесь завершения синхронизации" });
      return;
    }
    for (const [state, auth] of pending)
      if (auth.expires < Date.now()) pending.delete(state);
    if (pending.size >= 50) {
      response
        .status(429)
        .json({ error: "Повторите подключение через несколько минут" });
      return;
    }
    try {
      const oauth = await client();
      const { codeVerifier, codeChallenge } =
        await oauth.generateCodeVerifierAsync();
      const state = randomBytes(32).toString("base64url"),
        cookie = randomBytes(32).toString("base64url"),
        nonce = randomBytes(32).toString("base64url");
      pending.set(state, {
        userId,
        verifier: codeVerifier,
        cookie,
        nonce,
        expires: Date.now() + 10 * 60_000,
      });
      response.cookie(`fitbit_oauth_${state.slice(0, 16)}`, cookie, {
        httpOnly: true,
        sameSite: "lax",
        secure: settings.redirectUri.startsWith("https:"),
        path: "/api/fitbit/oauth/callback",
        maxAge: 10 * 60_000,
      });
      response.json({
        url: oauth.generateAuthUrl({
          access_type: "offline",
          scope: ["openid", "email", ...Object.values(SCOPES),
            ...(options.getScaleMeasurements ? [SCALE_WRITE_SCOPE] : []),
            ...(request.query.workoutDeletion === "true" ? [WORKOUT_WRITE_SCOPE] : [])],
          include_granted_scopes: true,
          state,
          nonce,
          login_hint: config.email,
          prompt: "consent select_account",
          code_challenge: codeChallenge,
          code_challenge_method: "S256" as CodeChallengeMethod,
        }),
      });
    } catch {
      response.status(503).json({ error: fitbitErrorMessage("configuration") });
    }
  });

  router.get("/fitbit/oauth/callback", async (request, response) => {
    response.setHeader("Referrer-Policy", "no-referrer");
    if (!settings) {
      response.status(503).send("Fitbit connection is not configured");
      return;
    }
    const state =
      typeof request.query.state === "string" ? request.query.state : "";
    const auth = pending.get(state);
    const cookieName = `fitbit_oauth_${state.slice(0, 16)}`;
    const cookie =
      request.headers.cookie
        ?.split(";")
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? "";
    const target = new URL("/", settings.redirectUri);
    function finish(result: string) {
      target.searchParams.set("fitbit", result);
      if (auth) target.searchParams.set("fitbitUser", auth.userId);
      response.redirect(303, target.toString());
    }
    if (
      !auth ||
      auth.expires < Date.now() ||
      Buffer.byteLength(cookie) !== Buffer.byteLength(auth.cookie) ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(auth.cookie))
    ) {
      finish("state");
      return;
    }
    pending.delete(state);
    response.clearCookie(cookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: settings.redirectUri.startsWith("https:"),
      path: "/api/fitbit/oauth/callback",
    });
    if (request.query.error) {
      finish("cancelled");
      return;
    }
    try {
      if (typeof request.query.code !== "string")
        throw new FitbitError("state");
      if (running.has(auth.userId)) throw new FitbitError("sync");
      const oauth = await client();
      const { tokens } = await oauth.getToken({
        code: request.query.code,
        codeVerifier: auth.verifier,
      });
      if (!tokens.id_token) throw new FitbitError("account");
      const ticket = await oauth.verifyIdToken({
        idToken: tokens.id_token,
        audience: settings.clientId,
      });
      const identity = ticket.getPayload();
      if (
        !identity?.email_verified ||
        identity.email?.toLowerCase() !== profileConfig(auth.userId)?.email ||
        object(identity).nonce !== auth.nonce
      )
        throw new FitbitError("account");
      for (const other of options.getUsers())
        if (
          other.id !== auth.userId &&
          read(other.id)?.subject === identity.sub
        )
          throw new FitbitError("account");
      const previous = read(auth.userId);
      if (previous && previous.subject !== identity.sub)
        throw new FitbitError("account");
      if (!tokens.refresh_token && !previous?.tokens.refresh_token)
        throw new FitbitError("reauthorize");
      if (
        !Object.values(SCOPES).some((scope) =>
          tokens.scope?.split(" ").includes(scope),
        )
      )
        throw new FitbitError("scope");
      oauth.setCredentials(tokens);
      await requestIdentity(oauth);
      write(auth.userId, {
        subject: identity.sub,
        tokens: {
          ...tokens,
          refresh_token: tokens.refresh_token ?? previous?.tokens.refresh_token,
          id_token: undefined,
        },
        days: previous?.days ?? [],
        exercises: previous?.exercises ?? [],
        lastSyncAt: previous?.lastSyncAt ?? null,
        lastAttemptAt: null,
        error: null,
        warnings: [],
        scaleExport: previous?.scaleExport,
      });
      transientErrors.delete(auth.userId);
      void sync(auth.userId);
      finish("connected");
    } catch (error) {
      finish(error instanceof FitbitError ? error.code : "sync");
    }
  });

  async function requestIdentity(oauth: OAuth2Client) {
    await request(oauth, "users/me/identity");
  }

  async function syncAll() {
    if (!settings) return;
    for (const profile of settings.profiles) {
      if (!knownUser(profile.userId)) continue;
      try {
        const stored = read(profile.userId);
        if (stored && stored.error !== "reauthorize")
          await sync(profile.userId);
      } catch {
        transientErrors.set(profile.userId, "storage");
      }
    }
  }
  let timer: NodeJS.Timeout | undefined;
  let scaleTimer: NodeJS.Timeout | undefined;
  let stopped = false;
  async function syncScaleAll() {
    if (!settings || stopped) return;
    for (const profile of settings.profiles) {
      if (!knownUser(profile.userId)) continue;
      try {
        const stored = read(profile.userId);
        if (stored && stored.error !== "reauthorize") await sync(profile.userId, true);
      } catch { transientErrors.set(profile.userId, "storage"); }
    }
  }
  function scheduleScaleSync() {
    if (!options.getScaleMeasurements || !settings || stopped || process.env.FITBIT_SYNC_ENABLED === "false") return;
    if (scaleTimer) clearTimeout(scaleTimer);
    scaleTimer = setTimeout(() => {
      scaleTimer = undefined;
      void syncScaleAll().finally(() => {
        if (!stopped && !scaleTimer) {
          scaleTimer = setTimeout(scheduleScaleSync, 60_000);
          scaleTimer.unref();
        }
      });
    }, 500);
    scaleTimer.unref();
  }
  return {
    router,
    snapshot,
    async deleteExercises(userId: string, ids: string[]) {
      try {
        const stored = read(userId);
        if (!stored || !profileConfig(userId) ||
            !stored.tokens.scope?.split(" ").includes(WORKOUT_WRITE_SCOPE)) {
          return { status: "permission_required", message: "Календарь очищен. Для удаления в Fitbit подключите аккаунт с разрешением на удаление тренировок." };
        }
        if (!ids.length || ids.some((id) => !/^users\/[^/]+\/dataTypes\/exercise\/dataPoints\/[^/]+$/.test(id))) {
          return { status: "failed", message: "Календарь очищен. Удалите запись в приложении Fitbit: у неё отсутствует идентификатор для удаления." };
        }
        const oauth = await client();
        oauth.setCredentials(stored.tokens);
        oauth.on("tokens", (tokens) => {
          const current = read(userId);
          if (current?.subject === stored.subject) {
            current.tokens = { ...current.tokens, ...tokens, id_token: undefined };
            write(userId, current);
          }
        });
        const operation = await request(oauth, "users/me/dataTypes/exercise/dataPoints:batchDelete", { names: ids });
        if (operation.error || operation.done !== true) {
          return { status: operation.error ? "failed" : "pending", message: operation.error
            ? "Календарь очищен. Fitbit отклонил удаление. Удалите тренировку в приложении Fitbit."
            : "Календарь очищен. Запрос на удаление передан в Fitbit; завершение пока не подтверждено." };
        }
        return { status: "deleted", message: "Тренировки удалены из календаря и Fitbit." };
      } catch {
        return { status: "failed", message: "Календарь очищен. Удаление в Fitbit не удалось. Удалите тренировку в приложении Fitbit; в календарь она больше не загрузится." };
      }
    },
    scaleDataChanged: scheduleScaleSync,
    start() {
      if (!settings || timer || process.env.FITBIT_SYNC_ENABLED === "false")
        return;
      stopped = false;
      scheduleScaleSync();
      // Schedule the next pass after the current one finishes to avoid overlapping scans.
      const run = () => {
        void syncAll().finally(() => {
          if (stopped) return;
          timer = setTimeout(run, 15 * 60_000);
          timer.unref();
        });
      };
      timer = setTimeout(run, 2_000);
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (scaleTimer) clearTimeout(scaleTimer);
      timer = undefined;
      scaleTimer = undefined;
    },
  };
}
