import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['src/js', 'bentopdf-pymupdf-wasm/src', 'cloudflare'];
const SKIP = ['node_modules', 'dist', '.git', 'coverage', 'tests', 'test'];

const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (
      SKIP.some(
        (s) =>
          full.includes(`${path.sep}${s}${path.sep}`) ||
          full.endsWith(`${path.sep}${s}`)
      )
    ) {
      continue;
    }
    if (e.isDirectory()) walk(full);
    else if (/\.(ts|js|mjs)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name))
      checkFile(full);
  }
}

function checkFile(file) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf-8');
  const lines = src.split('\n');

  // Rule 1: no raw string interpolation into a Python/eval template.
  const codeSink = /(runPython|\.eval)\s*\(\s*`/;
  for (let i = 0; i < lines.length; i++) {
    if (codeSink.test(lines[i])) {
      for (let j = i; j < Math.min(i + 60, lines.length); j++) {
        const interps = lines[j].match(/\$\{[^}]+\}/g) || [];
        for (const it of interps) {
          const danger =
            /^\$\{\s*(text|name|uri|url|format|password|passwd|title|label|filename|content|search|searchText|query|font|fontname|intent|usage|replaceText)\s*(\}|\.|\))/.test(
              it
            );
          const safe = /pyStr|JSON\.stringify|escapeHtml/.test(it);
          if (danger && !safe) {
            findings.push({
              rule: 'code-injection',
              file: rel,
              line: j + 1,
              detail: `Unescaped user-string interpolation ${it} into a Python/eval template — pass it via pyStr()/JSON.stringify()/globals.set().`,
            });
          }
        }
        if (lines[j].includes('`)') || lines[j].trim().endsWith('`);')) break;
      }
    }
  }

  // Rule 2: string mutation applied AFTER a sanitize call (sanitize-then-mutate).
  const sanitizeLine = lines.findIndex((l) =>
    /DOMPurify\.sanitize|sanitizeEmailHtml|sanitize\(/.test(l)
  );
  if (sanitizeLine !== -1) {
    for (
      let j = sanitizeLine + 1;
      j < Math.min(sanitizeLine + 40, lines.length);
      j++
    ) {
      if (
        /\.replace\(|innerHTML\s*=|\+=\s*`/.test(lines[j]) &&
        !/escapeHtml|escapeHTML|DOMPurify/.test(lines[j])
      ) {
        findings.push({
          rule: 'sanitize-then-mutate',
          file: rel,
          line: j + 1,
          detail: `Possible mutation of sanitized HTML. Escape/validate at the final sink, or re-sanitize after mutation.`,
        });
        break;
      }
    }
  }
}

for (const d of SCAN_DIRS) walk(path.join(ROOT, d));

const blocking = findings.filter((f) => f.rule === 'code-injection');
const warnings = findings.filter((f) => f.rule !== 'code-injection');

for (const f of warnings) {
  console.warn(`  ⚠ [${f.rule}] ${f.file}:${f.line}\n     ${f.detail}`);
}
if (warnings.length) {
  console.warn(
    `\n${warnings.length} sanitize-then-mutate warning(s) — review each: escape/validate at the final sink.\n`
  );
}

if (blocking.length === 0) {
  console.log('✅ security-patterns-check: no code-injection patterns found');
  process.exit(0);
}

console.error(
  `\n❌ security-patterns-check found ${blocking.length} code-injection issue(s):\n`
);
for (const f of blocking) {
  console.error(`  [${f.rule}] ${f.file}:${f.line}\n     ${f.detail}\n`);
}
console.error(
  'This pattern caused a prior CVE (pymupdf runPython injection). Pass values via pyStr()/JSON.stringify()/globals.set().\n'
);
process.exit(1);
