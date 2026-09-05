import fs from "node:fs";
import { randomUUID } from "node:crypto";

export function atomicWrite(filePath: string, contents: string) {
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  const mode = fs.existsSync(filePath) ? fs.statSync(filePath).mode & 0o777 : 0o600;
  try {
    const fd = fs.openSync(tmpPath, "wx", mode);
    try { fs.writeFileSync(fd, contents); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    fs.renameSync(tmpPath, filePath);
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}
