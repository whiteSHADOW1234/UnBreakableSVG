#!/usr/bin/env node
/**
 * scripts/merge-layout.js
 *
 * This updated version preserves each element's inner <svg> as-is and wraps it in a group
 * that applies translate(x,y) and scale(s,s) where s = element.dimensions.width / innerSvgWidth.
 *
 * Usage:
 *   node scripts/merge-layout.js --layout mergesvg-layout.json --out out/merged.svg
 */

const fs = require('fs').promises;
const path = require('path');

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
  // Try base64 -> if result contains '<svg' return it
  try {
    const buf = Buffer.from(s, 'base64');
    const decoded = buf.toString('utf8');
    if (decoded.includes('<svg')) return decoded;
  } catch (e) {}
  // sometimes URL-safe base64
  try {
    const safe = s.replace(/-/g, '+').replace(/_/g, '/');
    const buf2 = Buffer.from(safe, 'base64');
    const d2 = buf2.toString('utf8');
    if (d2.includes('<svg')) return d2;
  } catch (e) {}
  // fallback assume plain svg text
  return s;
}

function stripXmlProlog(s) {
  return s.replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '').trim();
}

function extractInnerSvgAttributes(svgText) {
  // Return object with width, height, viewBoxParts (array [x,y,w,h]), and rawWidth/height strings
  const res = { width: null, height: null, viewBox: null };

  // viewBox
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

  // width/height attributes
  const wMatch = svgText.match(/<svg[^>]*\bwidth\s*=\s*(['"])?([0-9.]+)([a-z%]*)\1?/i);
  const hMatch = svgText.match(/<svg[^>]*\bheight\s*=\s*(['"])?([0-9.]+)([a-z%]*)\1?/i);
  if (wMatch) {
    res.width = Number(wMatch[2]);
  }
  if (hMatch) {
    res.height = Number(hMatch[2]);
  }
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

  // compute background fill: if transparency provided -> use rgba(...)
  let bgFill = canvas.backgroundColor || '#ffffff';
  if (typeof canvas.transparency === 'number') {
    const rgb = hexToRgb(bgFill);
    const alpha = Number(canvas.transparency);
    if (rgb) {
      bgFill = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
    } else {
      // fallback if backgroundColor not hex
      bgFill = `rgba(255,255,255,${alpha})`;
    }
  }

  // header
  const header = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">
<rect width="${canvasW}" height="${canvasH}" fill="${bgFill}"/>
`;

  const elements = Array.isArray(layout.elements) ? layout.elements : [];
  const pieces = [];

  for (const el of elements) {
    try {
      const raw = el.content || '';
      const decoded = tryBase64Decode(raw);
      const svgText = stripXmlProlog(decoded);

      // get inner SVG numeric width from viewBox or width attribute
      const attrs = extractInnerSvgAttributes(svgText);
      const innerW = (attrs.width && Number(attrs.width)) || null;
      const innerH = (attrs.height && Number(attrs.height)) || null;

      // element target dimension (use width from layout.element.dimensions if present)
      const dims = el.dimensions || {};
      const targetW = typeof dims.width === 'number' ? dims.width : null;
      const targetH = typeof dims.height === 'number' ? dims.height : null;

      // compute scale: prefer width ratio if both available; otherwise fallback to 1
      let scale = 1;
      if (innerW && targetW) {
        scale = targetW / innerW;
      } else if (innerH && targetH) {
        scale = targetH / innerH;
      } else if (innerW && targetH) {
        scale = targetH / innerW; // fallback
      }

      // position
      const pos = el.position || {};
      const x = Number(pos.x || 0);
      const y = Number(pos.y || 0);

      // Build wrapper group: translate(x,y) scale(scale,scale)
      // Keep the decoded svg unchanged inside (so it preserves its viewBox, title, styles, defs).
      const elementFragment = `  <g transform="translate(${x},${y}) scale(${scale},${scale})">
${svgText.split('\n').map(line => '    ' + line).join('\n')}
  </g>
`;

      pieces.push(elementFragment);
    } catch (e) {
      console.warn('Warning: failed to process element', el && (el.name || el.id), e && e.message ? e.message : e);
    }
  }

  const footer = `</svg>\n`;
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
