#!/usr/bin/env node
// Offline engine pack for CIT-PDF desktop: every engine the installer does
// not carry, fetched from the manifest's own URLs and checked against its
// hashes, under the names the app looks for (each URL's last part). Copy the
// folder to a computer whose network blocks the sources, then use
// Settings > Engines > "Install from folder…" there.
//
//   npm run desktop:modules-pack        -> release/cit-pdf-modules/
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(
  readFileSync(resolve(root, 'desktop', 'app', 'modules-manifest.json'), 'utf8')
);
const { version } = JSON.parse(
  readFileSync(resolve(root, 'desktop', 'package.json'), 'utf8')
);
const out = resolve(root, 'release', 'cit-pdf-modules');
mkdirSync(out, { recursive: true });

const packName = (url) => decodeURIComponent(basename(new URL(url).pathname));
const digest = (algorithm, bytes, encoding) =>
  createHash(algorithm).update(bytes).digest(encoding);

/** Downloads url to the pack unless a file with the right hash is there. */
async function fetchChecked(url, matches) {
  const target = resolve(out, packName(url));
  if (existsSync(target) && matches(readFileSync(target))) {
    console.log(`   ${packName(url)}: already in the pack`);
    return;
  }
  console.log(`   Fetching ${packName(url)}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (!matches(bytes)) throw new Error(`${packName(url)}: hash does not match`);
  writeFileSync(target, bytes);
}

const listed = [];
for (const [name, item] of Object.entries(manifest.modules)) {
  if (item.bundled) continue;
  if (item.kind === 'npm-tarball') {
    const expected = item.integrity.replace(/^sha512-/, '');
    await fetchChecked(
      item.url,
      (bytes) => digest('sha512', bytes, 'base64') === expected
    );
    listed.push(`${packName(item.url)}  (${name} ${item.version})`);
  } else {
    for (const file of item.files) {
      await fetchChecked(
        file.url,
        (bytes) => digest('sha256', bytes, 'hex') === file.sha256
      );
      listed.push(`${packName(file.url)}  (${name} ${item.version})`);
    }
  }
}

writeFileSync(
  resolve(out, 'DOC-TOI.txt'),
  [
    `Gói bộ xử lý offline cho CIT-PDF ${version}`,
    '',
    'Dùng khi mạng cơ quan chặn việc tải bộ xử lý (PDF sang Word, Office sang PDF...).',
    '',
    'Cách cài:',
    '1. Chép cả thư mục này sang máy cần cài (USB, ổ mạng).',
    '2. Mở CIT-PDF > Cài đặt > Bộ xử lý > "Cài từ thư mục…".',
    '3. Chọn thư mục này. Ứng dụng kiểm tra mã băm từng tệp trước khi cài.',
    '',
    'Các tệp:',
    ...listed.map((line) => `- ${line}`),
    '',
  ].join('\r\n')
);
console.log(`Offline pack ready: ${out}`);
