import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyScaleExport, exportScalePoints, planScaleExport, ScaleRequestError, type ScaleExportState, type ScalePoint, type ScaleRequest } from "../server/fitbit-scale.js";
import type { RawMeasurement } from "../server/health-ingest.js";

const clientId = "fixture.apps.googleusercontent.com";
const row: RawMeasurement = {
  row_id: 1, user: "A", measured_at_unix_seconds: Date.parse("2026-07-01T06:30:00Z") / 1000,
  measured_at_timezone: "Europe/Moscow", same_minute_index: 1,
  metrics: { weight_kg: 72.35, body_fat_percent: 18.7, muscle_mass_kg: 53, body_water_percent: 57.3, bmi: 23.2, weight_control_kg: 0 },
  heart_rate_bpm: 68,
  source: { derived_metric_keys: ["body_fat_percent", "muscle_mass_kg"], device_id: "private-device" },
  raw_xiaomi_fields: { source_measurement_id: "source-id", token: "never-send", bindkey: "private-key" },
};
const plan = (rows = [row]) => planScaleExport(rows, "A", "UTC").points;
const data = (point: ScalePoint) => point.body[point.type === "weight" ? "weight" : "bodyFat"] as Record<string, unknown>;

function provider() {
  let sequence = 0;
  const remote: Record<string, unknown>[] = [];
  const writes: { endpoint: string; method: string; body: Record<string, unknown> }[] = [];
  let snapshot = emptyScaleExport();
  const save = (value: ScaleExportState) => { snapshot = structuredClone(value); };
  const request: ScaleRequest = async (endpoint, method = "GET", body) => {
    const url = new URL(`https://health.googleapis.com/v4/${endpoint}`);
    if (method === "GET") {
      assert.match(url.searchParams.get("filter")!, /sample_time.physical_time >=/);
      return { dataPoints: remote.filter((point) => String(point.name).split("/")[3] === url.pathname.split("/")[5]) };
    }
    const payload = structuredClone(body as Record<string, unknown>);
    const type = endpoint.split("/")[3];
    if (method === "POST") {
      assert.ok(!("name" in payload), "Google assigns record IDs");
      assert.ok(Object.values(snapshot.records).some((receipt) => receipt.pending), "queue persists before a network write");
      const point = { ...payload, name: `users/health-a/dataTypes/${type}/dataPoints/provider-${++sequence}`,
        dataSource: { ...(payload.dataSource as object), application: { googleWebClientId: clientId } } };
      remote.push(point);
      writes.push({ endpoint, method, body: payload });
      return { done: true, response: point };
    }
    assert.equal(method, "PATCH");
    const index = remote.findIndex((point) => point.name === endpoint);
    assert.ok(index >= 0);
    remote[index] = { ...payload, dataSource: { ...(payload.dataSource as object), application: { googleWebClientId: clientId } } };
    writes.push({ endpoint, method, body: payload });
    return remote[index];
  };
  return { remote, writes, request, save, get saved() { return structuredClone(snapshot); } };
}

test("scale export maps all available numeric fields, grams, timezone and derived provenance without raw private fields", () => {
  const points = plan();
  assert.equal(points.length, 2);
  const weight = points.find((point) => point.type === "weight")!, fat = points.find((point) => point.type === "body-fat")!;
  assert.equal(data(weight).weightGrams, 72350);
  assert.deepEqual(data(weight).sampleTime, { physicalTime: "2026-07-01T06:30:00.000Z", utcOffset: "10800s" });
  assert.equal(data(fat).percentage, 18.7);
  assert.equal((fat.body.dataSource as { recordingMethod: string }).recordingMethod, "DERIVED");
  assert.match(String(data(weight).notes), /Мышцы, кг: 53 \(расчёт/);
  assert.match(String(data(weight).notes), /Пульс, уд\/мин: 68/);
  assert.match(String(data(weight).notes), /Контроль веса, кг: 0/);
  assert.doesNotMatch(JSON.stringify(points), /private-device|never-send|private-key|source-id|token|bindkey/);
});

test("scale export isolates people, validates measurements and preserves valid zero fat", () => {
  const result = planScaleExport([
    row, { ...row, user: "B" }, { ...row, metrics: { weight_kg: 0 } },
    { ...row, measured_at_unix_seconds: undefined, measured_at: "2026-07-01 09:30:00" },
    { ...row, measurement_status_code: 2 }, { ...row, measured_at_timezone: "invalid" },
  ], "A", "UTC");
  assert.equal(result.points.length, 2);
  assert.equal(result.skipped, 4);
  assert.equal(data(plan([{ ...row, metrics: { weight_kg: 70, body_fat_percent: 0 } }]).find((point) => point.type === "body-fat")!).percentage, 0);
});

test("scale identity survives row renumbering and preserves distinct device measurements", () => {
  assert.deepEqual(plan([{ ...row, row_id: 999 }]).map((point) => point.key), plan().map((point) => point.key));
  assert.equal(plan([row, { ...row, raw_xiaomi_fields: { source_measurement_id: "other-id" } }]).length, 4);
  assert.equal(plan([{ ...row, raw_xiaomi_fields: {} }, { ...row, raw_xiaomi_fields: {}, same_minute_index: 2 }]).length, 4);
  const berlin = plan([{ ...row, measured_at_timezone: "Europe/Berlin" }]);
  assert.equal((data(berlin[0]).sampleTime as { utcOffset: string }).utcOffset, "7200s");
});

test("scale export persists server IDs, resumes after restart, and updates enriched records with PATCH", async () => {
  const api = provider();
  const points = plan();
  await exportScalePoints({ points, state: emptyScaleExport(), clientId, ...api });
  assert.equal(api.writes.length, 2);
  assert.ok(api.saved.lastSyncAt);
  const persisted = api.saved;
  await exportScalePoints({ points, state: persisted, clientId, ...api });
  assert.equal(api.writes.length, 2);
  const enriched = plan([{ ...row, metrics: { ...row.metrics, muscle_mass_kg: 54, body_fat_percent: 18.8 }, source: {} }]);
  await exportScalePoints({ points: enriched, state: persisted, clientId, ...api });
  assert.deepEqual(api.writes.map((write) => write.method), ["POST", "POST", "PATCH", "PATCH"]);
  assert.equal(api.remote.length, 2);
  assert.ok(api.saved.lastSyncAt);
});

test("scale lost POST responses reconcile the application's exact raw record without resending", async () => {
  const api = provider();
  const points = plan().filter((point) => point.type === "weight");
  const request: ScaleRequest = async (endpoint, method, body) => {
    const result = await api.request(endpoint, method, body);
    if (method === "POST") throw new Error("connection lost after commit");
    return result;
  };
  await exportScalePoints({ points, state: emptyScaleExport(), clientId, save: api.save, request });
  assert.equal(api.saved.error, "sync");
  assert.ok(api.saved.records[points[0].key].pending);
  await exportScalePoints({ points, state: api.saved, clientId, save: api.save, request: api.request });
  assert.equal(api.writes.length, 1);
  assert.equal(api.saved.records[points[0].key].name, api.remote[0].name);
  assert.equal(api.saved.error, null);
  assert.equal(api.saved.lastMeasurementAt, points[0].measuredAt);
});

test("scale ambiguous create and unfinished operations wait for confirmation across restarts", async () => {
  for (const pendingResponse of [null, { name: "operations/queued", done: false }, { done: true, response: {} }]) {
    const api = provider();
    const points = plan().filter((point) => point.type === "body-fat");
    let posts = 0;
    const request: ScaleRequest = async (endpoint, method, body) => {
      if (method === "POST") { posts++; if (!pendingResponse) throw new Error("timeout"); return pendingResponse; }
      return api.request(endpoint, method, body);
    };
    await exportScalePoints({ points, state: emptyScaleExport(), clientId, save: api.save, request });
    await exportScalePoints({ points, state: api.saved, clientId, save: api.save, request });
    assert.equal(posts, 1);
    assert.equal(api.saved.error, "confirming");
    assert.ok(api.saved.records[points[0].key].pending);
    assert.equal(api.saved.lastSyncAt, null);
  }
});

test("scale definitive errors retry later; failed operations never count as success", async () => {
  for (const failure of [new ScaleRequestError("rate_limit", true), new ScaleRequestError("scope", true), { done: true, error: { code: 7 } }]) {
    const api = provider();
    const points = plan().slice(0, 1);
    const request: ScaleRequest = async (endpoint, method, body) => {
      if (method === "POST") { if (failure instanceof Error) throw failure; return failure; }
      return api.request(endpoint, method, body);
    };
    await exportScalePoints({ points, state: emptyScaleExport(), clientId, save: api.save, request });
    assert.ok(api.saved.error);
    assert.ok(!api.saved.records[points[0].key].pending);
    assert.equal(api.saved.lastSyncAt, null);
    await exportScalePoints({ points, state: api.saved, clientId, save: api.save, request: api.request });
    assert.equal(api.writes.length, 1);
    assert.equal(api.saved.error, null);
  }
});

test("scale reconciliation paginates and leaves manual and other-app entries independent", async () => {
  const api = provider();
  const points = plan().filter((point) => point.type === "weight");
  await exportScalePoints({ points, state: emptyScaleExport(), clientId, ...api });
  const owned = api.remote[0];
  const stranger = { ...owned, name: "users/health-a/dataTypes/weight/dataPoints/stranger", dataSource: { application: { googleWebClientId: "other" } } };
  const requested: string[] = [];
  const request: ScaleRequest = async (endpoint, method) => {
    assert.ok(!method || method === "GET");
    requested.push(endpoint);
    return endpoint.includes("pageToken=next") ? { dataPoints: [owned] } : { dataPoints: [stranger], nextPageToken: "next" };
  };
  await exportScalePoints({ points, state: emptyScaleExport(), clientId, save: api.save, request });
  assert.equal(requested.length, 2);
  assert.equal(api.saved.records[points[0].key].name, owned.name);
});

test("scale queue is bounded and gradually backfills history without uncertain entries starving new records", async () => {
  const api = provider();
  const rows = [row, { ...row, measured_at_unix_seconds: row.measured_at_unix_seconds! - 86400, raw_xiaomi_fields: {} }];
  const points = plan(rows).filter((point) => point.type === "weight");
  const state = emptyScaleExport();
  state.records[points[1].key] = { pending: points[1] };
  await exportScalePoints({ points, state, clientId, ...api, limit: 1 });
  assert.equal(api.writes.length, 1);
  assert.equal((api.writes[0].body.weight as { sampleTime: { physicalTime: string } }).sampleTime.physicalTime, points[0].measuredAt);
});

test("scale a rejected metric leaves other records progressing and deleted provider records can be recreated", async () => {
  const api = provider();
  const points = plan();
  const request: ScaleRequest = async (endpoint, method, body) => {
    if (method === "POST" && endpoint.includes("body-fat")) throw new ScaleRequestError("invalid", true);
    return api.request(endpoint, method, body);
  };
  await exportScalePoints({ points, state: emptyScaleExport(), clientId, save: api.save, request });
  assert.equal(api.writes.length, 1);
  assert.equal(api.saved.error, "invalid");
  const enriched = plan([{ ...row, metrics: { ...row.metrics, muscle_mass_kg: 55 } }]);
  const missing: ScaleRequest = async (endpoint, method, body) => {
    if (method === "PATCH") throw new ScaleRequestError("missing", true);
    return api.request(endpoint, method, body);
  };
  await exportScalePoints({ points: enriched, state: api.saved, clientId, save: api.save, request: missing });
  const weight = enriched.find((point) => point.type === "weight")!;
  assert.ok(!api.saved.records[weight.key].name);
  api.remote.splice(0);
  await exportScalePoints({ points: enriched, state: api.saved, clientId, save: api.save, request: api.request });
  assert.equal(api.saved.error, null);
  assert.ok(api.saved.lastSyncAt);
});
