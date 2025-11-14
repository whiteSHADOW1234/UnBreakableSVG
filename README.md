# UnBreakableSVG

![Banner](UnBreakableSVG.jpeg)

**UnBreakable** is a plug-and-play GitHub Action that reliably merges multiple SVGs into a single, polished canvas using a tiny JSON layout.
It’s perfect for README banners, dashboards, badge boards, or any place you want composed SVGs that never “break” after edits.

## Sample Usage
![UnbreakableSVG](out/merged.svg)

## Why UnBreakableSVG?
After spending hours perfecting an SVG layout, nothing’s more frustrating than seeing a broken image in your README or on your site. **UnBreakableSVG** solves that problem by turning your SVG files into a reliable, automated asset. It composes, scales, and refreshes your SVGs from a single JSON layout and can auto-commit updates on a schedule.

## Features
- **Smart Layout Control** — Define where and how each SVG appears using a lightweight JSON layout.
- **Accurate Scaling** — Each element scales automatically based on its target width/height.
- **Custom Backgrounds** — Support for solid or transparent backgrounds with rounded corners.
- **Auto Updates** — A built-in scheduler regenerates and pushes fresh merged SVGs every 6 hours.
- **Fully CI/CD Ready** — Works out of the box with GitHub Actions using Node.js 18+.
- **Composable** — Each element can come from a local file, base64-encoded string, or even remote SVG.


## How to use
1. Add this repo’s [`.github/workflows/merge-svgs.yml`](.github/workflows/merge-svgs.yml) to your project.
2. Edit `mergesvg-layout.json` (or use [MergeSVG](https://github.com/whiteSHADOW1234/MergeSVG)
) to specify which SVGs to merge and their sizes/positions.
3. Commit and push changes to trigger the Action to regenerate the merged SVG.
4. A scheduled workflow refreshes the merged SVG every six hours automatically.
5. Embed or reference the output (e.g. `![UnBreakable SVG](out/merged.svg)`) in your README or website.


> [!NOTE] 
> **Scheduled Auto-Commit**
> The built-in cron job regenerates and commits merged SVGs every 6 hours:
> ```
> schedule:
>   - cron: '0 */6 * * *'
> ```
> You can adjust the interval or disable commits by editing the workflow file.


## Quick Start Command (Local)
You can also run the merge locally:
```
npm install
node scripts/merge-layout.js --layout mergesvg-layout.json --out out/merged.svg
```


## JSON Example
Create `mergesvg-layout.json` with a `canvas` and an `elements` array:
```
{
  "canvas": {
    "width": 800,
    "height": 400,
    "backgroundColor": "#ffffff",
    "transparency": 1
  },
  "elements": [
    {
      "content": "<svg>...</svg>",
      "position": { "x": 20, "y": 40 },
      "dimensions": { "width": 200, "height": 100 }
    },
    {
      "content": "PHN2ZyB3aWR0aD0nMTI4JyBoZWlnaHQ9JzMyJz4KPC9zdmc+", 
      "position": { "x": 260, "y": 40 },
      "dimensions": { "width": 128, "height": 32 }
    }
  ]
}

```
After the workflow runs, you’ll get an auto-generated file at: `out/merged.svg`, which looks exactly like your defined layout and will be refreshed automatically on schedule.


## Contributing
Pull requests and Issues are welcome!
Ideas for improvement include but not limited to:
- adding per-element backgrounds or borders,
- adding remote SVG fetch support,
- or exporting multiple merged canvases at once.

## License
This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
