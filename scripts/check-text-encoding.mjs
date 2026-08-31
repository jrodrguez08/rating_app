import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".mts",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "coverage",
  "node_modules",
]);
const EXCLUDED_FILES = new Set(["package-lock.json"]);
const MARKERS = [
  { label: "U+00C3 (likely UTF-8/Latin-1 mojibake)", value: "\u00c3" },
  { label: "U+00C2 (likely stray mojibake prefix)", value: "\u00c2" },
  { label: "U+FFFD (Unicode replacement character)", value: "\ufffd" },
  {
    label: "mojibake punctuation prefix",
    value: "\u00e2\u20ac",
  },
  {
    label: "mojibake replacement sequence",
    value: "\u00ef\u00bf\u00bd",
  },
];

const violations = [];
for (const file of await sourceFiles(ROOT)) {
  const content = await readFile(file, "utf8");
  for (const marker of MARKERS) {
    let offset = content.indexOf(marker.value);
    while (offset !== -1) {
      violations.push({
        file: path.relative(ROOT, file),
        line: content.slice(0, offset).split("\n").length,
        marker: marker.label,
      });
      offset = content.indexOf(marker.value, offset + marker.value.length);
    }
  }
}

if (violations.length > 0) {
  console.error("Known mojibake markers found:");
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} — ${violation.marker}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log("Text encoding check passed.");
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(target)));
    } else if (
      entry.isFile() &&
      !EXCLUDED_FILES.has(entry.name) &&
      TEXT_EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(target);
    }
  }
  return files;
}
