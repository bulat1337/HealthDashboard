import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { after, test, mock } from "node:test";
import { once } from "node:events";
import express from "express";
import { OAuth2Client } from "google-auth-library";
import { createFitbitIntegration } from "../server/fitbit.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fitbit-test-"));
const users = [
  { id: "User A", name: "User A" },
  { id: "User B", name: "User B" },
];
const credentials = path.join(directory, "oauth.json"),
  profiles = path.join(directory, "profiles.json");
fs.writeFileSync(
  credentials,
  JSON.stringify({
    web: {
      client_id: "test.apps.googleusercontent.com",
      client_secret: "fixture-secret",
    },
  }),
);
fs.writeFileSync(
  profiles,
  JSON.stringify({
    profiles: users.map((user, index) => ({
      dashboardUser: user.id,
      email: `user${index}@example.com`,
      timezone: "Europe/Moscow",
    })),
  }),
);
const keys = [
  "FITBIT_OAUTH_CREDENTIALS_FILE",
  "FITBIT_PROFILES_FILE",
  "FITBIT_REDIRECT_URI",
  "FITBIT_STATE_DIR",
];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
const nativeFetch = globalThis.fetch;
const app = express();
const server = http.createServer(app);
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.FITBIT_OAUTH_CREDENTIALS_FILE = credentials;
process.env.FITBIT_PROFILES_FILE = profiles;
process.env.FITBIT_REDIRECT_URI = `${origin}/api/fitbit/oauth/callback`;
process.env.FITBIT_STATE_DIR = path.join(directory, "state");
const integration = createFitbitIntegration({
  getUsers: () => users,
  onUpdate: () => {},
  onExercises: (userId, exercises, window) => calendarSyncs.push({ userId, exercises, window }),
});
const calendarSyncs: { userId: string; exercises: unknown[]; window: { start: string; end: string } }[] = [];
app.use(express.json());
app.use("/api", integration.router);
let verifiedEmail = "user0@example.com",
  verifiedSubject = "subject-a",
  nonce = "";
let denyScope = false;
let denyExercise = false;
let unauthorized = false;
let requested: string[] = [];
const scope = [
  "activity_and_fitness",
  "sleep",
  "health_metrics_and_measurements",
]
  .map(
    (group) => `https://www.googleapis.com/auth/googlehealth.${group}.readonly`,
  )
  .join(" ");
mock.method(OAuth2Client.prototype, "getToken", async () => ({
  tokens: {
    access_token: "fixture-access",
    refresh_token: "fixture-refresh",
    id_token: "fixture-id",
    scope,
    expiry_date: Date.now() + 3600_000,
  },
}));
mock.method(OAuth2Client.prototype, "verifyIdToken", async () => ({
  getPayload: () => ({
    sub: verifiedSubject,
    email: verifiedEmail,
    email_verified: true,
    nonce,
  }),
}));
mock.method(OAuth2Client.prototype, "getAccessToken", async () => ({
  token: "fixture-access",
}));
mock.method(
  globalThis,
  "fetch",
  async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.origin !== "https://health.googleapis.com")
      throw new Error("Unexpected external request");
    requested.push(url.pathname);
    if (unauthorized) return new Response("{}", { status: 401 });
    if (denyScope && url.pathname.includes("daily-heart-rate-variability"))
      return new Response("{}", { status: 403 });
    if (denyExercise && url.pathname.includes("/exercise/"))
      return new Response("{}", { status: 403 });
    if (url.pathname.endsWith("/identity"))
      return Response.json({ healthUserId: "health-a" });
    if (url.pathname.includes("steps")) {
      const body = JSON.parse(String(init?.body));
      const date = body.range.start.date;
      assert.ok(body.range.end);
      assert.equal(
        body.dataSourceFamily,
        "users/me/dataSourceFamilies/google-wearables",
      );
      return Response.json({
        rollupDataPoints: [
          { civilStartTime: { date }, steps: { countSum: "1234" } },
        ],
      });
    }
    if (url.pathname.endsWith(":reconcile")) {
      assert.equal(
        url.searchParams.get("dataSourceFamily"),
        "users/me/dataSourceFamilies/google-wearables",
      );
      if (url.pathname.includes("/sleep/"))
        assert.match(
          url.searchParams.get("filter")!,
          /sleep.interval.civil_end_time/,
        );
      if (url.pathname.includes("/heart-rate/")) {
        assert.match(url.searchParams.get("filter")!, /heart_rate.sample_time.civil_time/);
        assert.equal(url.searchParams.get("pageSize"), "10000");
      }
      return Response.json({ dataPoints: [] });
    }
    return Response.json({ rollupDataPoints: [] });
  },
);

after(async () => {
  integration.stop();
  server.close();
  await once(server, "close");
  mock.restoreAll();
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  fs.rmSync(directory, { recursive: true, force: true });
});

async function begin(user = "User A") {
  const result = await nativeFetch(
    `${origin}/api/fitbit/${encodeURIComponent(user)}/connect`,
    { method: "POST", headers: { Origin: origin } },
  );
  assert.equal(result.status, 200);
  const url = new URL((await result.json()).url);
  nonce = url.searchParams.get("nonce")!;
  return { url, cookie: result.headers.get("set-cookie")!.split(";")[0] };
}
async function callback(
  auth: Awaited<ReturnType<typeof begin>>,
  cookie = auth.cookie,
) {
  return nativeFetch(
    `${origin}/api/fitbit/oauth/callback?state=${auth.url.searchParams.get("state")}&code=fixture-code`,
    { headers: { Cookie: cookie }, redirect: "manual" },
  );
}

test("Fitbit exposes separate disconnected profiles without credentials or emails", async () => {
  const data = await (await nativeFetch(`${origin}/api/fitbit-data`)).json();
  assert.deepEqual(
    data.profiles.map((profile: { status: string }) => profile.status),
    ["disconnected", "disconnected"],
  );
  assert.doesNotMatch(
    JSON.stringify(data),
    /example.com|fixture-secret|client_secret|tokens/,
  );
});

test("Fitbit OAuth requires configured origin, known profile, state cookie and PKCE", async () => {
  const forbidden = await nativeFetch(`${origin}/api/fitbit/User%20A/connect`, {
    method: "POST",
    headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(forbidden.status, 403);
  const auth = await begin();
  assert.equal(auth.url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(auth.url.searchParams.get("access_type"), "offline");
  assert.equal(
    new URL(
      (await callback(auth, "")).headers.get("location")!,
    ).searchParams.get("fitbit"),
    "state",
  );
  assert.equal(integration.snapshot().profiles[0].status, "disconnected");
});

test("Fitbit rejects the other person's Google account", async () => {
  const auth = await begin();
  verifiedEmail = "user1@example.com";
  const result = await callback(auth);
  assert.equal(
    new URL(result.headers.get("location")!).searchParams.get("fitbit"),
    "account",
  );
  assert.equal(integration.snapshot().profiles[0].days.length, 0);
  verifiedEmail = "user0@example.com";
});

test("Fitbit connects only the selected profile, syncs v4 and rejects callback replay", async () => {
  const auth = await begin();
  const result = await callback(auth);
  assert.equal(
    new URL(result.headers.get("location")!).searchParams.get("fitbit"),
    "connected",
  );
  for (
    let attempt = 0;
    integration.snapshot().profiles[0].status === "syncing" && attempt < 100;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  const data = integration.snapshot();
  assert.equal(data.profiles[0].status, "connected");
  assert.ok(data.profiles[0].days.some((day) => day.steps === 1234));
  assert.equal(data.profiles[1].status, "disconnected");
  assert.equal(data.profiles[1].days.length, 0);
  assert.equal(calendarSyncs.length, 1);
  assert.equal(calendarSyncs[0].userId, users[0].id);
  assert.deepEqual(calendarSyncs[0].exercises, []);
  assert.match(calendarSyncs[0].window.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(calendarSyncs[0].window.end > calendarSyncs[0].window.start);
  assert.ok(
    requested.some((url) => url.includes("sleep/dataPoints:reconcile")),
  );
  assert.doesNotMatch(
    JSON.stringify(data),
    /fixture-access|fixture-refresh|subject-a|example.com/,
  );
  for (const filename of fs.readdirSync(process.env.FITBIT_STATE_DIR!))
    assert.equal(
      fs.statSync(path.join(process.env.FITBIT_STATE_DIR!, filename)).mode &
        0o777,
      0o600,
    );
  assert.equal(
    new URL((await callback(auth)).headers.get("location")!).searchParams.get(
      "fitbit",
    ),
    "state",
  );
});

test("Fitbit manual sync deduplicates requests and throttles repeated refreshes", async () => {
  requested = [];
  const first = await nativeFetch(`${origin}/api/fitbit/User%20A/refresh`, {
    method: "POST",
  });
  assert.equal(first.status, 202);
  assert.equal(requested.length, 0);
  assert.equal(
    (
      await nativeFetch(`${origin}/api/fitbit/User%20B/refresh`, {
        method: "POST",
      })
    ).status,
    409,
  );
});

test("Fitbit partial provider failures retain cached metrics and show a warning", async () => {
  const filename = path.join(
    process.env.FITBIT_STATE_DIR!,
    fs.readdirSync(process.env.FITBIT_STATE_DIR!)[0],
  );
  const stored = JSON.parse(fs.readFileSync(filename, "utf8"));
  stored.lastAttemptAt = "2026-01-01T00:00:00Z";
  stored.days[stored.days.length - 1].hrv = 42;
  fs.writeFileSync(filename, JSON.stringify(stored));
  denyScope = true;
  await nativeFetch(`${origin}/api/fitbit/User%20A/refresh`, {
    method: "POST",
  });
  for (
    let attempt = 0;
    integration.snapshot().profiles[0].status === "syncing" && attempt < 100;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  const profile = integration.snapshot().profiles[0];
  assert.equal(profile.status, "connected");
  assert.equal(profile.days[profile.days.length - 1].hrv, 42);
  assert.equal(profile.warnings.length, 1);
});

test("Fitbit exercise fetch failures do not replace calendar history", async () => {
  const filename = path.join(process.env.FITBIT_STATE_DIR!, fs.readdirSync(process.env.FITBIT_STATE_DIR!)[0]);
  const stored = JSON.parse(fs.readFileSync(filename, "utf8"));
  stored.lastAttemptAt = "2026-01-01T00:00:00Z";
  fs.writeFileSync(filename, JSON.stringify(stored));
  const previousCalls = calendarSyncs.length;
  denyExercise = true;
  try {
    await nativeFetch(`${origin}/api/fitbit/User%20A/refresh`, { method: "POST" });
    for (let attempt = 0; integration.snapshot().profiles[0].status === "syncing" && attempt < 100; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(calendarSyncs.length, previousCalls);
    assert.equal(integration.snapshot().profiles[0].warnings.length, 1);
  } finally { denyExercise = false; }
});

test("Fitbit connects a second account independently and keeps expired access isolated", async () => {
  denyScope = false;
  verifiedEmail = "user1@example.com";
  verifiedSubject = "subject-b";
  const auth = await begin("User B");
  assert.equal(
    new URL((await callback(auth)).headers.get("location")!).searchParams.get(
      "fitbit",
    ),
    "connected",
  );
  for (
    let attempt = 0;
    integration.snapshot().profiles[1].status === "syncing" && attempt < 100;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(integration.snapshot().profiles[1].status, "connected");
  const files = fs
    .readdirSync(process.env.FITBIT_STATE_DIR!)
    .map((name) => path.join(process.env.FITBIT_STATE_DIR!, name));
  assert.deepEqual(
    new Set(
      files.map(
        (filename) => JSON.parse(fs.readFileSync(filename, "utf8")).subject,
      ),
    ),
    new Set(["subject-a", "subject-b"]),
  );
  const first = files.find(
    (filename) =>
      JSON.parse(fs.readFileSync(filename, "utf8")).subject === "subject-a",
  )!;
  const stored = JSON.parse(fs.readFileSync(first, "utf8"));
  stored.lastAttemptAt = "2026-01-01T00:00:00Z";
  fs.writeFileSync(first, JSON.stringify(stored));
  unauthorized = true;
  await nativeFetch(`${origin}/api/fitbit/User%20A/refresh`, {
    method: "POST",
  });
  for (
    let attempt = 0;
    integration.snapshot().profiles[0].status === "syncing" && attempt < 100;
    attempt++
  )
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(integration.snapshot().profiles[0].status, "reauthorize");
  assert.ok(
    integration.snapshot().profiles[0].days.some((day) => day.steps === 1234),
  );
  assert.equal(integration.snapshot().profiles[1].status, "connected");
});
