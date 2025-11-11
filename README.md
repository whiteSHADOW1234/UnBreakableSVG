# UnBreakableSVG GitHub Action (workflow + script)

This repository contains a GitHub workflow + Node script that reads a layout JSON file like `mergesvg-layout.json` and outputs a single merged SVG (`out/merged.svg` by default).

The layout file should contain:
- `canvas` object (width, height, backgroundColor)
- `elements` array, each element contains `content` (SVG text *or* base64-encoded SVG), `position`: {x,y}, and optional `dimensions`.

Example: the repository includes `mergesvg-layout.json` (uploaded). :contentReference[oaicite:2]{index=2}

## Usage
- Locally: `npm run merge`
- In CI: see `.github/workflows/merge-svgs.yml` (runs when `mergesvg-layout.json` is changed)

The script will:
- decode base64 element content if needed,
- strip outer `<svg>` wrappers and insert element inner content into the final canvas,
- respect element `position.x` and `position.y`,
- write out `out/merged.svg`.

