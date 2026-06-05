#!/usr/bin/env node
import dgram from "node:dgram";
import os from "node:os";

const MDNS_ADDRESS = "224.0.0.251";
const MDNS_PORT = 5353;
const DEFAULT_NAMES = [
  "health",
  "health.local",
  "health-dashboard.local",
  "healthdashboard.local",
  `${os.hostname()}.local`
];

function normalizeName(name) {
  return name.trim().replace(/\.$/, "").toLowerCase();
}

function namesFromEnv() {
  const raw = process.env.MDNS_NAMES;
  const names = raw ? raw.split(",") : DEFAULT_NAMES;
  return [...new Set(names.map(normalizeName).filter(Boolean))];
}

function isIPv4(value) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function getIPv4Address() {
  if (process.env.MDNS_IPV4 && isIPv4(process.env.MDNS_IPV4)) {
    return process.env.MDNS_IPV4;
  }

  const preferredInterface = process.env.MDNS_INTERFACE;
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        candidates.push({ name, address: address.address });
      }
    }
  }

  const preferred = candidates.find((candidate) => candidate.name === preferredInterface);
  return preferred?.address ?? candidates[0]?.address ?? "127.0.0.1";
}

function readName(buffer, offset, depth = 0) {
  if (depth > 8) return { name: "", offset };

  const labels = [];
  let cursor = offset;
  let nextOffset = null;

  while (cursor < buffer.length) {
    const length = buffer[cursor];

    if (length === 0) {
      cursor += 1;
      return { name: labels.join("."), offset: nextOffset ?? cursor };
    }

    if ((length & 0xc0) === 0xc0) {
      if (cursor + 1 >= buffer.length) return { name: labels.join("."), offset: buffer.length };
      const pointer = ((length & 0x3f) << 8) | buffer[cursor + 1];
      const pointed = readName(buffer, pointer, depth + 1);
      if (pointed.name) labels.push(...pointed.name.split("."));
      nextOffset ??= cursor + 2;
      return { name: labels.join("."), offset: nextOffset };
    }

    const start = cursor + 1;
    const end = start + length;
    if (end > buffer.length) return { name: labels.join("."), offset: buffer.length };
    labels.push(buffer.subarray(start, end).toString("utf8"));
    cursor = end;
  }

  return { name: labels.join("."), offset: nextOffset ?? cursor };
}

function readQuestions(buffer) {
  if (buffer.length < 12) return [];

  const questionCount = buffer.readUInt16BE(4);
  const questions = [];
  let offset = 12;

  for (let index = 0; index < questionCount; index += 1) {
    const parsed = readName(buffer, offset);
    offset = parsed.offset;
    if (offset + 4 > buffer.length) break;

    questions.push({
      name: normalizeName(parsed.name),
      type: buffer.readUInt16BE(offset),
      classCode: buffer.readUInt16BE(offset + 2)
    });
    offset += 4;
  }

  return questions;
}

function encodeName(name) {
  const labels = name.split(".");
  const parts = [];

  for (const label of labels) {
    const bytes = Buffer.from(label, "utf8");
    if (bytes.length > 63) throw new Error(`DNS label is too long: ${label}`);
    parts.push(Buffer.from([bytes.length]), bytes);
  }

  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function aRecord(name, ipAddress) {
  const nameBytes = encodeName(name);
  const record = Buffer.alloc(nameBytes.length + 14);
  let offset = 0;

  nameBytes.copy(record, offset);
  offset += nameBytes.length;
  record.writeUInt16BE(1, offset); // A
  offset += 2;
  record.writeUInt16BE(0x8001, offset); // IN with cache-flush bit
  offset += 2;
  record.writeUInt32BE(120, offset);
  offset += 4;
  record.writeUInt16BE(4, offset);
  offset += 2;

  for (const octet of ipAddress.split(".").map(Number)) {
    record[offset] = octet;
    offset += 1;
  }

  return record;
}

function responsePacket(records) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(records.length, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  return Buffer.concat([header, ...records]);
}

const names = namesFromEnv();
const nameSet = new Set(names);
const ipAddress = getIPv4Address();
const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

function buildAnswers(questions) {
  const requestedNames = new Set();

  for (const question of questions) {
    const wantsAddress = question.type === 1 || question.type === 255;
    if (wantsAddress && nameSet.has(question.name)) {
      requestedNames.add(question.name);
    }
  }

  return [...requestedNames].map((name) => aRecord(name, ipAddress));
}

function sendMulticast(packet) {
  socket.send(packet, 0, packet.length, MDNS_PORT, MDNS_ADDRESS);
}

function announce() {
  sendMulticast(responsePacket(names.map((name) => aRecord(name, ipAddress))));
}

socket.on("message", (message, remote) => {
  const questions = readQuestions(message);
  const answers = buildAnswers(questions);
  if (answers.length === 0) return;

  const packet = responsePacket(answers);
  const wantsUnicast = questions.some((question) => (question.classCode & 0x8000) !== 0);

  if (wantsUnicast) {
    socket.send(packet, 0, packet.length, remote.port, remote.address);
  } else {
    sendMulticast(packet);
  }
});

socket.on("error", (error) => {
  console.error(`mDNS responder error: ${error.message}`);
  process.exit(1);
});

socket.bind(MDNS_PORT, "0.0.0.0", () => {
  socket.setMulticastTTL(255);

  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      try {
        socket.addMembership(MDNS_ADDRESS, address.address);
      } catch {
        // Membership can already exist when multiple addresses share a socket.
      }
    }
  }

  announce();
  setInterval(announce, 60_000);
  console.log(`mDNS responder: ${names.join(", ")} -> ${ipAddress}`);
});
