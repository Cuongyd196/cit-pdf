import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const docsDistPath = path.join(projectRoot, 'docs', '.vitepress', 'dist');
const mainDistPath = path.join(projectRoot, 'dist');
const targetDocsPath = path.join(mainDistPath, 'docs');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('Including docs in dist...');

if (!fs.existsSync(docsDistPath)) {
  console.error(
    'Error: Docs build not found. Please run "npm run docs:build" first.'
  );
  process.exit(1);
}
if (!fs.existsSync(mainDistPath)) {
  console.error(
    'Error: Main dist folder not found. Please run "npm run build" first.'
  );
  process.exit(1);
}

try {
  console.log(`Copying from: ${docsDistPath}`);
  console.log(`Copying to: ${targetDocsPath}`);

  copyDir(docsDistPath, targetDocsPath);

  console.log('Docs successfully included in dist/docs!');

  const files = fs.readdirSync(targetDocsPath);
  console.log(`Copied ${files.length} items to dist/docs`);

  addDocsToSitemap();
} catch (error) {
  console.error('Error copying docs:', error.message);
  process.exit(1);
}

function listDocsHtml(dir, prefix) {
  const urls = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'assets' || entry.name.startsWith('.')) continue;
      urls.push(
        ...listDocsHtml(path.join(dir, entry.name), `${prefix}/${entry.name}`)
      );
    } else if (entry.name.endsWith('.html') && entry.name !== '404.html') {
      const slug = entry.name.replace(/\.html$/, '');
      urls.push(slug === 'index' ? `${prefix}/` : `${prefix}/${slug}`);
    }
  }
  return urls;
}

function addDocsToSitemap() {
  const siteUrl = (process.env.SITE_URL || 'https://www.bentopdf.com').replace(
    /\/+$/,
    ''
  );
  const sitemapPath = path.join(mainDistPath, 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) {
    console.warn(
      'sitemap.xml not found in dist; skipping docs sitemap entries'
    );
    return;
  }
  let xml = fs.readFileSync(sitemapPath, 'utf-8');
  if (xml.includes(`<loc>${siteUrl}/docs/</loc>`)) return;

  const urls = listDocsHtml(targetDocsPath, '/docs');
  const entries = urls
    .map(
      (url) =>
        `  <url>\n    <loc>${siteUrl}${url}</loc>\n    <priority>0.6</priority>\n  </url>\n`
    )
    .join('');
  xml = xml.replace('</urlset>', `${entries}</urlset>`);
  fs.writeFileSync(sitemapPath, xml);
  console.log(`Added ${urls.length} docs URLs to sitemap.xml`);
}
