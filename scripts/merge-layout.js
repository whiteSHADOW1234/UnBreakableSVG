#!/usr/bin/env node
/**
 * scripts/merge-layout.js
 *
 * Preserves animations by:
 * - Embedding each element as a nested <svg> positioned via x/y and scaled using width/height (no CSS transform()).
 * - Keeping original viewBox/preserveAspectRatio and inner content.
 * - Removing animation-killing CSS (animation-duration: 0s, animation-delay: 0s, shorthand with 0s).
 *
 * Usage:
 *   node scripts/merge-layout.js --layout mergesvg-layout.json --out out/merged.svg
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

function usageAndExit(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node scripts/merge-layout.js --layout mergesvg-layout.json --out out/merged.svg');
  process.exit(msg ? 2 : 1);
}

const argv = process.argv.slice(2);
const opts = { layout: null, out: 'out/merged.svg' };

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--layout') opts.layout = argv[++i];
  else if (a === '--out') opts.out = argv[++i];
  else usageAndExit(`Unknown option: ${a}`);
}
if (!opts.layout) usageAndExit('Missing --layout argument');

async function readLayout(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

function tryBase64Decode(s) {
  if (!s) return '';
  try {
    const buf = Buffer.from(s, 'base64');
    const decoded = buf.toString('utf8');
    if (decoded.includes('<svg')) return decoded;
  } catch (e) {}
  try {
    const safe = s.replace(/-/g, '+').replace(/_/g, '/');
    const buf2 = Buffer.from(safe, 'base64');
    const d2 = buf2.toString('utf8');
    if (d2.includes('<svg')) return d2;
  } catch (e) {}
  return s;
}

function stripXmlProlog(s) {
  return s.replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '').trim();
}

// Remove CSS that disables animations (duration/delay set to 0s or shorthand with 0s)
function sanitizeAnimationOverrides(svg) {
  if (!svg) return svg;
  let out = svg;

  // Remove universal blocks that zero animations: * { animation-duration: 0s ...; animation-delay: 0s ...; }
  const universalAnimBlock = /\*\s*\{[^}]*\b(animation-duration\s*:\s*0s[^;]*;|animation-delay\s*:\s*0s[^;]*;)[^}]*\}/gim;
  out = out.replace(universalAnimBlock, '');

  // Remove explicit 0s properties anywhere inside style tags
  const durationZero = /animation-duration\s*:\s*0s[^;]*;?/gim;
  const delayZero = /animation-delay\s*:\s*0s[^;]*;?/gim;
  out = out.replace(durationZero, '');
  out = out.replace(delayZero, '');

  // Remove animation shorthand that includes 0s duration: animation: name 0s ...
  const shorthandZero = /animation\s*:\s*([^;}]*)\b0s\b([^;}]*)[;]?/gim;
  out = out.replace(shorthandZero, '');

  return out;
}

function sha1Hex(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

function decodeDataUri(uri) {
  const m = /^data:([^,]*?),(.*)$/i.exec(uri || '');
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

async function tryReadFileMaybe(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (_) {
    return null;
  }
}

async function resolveSvgSource(el, repoRoot) {
  // 1) Try remote URL (http(s) or data URI)
  const remote = el && (el.remoteURL || el.remoteUrl);
  if (remote && typeof remote === 'string' && remote.trim()) {
    try {
      if (/^data:/i.test(remote)) {
        const txt = decodeDataUri(remote);
        if (txt && txt.includes('<svg')) return txt;
      } else if (/^https?:\/\//i.test(remote)) {
        const txt = await fetchTextWithTimeout(remote, 12000);
        if (txt && txt.includes('<svg')) return txt;
      }
    } catch (_) {
      // swallow, continue to fallbacks
    }
  }

  // 2) Try explicit local path in repo
  const localPath = (el && (el.file || el.localPath)) ? String(el.file || el.localPath) : null;
  if (localPath) {
    const abs = path.resolve(repoRoot, localPath);
    const txt = await tryReadFileMaybe(abs);
    if (txt && txt.includes('<svg')) return txt;
  }

  // 3) Try deterministic stash created by fetch-remotes step
  if (remote && typeof remote === 'string') {
    const fname = sha1Hex(remote) + '.svg';
    const stash = path.resolve(repoRoot, 'out', 'remotes', fname);
    const txt = await tryReadFileMaybe(stash);
    if (txt && txt.includes('<svg')) return txt;
  }

  // 4) Fallback to inline content
  const raw = el && el.content ? String(el.content) : '';
  const decoded = tryBase64Decode(raw);
  return decoded;
}

// Extract opening <svg ...> attributes and inner content
function extractSvgParts(svgText) {
  const cleaned = stripXmlProlog(svgText);
  const openMatch = cleaned.match(/<svg([^>]*)>/i);
  if (!openMatch) {
    throw new Error('No <svg> root element found');
  }
  const openTagAttrs = openMatch[1] || '';
  const innerStart = openMatch.index + openMatch[0].length;
  const closeMatch = cleaned.match(/<\/svg>\s*$/i);
  const innerEnd = closeMatch ? closeMatch.index : cleaned.length;
  const inner = cleaned.slice(innerStart, innerEnd);

  // parse attributes into object
  const attrs = {};
  const attrRegex = /(\b[a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['"])(.*?)\2/g;
  let m;
  while ((m = attrRegex.exec(openTagAttrs))) {
    attrs[m[1]] = m[3];
  }
  return { inner, attrs };
}

function parseNumeric(val) {
  if (val == null) return null;
  const n = Number(String(val).replace(/[a-zA-Z%]+$/, ''));
  return Number.isFinite(n) ? n : null;
}

function getViewBoxString(attrs, fallbackW, fallbackH) {
  if (attrs.viewBox) {
    return String(attrs.viewBox).trim(); // Preserve origin
  }
  const w = parseNumeric(attrs.width);
  const h = parseNumeric(attrs.height);
  if (w && h) return `0 0 ${w} ${h}`;
  if (fallbackW && fallbackH) return `0 0 ${fallbackW} ${fallbackH}`;
  return '0 0 100 100';
}

function extractInnerSvgAttributes(svgText) {
  const res = { width: null, height: null, viewBox: null };
  const vbMatch = svgText.match(/viewBox\s*=\s*(['"])(.*?)\1/i);
  if (vbMatch) {
    const parts = vbMatch[2].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(n => !Number.isNaN(n))) {
      res.viewBox = parts; // [x,y,w,h]
      res.width = parts[2];
      res.height = parts[3];
      return res;
    }
  }
  const wMatch = svgText.match(/<svg[^>]*\bwidth\s*=\s*(['"])?([0-9.]+)([a-z%]*)\1?/i);
  const hMatch = svgText.match(/<svg[^>]*\bheight\s*=\s*(['"])?([0-9.]+)([a-z%]*)\1?/i);
  if (wMatch) res.width = Number(wMatch[2]);
  if (hMatch) res.height = Number(hMatch[2]);
  return res;
}

function hexToRgb(hex) {
  if (!hex) return null;
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b];
}

async function main() {
  const layoutPath = path.resolve(opts.layout);
  const layout = await readLayout(layoutPath);

  const canvas = layout.canvas || {};
  const canvasW = Math.round(canvas.width || 800);
  const canvasH = Math.round(canvas.height || 200);

  // compute background fill
  let bgFill = canvas.backgroundColor || '#ffffff';
  if (typeof canvas.transparency === 'number') {
    const rgb = hexToRgb(bgFill);
    const alpha = Number(canvas.transparency);
    bgFill = rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})` : `rgba(255,255,255,${alpha})`;
  }

  const header = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
<rect width="${canvasW}" height="${canvasH}" fill="${bgFill}"/>
`;

  const elements = Array.isArray(layout.elements) ? layout.elements : [];
  const pieces = [];

  for (const el of elements) {
    try {
      const repoRoot = process.cwd();
      const resolved = await resolveSvgSource(el, repoRoot);
      if (!resolved) throw new Error('No SVG source available for element');

      // IMPORTANT: sanitize animation overrides from generators (duration/delay 0s)
      const sanitized = sanitizeAnimationOverrides(resolved);

      const svgText = stripXmlProlog(sanitized);

      // Extract parts and attributes from original root <svg>
      const { inner, attrs } = extractSvgParts(svgText);

      // Target dimensions from layout
      const dims = el.dimensions || {};
      const targetW = typeof dims.width === 'number' ? dims.width : null;
      const targetH = typeof dims.height === 'number' ? dims.height : null;

      // Fallback sizes if target dims missing
      const fallback = extractInnerSvgAttributes(svgText);
      const finalW = targetW || fallback.width || 100;
      const finalH = targetH || fallback.height || 100;

      // Compute viewBox to preserve original coordinate system
      const viewBoxStr = getViewBoxString(attrs, finalW, finalH);

      // Preserve preserveAspectRatio if present
      const par = attrs.preserveAspectRatio ? ` preserveAspectRatio="${attrs.preserveAspectRatio}"` : '';

      // Position
      const pos = el.position || {};
      const x = Number(pos.x || 0);
      const y = Number(pos.y || 0);

      // Build nested <svg> per element
      const elementFragment = `  <svg x="${x}" y="${y}" width="${finalW}" height="${finalH}" viewBox="${viewBoxStr}"${par}>
${inner}
  </svg>
`;

      pieces.push(elementFragment);
    } catch (e) {
      console.warn('Warning: failed to process element', el && (el.name || el.id), e && e.message ? e.message : e);
    }
  }

  const footer = `</svg>
`;
  const merged = header + pieces.join('\n') + footer;

  const outPath = path.resolve(opts.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, merged, 'utf8');
  console.log(`Merged SVG written to ${outPath}`);
}

main().catch(err => {
  console.error('Fatal:', err && err.stack ? err.stack : err);
  process.exit(2);
});