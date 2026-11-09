import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { atomicWrite } from "./atomic-write.js";
import { INBODY_METRICS, INBODY_REQUIRED, INBODY_SEGMENTS } from "../src/inbody-types.js";
import type { InBodyData, InBodyInput, InBodyMetricKey, InBodyRecord } from "../src/inbody-types.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Неверный формат измерения");
  return value as Record<string, unknown>;
}
function number(value: unknown, label: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`Проверьте поле «${label}»: допустимо от ${min} до ${max}`);
  return value;
}
function text(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Проверьте поле «${label}»`);
  return value.trim();
}

export function validateInBodyInput(value: unknown, users: string[]): InBodyInput {
  const raw = object(value);
  const userId = text(raw.userId, "Пользователь", 150);
  if (!users.includes(userId)) throw new Error("Выберите пользователя дашборда");
  const measuredAtLocal = text(raw.measuredAtLocal, "Дата и время", 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(measuredAtLocal)
    || !Number.isFinite(Date.parse(`${measuredAtLocal}Z`))
    || new Date(`${measuredAtLocal}Z`).toISOString().slice(0, 16) !== measuredAtLocal)
    throw new Error("Укажите дату и время с бланка");
  const metrics: InBodyInput["metrics"] = {};
  for (const [key, val] of Object.entries(object(raw.metrics))) {
    if (!Object.hasOwn(INBODY_METRICS, key)) throw new Error("Неизвестный показатель InBody");
    const metric = INBODY_METRICS[key as InBodyMetricKey];
    metrics[key as InBodyMetricKey] = number(val, metric.label, "signed" in metric ? -metric.max : 0, metric.max);
  }
  for (const key of INBODY_REQUIRED) if (metrics[key] === undefined) throw new Error(`Заполните поле «${INBODY_METRICS[key].label}»`);
  if (!metrics.weightKg || metrics.bodyFatKg! > metrics.weightKg || metrics.skeletalMuscleKg! > metrics.weightKg)
    throw new Error("Проверьте вес, жировую и мышечную массу");
  const result: InBodyInput = { userId, measuredAtLocal, device: text(raw.device, "Модель аппарата", 80), metrics };
  if (raw.heightCm !== undefined) result.heightCm = number(raw.heightCm, "Рост", 50, 260);
  if (raw.age !== undefined) result.age = number(raw.age, "Возраст", 1, 120);
  if (raw.sex !== undefined) {
    if (raw.sex !== "male" && raw.sex !== "female") throw new Error("Проверьте поле «Пол»");
    result.sex = raw.sex;
  }
  if (raw.notes !== undefined) result.notes = raw.notes === "" ? "" : text(raw.notes, "Заметка", 2000);
  if (raw.ranges !== undefined) {
    result.ranges = {};
    for (const [key, range] of Object.entries(object(raw.ranges))) {
      if (!Object.hasOwn(INBODY_METRICS, key) || !Array.isArray(range) || range.length !== 2) throw new Error("Проверьте диапазоны бланка");
      const metric = INBODY_METRICS[key as InBodyMetricKey];
      const min = "signed" in metric ? -metric.max : 0;
      const low = number(range[0], metric.label, min, metric.max), high = number(range[1], metric.label, min, metric.max);
      if (low > high) throw new Error("Нижняя граница диапазона превышает верхнюю");
      result.ranges[key as InBodyMetricKey] = [low, high];
    }
  }
  if (raw.segments !== undefined) {
    result.segments = {};
    for (const [key, segment] of Object.entries(object(raw.segments))) {
      if (!Object.hasOwn(INBODY_SEGMENTS, key)) throw new Error("Неизвестный сегмент тела");
      const parsed: Record<string, number> = {};
      for (const [field, val] of Object.entries(object(segment))) {
        if (!["leanKg", "leanPercent", "fatKg", "fatPercent"].includes(field)) throw new Error("Неизвестный показатель сегмента");
        parsed[field] = number(val, "Сегменты тела", 0, field.endsWith("Percent") ? 1000 : 300);
      }
      result.segments[key as keyof typeof INBODY_SEGMENTS] = parsed;
    }
  }
  if (raw.assessments !== undefined) {
    result.assessments = {};
    const entries = Object.entries(object(raw.assessments));
    if (entries.length > 20) throw new Error("Слишком много оценок бланка");
    for (const [key, val] of entries) result.assessments[text(key, "Оценка", 100)] = text(val, "Оценка", 150);
  }
  if (raw.impedance !== undefined) {
    if (!Array.isArray(raw.impedance) || raw.impedance.length > 10) throw new Error("Проверьте импеданс");
    result.impedance = raw.impedance.map((row) => {
      const item = object(row);
      const parsed: NonNullable<InBodyInput["impedance"]>[number] = { frequencyKhz: number(item.frequencyKhz, "Частота", 0, 10000) };
      for (const key of Object.keys(INBODY_SEGMENTS) as (keyof typeof INBODY_SEGMENTS)[]) {
        if (item[key] !== undefined) parsed[key] = number(item[key], "Импеданс", 0, 10000);
      }
      return parsed;
    });
  }
  return result;
}

export function readInBodyData(file: string): InBodyData {
  if (!fs.existsSync(file)) return { schemaVersion: 1, measurements: [] };
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as InBodyData;
  if (data.schemaVersion !== 1 || !Array.isArray(data.measurements)) throw new Error("Повреждён файл измерений InBody");
  return data;
}

export function saveInBodyMeasurement(file: string, input: InBodyInput): InBodyRecord {
  const data = readInBodyData(file);
  if (data.measurements.some(row => row.userId === input.userId && row.measuredAtLocal === input.measuredAtLocal))
    throw new Error("Измерение этого пользователя на указанное время уже сохранено");
  const record: InBodyRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
  data.measurements.push(record);
  data.measurements.sort((a, b) => a.measuredAtLocal.localeCompare(b.measuredAtLocal));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`);
  return record;
}

export function createInBodyRouter(file: string, users: () => string[], onUpdate: () => void) {
  const router = Router();
  router.get("/inbody-data", (_request, response) => {
    try { response.json({ data: readInBodyData(file) }); }
    catch { response.status(500).json({ error: "Не удалось прочитать измерения InBody. Попробуйте обновить страницу." }); }
  });
  router.post("/inbody-data/measurements", (request, response) => {
    let allowedUsers: string[];
    try { allowedUsers = users(); }
    catch { response.status(503).json({ error: "Не удалось загрузить профили здоровья. Обновите страницу и попробуйте ещё раз." }); return; }
    let input: InBodyInput;
    try { input = validateInBodyInput(request.body, allowedUsers); }
    catch (error) { response.status(400).json({ error: (error as Error).message }); return; }
    try {
      const record = saveInBodyMeasurement(file, input);
      onUpdate();
      response.status(201).json({ record, data: readInBodyData(file) });
    } catch (error) {
      const duplicate = (error as Error).message.includes("уже сохранено");
      response.status(duplicate ? 409 : 500).json({ error: duplicate ? (error as Error).message : "Не удалось сохранить измерение. Введённые значения сохранены в форме; попробуйте ещё раз." });
    }
  });
  router.get("/inbody-data/measurements/:id/source", (request, response) => {
    try {
      const record = readInBodyData(file).measurements.find(row => row.id === request.params.id);
      const filename = record?.sourceImage;
      if (!filename || path.basename(filename) !== filename || !/\.(jpe?g|png|webp)$/i.test(filename)) {
        response.status(404).json({ error: "Оригинал бланка не найден" }); return;
      }
      const source = path.resolve(path.dirname(file), "reports", filename);
      if (!fs.existsSync(source)) { response.status(404).json({ error: "Оригинал бланка не найден" }); return; }
      response.sendFile(source);
    } catch { response.status(500).json({ error: "Не удалось открыть бланк" }); }
  });
  return router;
}
