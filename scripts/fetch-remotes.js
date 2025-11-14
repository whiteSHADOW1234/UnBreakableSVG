#!/usr/bin/env node
/**
 * scripts/fetch-remotes.js
 *
 * Reads a layout JSON and downloads any SVGs referenced via `remoteUrl`.
 * Supports http/https and data: URIs. Files are saved under the specified
 * output directory using a deterministic SHA1 filename so the merge step
 * can locate them reliably.
 *
 * Usage:
 *   node scripts/fetch-remotes.js --layout mergesvg-layout.json --outdir out/remotes
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

function usageAndExit(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node scripts/fetch-remotes.js --layout mergesvg-layout.json --outdir out/remotes');
  process.exit(msg ? 2 : 1);
}

const argv = process.argv.slice(2);
const opts = { layout: null, outdir: 'out/remotes' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--layout') opts.layout = argv[++i];
  else if (a === '--outdir') opts.outdir = argv[++i];
  else usageAndExit(`Unknown option: ${a}`);
}
if (!opts.layout) usageAndExit('Missing --layout');

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

function sha1Hex(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

function decodeDataUri(uri) {
  // data:[<mediatype>][;base64],<data>
  const m = /^data:([^,]*?),(.*)$/i.exec(uri);
  if (!m) return null;
  const meta = m[1] || '';
  const data = m[2] || '';
  const isBase64 = /;base64/i.test(meta);
  try {
    return isBase64 ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
  } catch (_) {
    return null;
  }
}

async function fetchTextWithTimeout(url, ms = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(id);
  }
}

async function ensureDir(d) {
  await fs.mkdir(d, { recursive: true });
}

async function main() {
  const layoutPath = path.resolve(opts.layout);
  const outdir = path.resolve(opts.outdir);
  const layout = await readJson(layoutPath);

  const elements = Array.isArray(layout.elements) ? layout.elements : [];
  if (!elements.length) {
    console.log('No elements found in layout; nothing to fetch');
    return;
  }

  await ensureDir(outdir);

  let fetched = 0;
  for (const el of elements) {
    const url = el && el.remoteUrl;
    if (!url || typeof url !== 'string' || !url.trim()) continue;

    try {
      let svgText = null;
      if (/^data:/i.test(url)) {
        svgText = decodeDataUri(url);
        if (svgText == null) throw new Error('Failed to decode data URI');
      } else if (/^https?:\/\//i.test(url)) {
        svgText = await fetchTextWithTimeout(url, 12000);
      } else {
        // Unsupported scheme; skip here (merge script may handle local paths)
        console.warn(`Skipping unsupported remoteUrl (not http(s)/data): ${url}`);
        continue;
      }

      if (!svgText || !svgText.includes('<svg')) {
        throw new Error('Fetched content is not SVG text');
      }

      const fname = sha1Hex(url) + '.svg';
      const fpath = path.join(outdir, fname);
      await fs.writeFile(fpath, svgText, 'utf8');
      fetched++;
      console.log(`Saved ${url} -> ${path.relative(process.cwd(), fpath)}`);
    } catch (e) {
      console.warn(`Warn: failed to fetch ${url}: ${e && e.message ? e.message : e}`);
    }
  }

  console.log(`Done. Fetched ${fetched} remote SVG(s) to ${outdir}`);
}

main().catch(err => {
  console.error('Fatal:', err && err.stack ? err.stack : err);
  process.exit(2);
});
