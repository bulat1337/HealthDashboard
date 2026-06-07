#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

loadLocalEnvFiles();

const API_BASE = "https://api.zenmoney.ru";
const DEFAULT_STATE_DIR = path.join(os.homedir(), ".codex", "state", "health-dashboard-money-sync");
const STATE_DIR = expandHome(process.env.MONEY_SYNC_STATE_DIR || DEFAULT_STATE_DIR);
const TOKEN_FILE = expandHome(process.env.ZENMONEY_TOKEN_FILE || path.join(STATE_DIR, "zenmoney-token.json"));
const CONFIG_FILE = expandHome(process.env.ZENMONEY_MONEY_SYNC_CONFIG || path.join(STATE_DIR, "zenmoney-money-sync-config.json"));
const STATUS_FILE = path.join(STATE_DIR, "zenmoney-money-sync-status.json");
const DEFAULT_MONEY_FILE = path.join(rootDir, "data", "money", "Money.md");
const MONEY_FILE = expandHome(process.env.MONEY_DATA_FILE || DEFAULT_MONEY_FILE);
const TIMEZONE = process.env.MONEY_SYNC_TIMEZONE || process.env.HEALTH_DEFAULT_TIMEZONE || "Europe/Moscow";
const MONEY_PARTNER_LABEL = process.env.MONEY_PARTNER_LABEL?.trim() || "партнера";
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53682/callback";
const ZENMONEY_PRE_SYNC_COMMAND = process.env.ZENMONEY_PRE_SYNC_COMMAND || "";
const ZENMONEY_PRE_SYNC_URL = process.env.ZENMONEY_PRE_SYNC_URL || "";
const ZENMONEY_PRE_SYNC_METHOD = (process.env.ZENMONEY_PRE_SYNC_METHOD || "POST").toUpperCase();
const ZENMONEY_PRE_SYNC_TOKEN = process.env.ZENMONEY_PRE_SYNC_TOKEN || "";
const ZENMONEY_PRE_SYNC_TIMEOUT_MS = Number(process.env.ZENMONEY_PRE_SYNC_TIMEOUT_MS || 120000);
const ZENMONEY_PRE_SYNC_WAIT_MS = Number(process.env.ZENMONEY_PRE_SYNC_WAIT_MS || 45000);

const DEFAULT_CONFIG = {
  version: 1,
  moneyFile: MONEY_FILE,
  timezone: TIMEZONE,
  debitAccountTypes: ["cash", "checking", "deposit", "emoney"],
  investmentAccountTypes: ["checking", "deposit"],
  investmentAccountIds: [],
  excludeInvestmentAccountIds: [],
  investmentAccountMatchers: [
    {
      company: ["т-банк", "t-bank", "tbank", "tinkoff", "тиньк", "тинькофф"],
      title: ["брокер", "инвест"]
    }
  ],
  includeAccountIds: [],
  excludeAccountIds: [],
  creditCardAccountIds: [],
  excludeCreditCardAccountIds: [],
  includePositiveCreditCardBalance: false,
  requiredCreditCardGroups: [
    {
      id: "alpha",
      label: "Альфа",
      match: ["альфа", "alfa"]
    },
    {
      id: "tbank",
      label: "Т-Банк",
      match: ["т-банк", "t-bank", "tbank", "tinkoff", "тиньк", "тинькофф"]
    }
  ]
};

function help() {
  return `ZenMoney money sync

Usage:
  node scripts/zenmoney-money-sync.mjs init-config
  node scripts/zenmoney-money-sync.mjs auth-url
  node scripts/zenmoney-money-sync.mjs exchange-code <code>
  node scripts/zenmoney-money-sync.mjs auth-server
  node scripts/zenmoney-money-sync.mjs import-token <json-file|->
  node scripts/zenmoney-money-sync.mjs accounts [--json] [--show-balances]
  node scripts/zenmoney-money-sync.mjs dry-run [--date YYYY-MM-DD] [--json]
  node scripts/zenmoney-money-sync.mjs write [--date YYYY-MM-DD] [--json]

Environment:
  MONEY_DATA_FILE                 Money.md path. Defaults to data/money/Money.md.
  MONEY_PARTNER_LABEL             Partner label used in Money.md. Defaults to партнера.
  ZENMONEY_PRE_SYNC_URL           Optional URL to trigger ZenMoney mobile bank sync first.
  ZENMONEY_PRE_SYNC_METHOD        HTTP method for URL trigger. Defaults to POST.
  ZENMONEY_PRE_SYNC_COMMAND       Optional local command to trigger ZenMoney mobile bank sync first.
  ZENMONEY_PRE_SYNC_WAIT_MS       Wait after trigger before reading API. Defaults to 45000.
  ZENMONEY_TOKEN_FILE             Local token JSON file.
  ZENMONEY_CLIENT_ID              OAuth client id for auth-url/exchange-code/auth-server.
  ZENMONEY_CLIENT_SECRET          OAuth client secret for token exchange/refresh.
  ZENMONEY_REDIRECT_URI           OAuth redirect URI. Defaults to ${DEFAULT_REDIRECT_URI}.
  ZENMONEY_ACCESS_TOKEN           Optional access token override.
  ZENMONEY_REFRESH_TOKEN          Optional refresh token override.
`;
}

function loadLocalEnvFiles() {
  const externalKeys = new Set(Object.keys(process.env));
  for (const filename of [".env", ".env.local"]) {
    const envPath = path.join(rootDir, filename);
    if (!fsSync.existsSync(envPath)) continue;

    const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || externalKeys.has(match[1])) continue;
      process.env[match[1]] = parseEnvValue(match[2]);
    }
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const inner = trimmed.slice(1, -1);
    return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\"/g, '"') : inner;
  }
  return trimmed;
}

function expandHome(value) {
  if (!value || value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function writeStdout(value) {
  process.stdout.write(`${value}\n`);
}

function writeStderr(value) {
  process.stderr.write(`${value}\n`);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = [];
  const flags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      args.push(arg);
      continue;
    }

    const [rawKey, rawValue] = arg.slice(2).split("=", 2);
    if (rawValue !== undefined) {
      flags.set(rawKey, rawValue);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags.set(rawKey, next);
      index += 1;
    } else {
      flags.set(rawKey, true);
    }
  }

  return { args, flags };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonFile(filePath, value, mode = 0o600) {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await fs.rename(tmpPath, filePath);
}

async function readOptionalJsonFile(filePath) {
  try {
    return await readJsonFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readConfig() {
  const config = (await readOptionalJsonFile(CONFIG_FILE)) || {};
  return {
    ...DEFAULT_CONFIG,
    ...config,
    moneyFile: expandHome(config.moneyFile || process.env.MONEY_DATA_FILE || DEFAULT_CONFIG.moneyFile),
    timezone: config.timezone || process.env.MONEY_SYNC_TIMEZONE || process.env.HEALTH_DEFAULT_TIMEZONE || DEFAULT_CONFIG.timezone,
    debitAccountTypes: config.debitAccountTypes || DEFAULT_CONFIG.debitAccountTypes,
    investmentAccountTypes: config.investmentAccountTypes || DEFAULT_CONFIG.investmentAccountTypes,
    investmentAccountIds: config.investmentAccountIds || [],
    excludeInvestmentAccountIds: config.excludeInvestmentAccountIds || [],
    investmentAccountMatchers:
      config.investmentAccountMatchers === undefined
        ? DEFAULT_CONFIG.investmentAccountMatchers
        : config.investmentAccountMatchers,
    includeAccountIds: config.includeAccountIds || [],
    excludeAccountIds: config.excludeAccountIds || [],
    creditCardAccountIds: config.creditCardAccountIds || [],
    excludeCreditCardAccountIds: config.excludeCreditCardAccountIds || [],
    includePositiveCreditCardBalance:
      config.includePositiveCreditCardBalance ?? DEFAULT_CONFIG.includePositiveCreditCardBalance,
    requiredCreditCardGroups:
      config.requiredCreditCardGroups === undefined
        ? DEFAULT_CONFIG.requiredCreditCardGroups
        : config.requiredCreditCardGroups
  };
}

async function writeStatus(status) {
  await writeJsonFile(
    STATUS_FILE,
    {
      updatedAt: new Date().toISOString(),
      ...status
    },
    0o600
  );
}

function getOAuthConfig() {
  return {
    clientId: process.env.ZENMONEY_CLIENT_ID || "",
    clientSecret: process.env.ZENMONEY_CLIENT_SECRET || "",
    redirectUri: process.env.ZENMONEY_REDIRECT_URI || DEFAULT_REDIRECT_URI
  };
}

function authUrl() {
  const { clientId, redirectUri } = getOAuthConfig();
  if (!clientId) throw new Error("ZENMONEY_CLIENT_ID is required for auth-url.");

  const url = new URL("/oauth2/authorize/", API_BASE);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

async function tokenRequest(params) {
  const response = await fetch(new URL("/oauth2/token/", API_BASE), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params)
  });

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`ZenMoney token request failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }

  return normalizeToken(body);
}

function normalizeToken(token) {
  const normalized = typeof token === "string" ? { access_token: token } : { ...token };
  if (!normalized?.access_token) throw new Error("Token JSON must contain access_token.");

  normalized.access_token = validateTokenValue("access_token", normalized.access_token);
  if (normalized.refresh_token) {
    normalized.refresh_token = validateTokenValue("refresh_token", normalized.refresh_token);
  }

  if (normalized.expires_in && !normalized.expires_at) {
    normalized.expires_at = nowSeconds() + Number(normalized.expires_in);
  }

  if (typeof normalized.expires_at === "string") {
    const parsed = Date.parse(normalized.expires_at);
    if (Number.isFinite(parsed)) normalized.expires_at = Math.floor(parsed / 1000);
  }

  if (typeof normalized.expires_at === "number" && normalized.expires_at > 10_000_000_000) {
    normalized.expires_at = Math.floor(normalized.expires_at / 1000);
  }

  return normalized;
}

function validateTokenValue(name, value) {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${name} is empty.`);
  if (/[\r\n\t ]/.test(trimmed)) {
    throw new Error(`${name} contains whitespace. Copy only the ZenMoney token value or token JSON.`);
  }
  if (/(npm\s+run|pbpaste|cd\s+\/|zenmoney-money-sync|import-token)/i.test(trimmed)) {
    throw new Error(`${name} looks like a shell command. Copy only the ZenMoney token value or token JSON.`);
  }
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(trimmed)) {
    throw new Error(`${name} contains unsupported characters. Copy only the ZenMoney token value or token JSON.`);
  }
  return trimmed;
}

async function saveToken(token) {
  const normalized = normalizeToken(token);
  await writeJsonFile(TOKEN_FILE, normalized, 0o600);
  return normalized;
}

async function exchangeCode(code) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  if (!clientId || !clientSecret) {
    throw new Error("ZENMONEY_CLIENT_ID and ZENMONEY_CLIENT_SECRET are required for exchange-code.");
  }

  return saveToken(
    await tokenRequest({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  );
}

async function readToken() {
  if (process.env.ZENMONEY_ACCESS_TOKEN) {
    return normalizeToken({
      access_token: process.env.ZENMONEY_ACCESS_TOKEN,
      refresh_token: process.env.ZENMONEY_REFRESH_TOKEN || undefined,
      expires_at: process.env.ZENMONEY_ACCESS_TOKEN_EXPIRES_AT || undefined
    });
  }

  const token = await readOptionalJsonFile(TOKEN_FILE);
  return token ? normalizeToken(token) : null;
}

function shouldRefreshToken(token) {
  if (!token?.refresh_token) return false;
  if (!token.expires_at) return false;
  return Number(token.expires_at) - nowSeconds() < 300;
}

async function refreshToken(token) {
  const { clientId, clientSecret } = getOAuthConfig();
  if (!clientId || !clientSecret || !token?.refresh_token) return token;

  return saveToken(
    await tokenRequest({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: token.refresh_token
    })
  );
}

async function getValidToken() {
  const token = await readToken();
  if (!token) {
    throw new Error(
      `ZenMoney token is missing. Run import-token or exchange-code first. Expected token file: ${TOKEN_FILE}`
    );
  }

  if (shouldRefreshToken(token)) return refreshToken(token);
  return token;
}

async function zenmoneyJson(endpoint, body, token = null) {
  const currentToken = token || (await getValidToken());
  const response = await fetch(new URL(endpoint, API_BASE), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${currentToken.access_token}`,
      "Content-Type": "application/json",
      "User-Agent": "HealthDashboardMoneySync/0.1"
    },
    body: JSON.stringify(body)
  });

  if (response.status === 401 && currentToken.refresh_token) {
    const refreshed = await refreshToken(currentToken);
    return zenmoneyJson(endpoint, body, refreshed);
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`ZenMoney API request failed: HTTP ${response.status} ${JSON.stringify(parsed)}`);
  }

  return parsed;
}

async function fetchFullDiff() {
  return zenmoneyJson("/v8/diff/", {
    currentClientTimestamp: nowSeconds(),
    serverTimestamp: 0,
    forceFetch: ["instrument", "company", "user", "account"]
  });
}

async function runPreSyncUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ZENMONEY_PRE_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: ZENMONEY_PRE_SYNC_METHOD,
      headers: ZENMONEY_PRE_SYNC_TOKEN ? { Authorization: `Bearer ${ZENMONEY_PRE_SYNC_TOKEN}` } : {},
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`ZenMoney mobile pre-sync URL failed: HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function runPreSyncCommand(command) {
  await new Promise((resolve, reject) => {
    const child = spawn("/bin/sh", ["-lc", command], {
      cwd: rootDir,
      env: process.env,
      stdio: "ignore"
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("ZenMoney mobile pre-sync command timed out."));
    }, ZENMONEY_PRE_SYNC_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ZenMoney mobile pre-sync command failed: ${signal || `exit ${code}`}`));
    });
  });
}

async function runZenMoneyPreSync() {
  if (ZENMONEY_PRE_SYNC_URL) await runPreSyncUrl(ZENMONEY_PRE_SYNC_URL);
  if (ZENMONEY_PRE_SYNC_COMMAND) await runPreSyncCommand(ZENMONEY_PRE_SYNC_COMMAND);
  if ((ZENMONEY_PRE_SYNC_URL || ZENMONEY_PRE_SYNC_COMMAND) && ZENMONEY_PRE_SYNC_WAIT_MS > 0) {
    await wait(ZENMONEY_PRE_SYNC_WAIT_MS);
  }
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMoneyAmount(value) {
  const raw = value?.trim() ?? "";
  if (!raw || raw === "-" || raw === "—") return null;

  const compact = raw
    .replace(/₽/g, "")
    .replace(/руб(?:\.|лей|ля|ль)?/gi, "")
    .replace(/['’\s]/g, "")
    .replace(/[~≈]/g, "");
  const match = compact.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;

  const numeric = Number(match[0].replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  const lower = compact.toLowerCase();
  const multiplier = lower.includes("k") || lower.includes("к") ? 1000 : 1;
  return Math.round(numeric * multiplier);
}

function parseLabeledMoneyAmount(text, labels) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*:\\s*([^\\n]+)`, "i"));
    const amount = parseMoneyAmount(match?.[1]);
    if (amount !== null) return amount;
  }
  return null;
}

function parseMoneyDate(date) {
  const match = date?.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMarkdownTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.replace(/\*\*/g, "").trim());
}

function isMarkdownSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function findColumn(headers, expected) {
  const needle = expected.toLowerCase();
  return headers.findIndex((header) => header.toLowerCase().includes(needle));
}

function findMoneyTable(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const headers = parseMarkdownTableLine(lines[index]);
    if (findColumn(headers, "Дата") === -1 || findColumn(headers, "Общая сумма") === -1) continue;

    let end = index + 1;
    while (end < lines.length && lines[end].trim().startsWith("|")) end += 1;
    return { start: index, end, headers };
  }

  throw new Error("Money table with columns Дата and Общая сумма was not found.");
}

function readMoneyContext(text) {
  const lines = text.split(/\r?\n/);
  const table = findMoneyTable(lines);
  const dateColumn = findColumn(table.headers, "Дата");
  const investmentColumn = findColumn(table.headers, "Инвестиции");
  const reserveColumn = findColumn(table.headers, "Несгораемая сумма");

  const records = lines
    .slice(table.start + 2, table.end)
    .map((line, offset) => {
      const cells = parseMarkdownTableLine(line);
      if (cells.length === 0 || isMarkdownSeparator(cells)) return null;
      const date = cells[dateColumn];
      const dateIso = parseMoneyDate(date);
      if (!dateIso) return null;
      return {
        lineIndex: table.start + 2 + offset,
        cells,
        date,
        dateIso,
        investmentAmount: parseMoneyAmount(cells[investmentColumn]),
        reserveAmount: parseMoneyAmount(cells[reserveColumn])
      };
    })
    .filter(Boolean);

  const latestRecord = records[records.length - 1] || null;
  const partnerCreditCardDebt = parseLabeledMoneyAmount(text, [
    `Долг по кредиткам ${MONEY_PARTNER_LABEL}`,
    "Долг по кредиткам партнера",
    "Долг по кредиткам партнёра",
    "Partner credit card debt"
  ]);
  const partnerMoney = parseLabeledMoneyAmount(text, [
    `Деньги ${MONEY_PARTNER_LABEL}`,
    "Деньги партнера",
    "Деньги партнёра",
    "Partner money"
  ]);
  const rentMonthly = parseMoneyAmount(text.match(/аренда:\s*([^\n]+)/i)?.[1]);

  return {
    lines,
    table,
    records,
    latestRecord,
    previousReserveAmount: latestRecord?.reserveAmount ?? 0,
    partnerCreditCardDebt,
    partnerMoney,
    rentMonthly
  };
}

function dateParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = Number(value.day);
  const month = Number(value.month);
  const year = Number(value.year);
  return {
    day,
    month,
    year,
    iso: `${value.year}-${value.month}-${value.day}`,
    display: `${value.day}.${value.month}.${String(value.year).slice(-2)}`
  };
}

function dateFromFlag(rawDate, timezone) {
  if (!rawDate) return dateParts(new Date(), timezone);
  const match = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("--date must use YYYY-MM-DD format.");
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    iso: rawDate,
    display: `${match[3]}.${match[2]}.${match[1].slice(-2)}`
  };
}

function formatMoney(value) {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}

function accountSearchText(account) {
  return [account.title, account.companyTitle, account.type, account.id].filter(Boolean).join(" ").toLowerCase();
}

function includeByList(id, includeIds, excludeIds) {
  if (excludeIds.includes(id)) return false;
  if (includeIds.length > 0 && !includeIds.includes(id)) return false;
  return true;
}

function normalizeZenMoneyData(diff) {
  const instruments = new Map((diff.instrument || []).map((instrument) => [instrument.id, instrument]));
  const companies = new Map((diff.company || []).map((company) => [company.id, company]));

  const accounts = (diff.account || []).map((account) => {
    const instrument = instruments.get(account.instrument);
    const company = companies.get(account.company);
    const rate = asNumber(instrument?.rate) ?? 1;
    const balance = asNumber(account.balance) ?? 0;
    const creditLimit = asNumber(account.creditLimit) ?? 0;
    const balanceRub = balance * rate;
    const creditLimitRub = creditLimit * rate;

    return {
      ...account,
      instrumentTitle: instrument?.shortTitle || instrument?.title || String(account.instrument || ""),
      instrumentRate: rate,
      companyTitle: company?.title || company?.fullTitle || "",
      balance,
      creditLimit,
      balanceRub,
      creditLimitRub,
      active: account.archive !== true && account.inBalance !== false
    };
  });

  return {
    instruments: [...instruments.values()],
    companies: [...companies.values()],
    accounts
  };
}

function isCreditCardAccount(account, config) {
  if ((config.excludeCreditCardAccountIds || []).includes(account.id)) return false;
  if ((config.creditCardAccountIds || []).includes(account.id)) return true;
  return account.type === "ccard" && (account.creditLimitRub > 0 || account.balanceRub < 0);
}

function textMatchesAny(text, matchers) {
  const normalized = String(text || "").toLowerCase();
  return (matchers || []).some((matcher) => normalized.includes(String(matcher).toLowerCase()));
}

function isInvestmentAccount(account, config) {
  if ((config.excludeInvestmentAccountIds || []).includes(account.id)) return false;
  if ((config.investmentAccountIds || []).includes(account.id)) return true;
  if (!new Set(config.investmentAccountTypes || []).has(account.type)) return false;

  return (config.investmentAccountMatchers || []).some((matcher) => {
    const companyOk = !matcher.company || textMatchesAny(account.companyTitle, matcher.company);
    const titleOk = !matcher.title || textMatchesAny(account.title, matcher.title);
    return companyOk && titleOk;
  });
}

function isDebitAccount(account, config) {
  if (isInvestmentAccount(account, config)) return false;
  if (isCreditCardAccount(account, config)) {
    return config.includePositiveCreditCardBalance === true && account.balanceRub > 0;
  }
  if (account.type === "ccard") return true;
  return new Set(config.debitAccountTypes || []).has(account.type);
}

function classifyAccounts(data, config) {
  const debitAccounts = [];
  const investmentAccounts = [];
  const creditCardAccounts = [];
  const excludedAccounts = [];

  for (const account of data.accounts) {
    const debitListAllows = includeByList(account.id, config.includeAccountIds || [], config.excludeAccountIds || []);
    const creditListAllows = includeByList(
      account.id,
      config.creditCardAccountIds || [],
      config.excludeCreditCardAccountIds || []
    );

    if (!account.active) {
      excludedAccounts.push({ account, reason: "inactive" });
      continue;
    }

    if (isInvestmentAccount(account, config)) {
      investmentAccounts.push(account);
      continue;
    }

    if (isCreditCardAccount(account, config)) {
      if (creditListAllows) creditCardAccounts.push(account);
      if (isDebitAccount(account, config) && debitListAllows) debitAccounts.push(account);
      continue;
    }

    if (isDebitAccount(account, config) && debitListAllows) {
      debitAccounts.push(account);
    } else {
      excludedAccounts.push({ account, reason: "type_or_config" });
    }
  }

  return {
    debitAccounts,
    investmentAccounts,
    creditCardAccounts,
    excludedAccounts
  };
}

function validateCreditCardGroups(creditCardAccounts, groups) {
  const missing = [];

  for (const group of groups || []) {
    const matchers = group.match || [];
    const found = creditCardAccounts.some((account) => {
      const text = accountSearchText(account);
      return matchers.some((matcher) => text.includes(String(matcher).toLowerCase()));
    });
    if (!found) missing.push(group.label || group.id);
  }

  return missing;
}

function buildMoneyRow({ moneyContext, accountSummary, targetDate, config }) {
  const missing = [];
  if (moneyContext.partnerCreditCardDebt === null) missing.push(`Долг по кредиткам ${MONEY_PARTNER_LABEL}`);
  if (moneyContext.partnerMoney === null) missing.push(`Деньги ${MONEY_PARTNER_LABEL}`);
  if (moneyContext.rentMonthly === null) missing.push("аренда");
  if (missing.length > 0) {
    throw new Error(`Money.md is missing readable values: ${missing.join(", ")}.`);
  }

  const debitTotal = Math.round(
    accountSummary.debitAccounts.reduce((total, account) => total + account.balanceRub, 0)
  );
  const investmentTotal = Math.round(
    accountSummary.investmentAccounts.reduce((total, account) => total + account.balanceRub, 0)
  );
  const totalAmount = debitTotal + investmentTotal;
  const zenmoneyCreditCardDebt = Math.round(
    accountSummary.creditCardAccounts.reduce((total, account) => total + Math.max(0, -account.balanceRub), 0)
  );

  if (accountSummary.debitAccounts.length === 0) {
    throw new Error("No debit accounts were selected from ZenMoney. Check config include/exclude account ids.");
  }

  const missingCreditGroups = validateCreditCardGroups(
    accountSummary.creditCardAccounts,
    config.requiredCreditCardGroups || []
  );
  if (missingCreditGroups.length > 0) {
    throw new Error(`ZenMoney credit card accounts are missing required groups: ${missingCreditGroups.join(", ")}.`);
  }

  const topUp = targetDate.day === 25 ? 100000 : 0;
  const reserveAmount = moneyContext.previousReserveAmount + topUp;
  const unpaidRent = targetDate.day >= 10 && targetDate.day <= 19 ? moneyContext.rentMonthly : 0;
  const rentPaid = targetDate.day >= 10 && targetDate.day <= 19 ? "нет" : "да";
  const creditCardDebt = zenmoneyCreditCardDebt + moneyContext.partnerCreditCardDebt;
  const freeAmount = debitTotal - creditCardDebt - moneyContext.partnerMoney - unpaidRent - reserveAmount;

  return {
    date: targetDate.display,
    dateIso: targetDate.iso,
    totalAmount,
    freeAmount,
    investmentAmount: investmentTotal,
    reserveAmount,
    creditCardDebt,
    rentPaid,
    diagnostics: {
      debitAccountCount: accountSummary.debitAccounts.length,
      investmentAccountCount: accountSummary.investmentAccounts.length,
      creditCardAccountCount: accountSummary.creditCardAccounts.length,
      liquidDebitTotal: debitTotal,
      investmentTotal,
      zenmoneyCreditCardDebt,
      partnerCreditCardDebt: moneyContext.partnerCreditCardDebt,
      partnerMoney: moneyContext.partnerMoney,
      unpaidRent,
      reserveTopUp: topUp
    }
  };
}

function tableRowCells(row) {
  return [
    row.date,
    formatMoney(row.totalAmount),
    formatMoney(row.freeAmount),
    formatMoney(row.investmentAmount),
    formatMoney(row.reserveAmount),
    formatMoney(row.creditCardDebt),
    row.rentPaid
  ];
}

function normalizeMoneyTableHeaders(headers) {
  if (findColumn(headers, "Инвестиции") !== -1) return headers;
  const freeColumn = findColumn(headers, "Свободная сумма");
  const nextHeaders = [...headers];
  nextHeaders.splice(freeColumn === -1 ? 3 : freeColumn + 1, 0, "Инвестиции, руб");
  return nextHeaders;
}

function normalizeMoneyTableCells(cells, headers) {
  if (findColumn(headers, "Инвестиции") !== -1) return cells;
  const freeColumn = findColumn(headers, "Свободная сумма");
  const nextCells = [...cells];
  nextCells.splice(freeColumn === -1 ? 3 : freeColumn + 1, 0, "");
  return nextCells;
}

function separatorCells(widths) {
  return widths.map((width) => "-".repeat(Math.max(2, width)));
}

function renderTableRow(cells, widths) {
  return `| ${cells.map((cell, index) => String(cell).padEnd(widths[index] || String(cell).length)).join(" | ")} |`;
}

function updateMoneyText(text, row) {
  const context = readMoneyContext(text);
  const originalHeaders = context.table.headers;
  const headers = normalizeMoneyTableHeaders(originalHeaders);
  const cells = tableRowCells(row);
  const widths = headers.map((header, index) => Math.max(header.length, cells[index]?.length || 0));

  for (let lineIndex = context.table.start; lineIndex < context.table.end; lineIndex += 1) {
    const existingCells = normalizeMoneyTableCells(parseMarkdownTableLine(context.lines[lineIndex]), originalHeaders);
    existingCells.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] || 0, cell.length);
    });
  }

  const rendered = renderTableRow(cells, widths);
  context.lines[context.table.start] = renderTableRow(headers, widths);
  context.lines[context.table.start + 1] = renderTableRow(separatorCells(widths), widths);

  for (let lineIndex = context.table.start + 2; lineIndex < context.table.end; lineIndex += 1) {
    const existingCells = parseMarkdownTableLine(context.lines[lineIndex]);
    if (existingCells.length === 0 || isMarkdownSeparator(existingCells)) continue;
    context.lines[lineIndex] = renderTableRow(normalizeMoneyTableCells(existingCells, originalHeaders), widths);
  }

  const existingRecord = context.records.find((record) => record.dateIso === row.dateIso);

  if (existingRecord) {
    context.lines[existingRecord.lineIndex] = rendered;
    return context.lines.join("\n");
  }

  const blankRowIndex = context.lines
    .slice(context.table.start + 2, context.table.end)
    .findIndex((line) => parseMarkdownTableLine(line).every((cell) => cell === ""));
  const insertAt = blankRowIndex === -1 ? context.table.end : context.table.start + 2 + blankRowIndex;
  context.lines.splice(insertAt, 0, rendered);
  return context.lines.join("\n");
}

async function buildZenMoneyRow(config, flags) {
  const moneyText = await fs.readFile(config.moneyFile, "utf8");
  const moneyContext = readMoneyContext(moneyText);
  const targetDate = dateFromFlag(flags.get("date"), config.timezone);
  await runZenMoneyPreSync();
  const diff = await fetchFullDiff();
  const data = normalizeZenMoneyData(diff);
  const accountSummary = classifyAccounts(data, config);
  const row = buildMoneyRow({ moneyContext, accountSummary, targetDate, config });

  return {
    moneyText,
    row,
    data,
    accountSummary,
    serverTimestamp: diff.serverTimestamp ?? null
  };
}

function accountPublicShape(account, showBalances) {
  return {
    id: account.id,
    title: account.title,
    company: account.companyTitle,
    type: account.type,
    currency: account.instrumentTitle,
    inBalance: account.inBalance,
    archive: account.archive,
    savings: account.savings,
    ...(showBalances
      ? {
          balance: Math.round(account.balance * 100) / 100,
          balanceRub: Math.round(account.balanceRub),
          creditLimitRub: Math.round(account.creditLimitRub)
        }
      : {})
  };
}

function printAccounts(data, config, showBalances) {
  const accountSummary = classifyAccounts(data, config);
  const selectedDebitIds = new Set(accountSummary.debitAccounts.map((account) => account.id));
  const selectedInvestmentIds = new Set(accountSummary.investmentAccounts.map((account) => account.id));
  const selectedCreditIds = new Set(accountSummary.creditCardAccounts.map((account) => account.id));

  for (const account of data.accounts) {
    const markers = [];
    if (selectedDebitIds.has(account.id)) markers.push("debit");
    if (selectedInvestmentIds.has(account.id)) markers.push("investment");
    if (selectedCreditIds.has(account.id)) markers.push("credit-card");
    if (account.archive) markers.push("archived");
    const balance = showBalances
      ? ` balanceRub=${Math.round(account.balanceRub)} creditLimitRub=${Math.round(account.creditLimitRub)}`
      : "";
    writeStdout(
      `${markers.length ? `[${markers.join(",")}] ` : ""}${account.id} :: ${account.companyTitle || "-"} :: ${
        account.title || "-"
      } :: type=${account.type} :: currency=${account.instrumentTitle}${balance}`
    );
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function parseTokenInput(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Token input is empty.");

  try {
    return JSON.parse(trimmed);
  } catch {
    return { access_token: trimmed };
  }
}

async function runAuthServer() {
  const url = authUrl();
  const redirectUri = new URL(getOAuthConfig().redirectUri);
  if (redirectUri.hostname !== "127.0.0.1" && redirectUri.hostname !== "localhost") {
    throw new Error("auth-server requires a localhost redirect URI.");
  }

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", getOAuthConfig().redirectUri);
      if (requestUrl.pathname !== redirectUri.pathname) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) throw new Error("OAuth callback did not include code.");
      await exchangeCode(code);
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`ZenMoney token saved to ${TOKEN_FILE}\n`);
      server.close();
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(`${error instanceof Error ? error.message : String(error)}\n`);
      server.close();
    }
  });

  await new Promise((resolve) => server.listen(Number(redirectUri.port || 80), redirectUri.hostname, resolve));
  writeStdout(`Opening ZenMoney authorization URL. Token file: ${TOKEN_FILE}`);
  spawn("open", [url], { stdio: "ignore", detached: true }).unref();
}

async function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const command = args[0] || "help";

  if (command === "help" || flags.has("help")) {
    writeStdout(help());
    return;
  }

  if (command === "init-config") {
    if (fsSync.existsSync(CONFIG_FILE) && !flags.has("force")) {
      throw new Error(`Config already exists: ${CONFIG_FILE}. Use --force to overwrite it.`);
    }
    await writeJsonFile(CONFIG_FILE, DEFAULT_CONFIG, 0o600);
    writeStdout(`Config written to ${CONFIG_FILE}`);
    return;
  }

  if (command === "auth-url") {
    writeStdout(authUrl());
    return;
  }

  if (command === "auth-server") {
    await runAuthServer();
    return;
  }

  if (command === "exchange-code") {
    const code = args[1];
    if (!code) throw new Error("exchange-code requires the OAuth code.");
    await exchangeCode(code);
    writeStdout(`Token saved to ${TOKEN_FILE}`);
    return;
  }

  if (command === "import-token") {
    const source = args[1] || "-";
    const raw = source === "-" ? await readStdin() : await fs.readFile(expandHome(source), "utf8");
    await saveToken(parseTokenInput(raw));
    writeStdout(`Token saved to ${TOKEN_FILE}`);
    return;
  }

  const config = await readConfig();

  if (command === "accounts") {
    const data = normalizeZenMoneyData(await fetchFullDiff());
    if (flags.has("json")) {
      writeStdout(
        JSON.stringify(
          data.accounts.map((account) => accountPublicShape(account, flags.has("show-balances"))),
          null,
          2
        )
      );
    } else {
      printAccounts(data, config, flags.has("show-balances"));
    }
    await writeStatus({
      status: "ok",
      command,
      accountCount: data.accounts.length
    });
    return;
  }

  if (command === "dry-run" || command === "write") {
    const result = await buildZenMoneyRow(config, flags);
    const payload = {
      row: result.row,
      serverTimestamp: result.serverTimestamp,
      debitAccounts: result.accountSummary.debitAccounts.map((account) => accountPublicShape(account, false)),
      investmentAccounts: result.accountSummary.investmentAccounts.map((account) => accountPublicShape(account, false)),
      creditCardAccounts: result.accountSummary.creditCardAccounts.map((account) => accountPublicShape(account, false))
    };

    if (command === "dry-run") {
      writeStdout(
        flags.has("json")
          ? JSON.stringify(payload, null, 2)
          : renderTableRow(tableRowCells(result.row), [8, 16, 20, 16, 22, 22, 16])
      );
      await writeStatus({
        status: "ok",
        command,
        date: result.row.dateIso,
        debitAccountCount: result.row.diagnostics.debitAccountCount,
        investmentAccountCount: result.row.diagnostics.investmentAccountCount,
        creditCardAccountCount: result.row.diagnostics.creditCardAccountCount
      });
      return;
    }

    const nextText = updateMoneyText(result.moneyText, result.row);
    await fs.writeFile(config.moneyFile, nextText, "utf8");
    writeStdout(flags.has("json") ? JSON.stringify(payload, null, 2) : `Money.md updated: ${config.moneyFile}`);
    await writeStatus({
      status: "ok",
      command,
      date: result.row.dateIso,
      moneyFile: config.moneyFile,
      debitAccountCount: result.row.diagnostics.debitAccountCount,
      investmentAccountCount: result.row.diagnostics.investmentAccountCount,
      creditCardAccountCount: result.row.diagnostics.creditCardAccountCount
    });
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  await writeStatus({
    status: "error",
    error: message
  }).catch(() => {});
  writeStderr(message);
  process.exitCode = 1;
});
