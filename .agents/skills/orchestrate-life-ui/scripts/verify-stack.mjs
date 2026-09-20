import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(skillDirectory, "../../..");
const lockPath = path.join(skillDirectory, "references/vendor-lock.json");

async function collectFiles(directory, relativeDirectory = "") {
  const entries = await fs.readdir(path.join(directory, relativeDirectory), {
    withFileTypes: true
  });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

async function treeDigest(directory) {
  const digest = createHash("sha256");
  const files = await collectFiles(directory);

  for (const relativePath of files) {
    const content = await fs.readFile(path.join(directory, relativePath));
    digest.update(relativePath.split(path.sep).join("/"));
    digest.update("\0");
    digest.update(content);
    digest.update("\0");
  }

  return digest.digest("hex");
}

async function fileDigest(filePath) {
  return createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}

function readSkillName(content) {
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/u)?.[1] ?? "";
  return frontmatter.match(/^name:\s*(.+)$/mu)?.[1]?.trim() ?? null;
}

const lock = JSON.parse(await fs.readFile(lockPath, "utf8"));
const failures = [];

for (const vendorPackage of lock.packages) {
  const directory = path.join(repositoryRoot, vendorPackage.directory);
  const skillPath = path.join(directory, "SKILL.md");

  try {
    const skill = await fs.readFile(skillPath, "utf8");
    const actualName = readSkillName(skill);
    if (actualName !== vendorPackage.skillName) {
      failures.push(
        `${vendorPackage.id}: expected skill name ${vendorPackage.skillName}, found ${actualName ?? "none"}`
      );
    }

    const actualDigest = await treeDigest(directory);
    if (actualDigest !== vendorPackage.treeSha256) {
      failures.push(
        `${vendorPackage.id}: tree digest ${actualDigest} differs from lock ${vendorPackage.treeSha256}`
      );
    }

    const licensePath = path.join(repositoryRoot, vendorPackage.license);
    const actualLicenseDigest = await fileDigest(licensePath);
    if (actualLicenseDigest !== vendorPackage.licenseSha256) {
      failures.push(
        `${vendorPackage.id}: license digest ${actualLicenseDigest} differs from lock ${vendorPackage.licenseSha256}`
      );
    }
  } catch (error) {
    failures.push(`${vendorPackage.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const agentsPath = path.join(repositoryRoot, "AGENTS.md");
const uiUxPath = path.join(repositoryRoot, ".codex/skills/ui-ux-pro-max/SKILL.md");

for (const [label, filePath] of [
  ["AGENTS.md", agentsPath],
  ["ui-ux-pro-max", uiUxPath]
]) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    if (!content.includes("orchestrate-life-ui")) {
      failures.push(`${label}: orchestrate-life-ui integration marker is missing`);
    }
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error("Life Dashboard UI design stack verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Life Dashboard UI design stack verified: ${lock.packages.length} pinned vendor packages.`);
}
