/* Runs every browser journey in turn and exits non-zero when any step fails. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { BASE } = require("./lib.cjs");

const journeys = [
  ["journey.cjs", "create, insert, edit, pages, templates, downloads, persistence"],
  ["features.cjs", "text formatting, effects, layers, uploads, crop, filters, background, resize, find, present"],
  ["dashboard.cjs", "home, templates, create dialog, trash, projects, brand"],
  ["animate.cjs", "element and page animations, timing, transitions, preview, motion templates"],
  ["present.cjs", "full-screen show: entrance animations, transitions both ways, auto-play, reduced motion"],
  ["animated-export.cjs", "animated GIF and WebM downloads: structure, length, loop, decoded by the browser, cancel"],
  ["a11y.cjs", "keyboard and screen reader basics: the first Tab reaches a control, the canvas is a stop, focus goes back after a dialog, headings and landmarks"],
  [
    "ml.cjs",
    "on-device photo tools without a download: consent gate, models dialog, the real ONNX runtime on WebGPU in its worker, cut-out, blurred background, colour pop and upscaler against hand-made models (the GPU steps skip without WebGPU)",
  ],
];
if (process.env.OFFLINE) journeys.push(["offline.cjs", "service worker: reload and work offline (needs a production preview, see e2e/README.md)"]);

console.log(`Running against ${BASE}\n`);
let failed = 0;
for (const [file, what] of journeys) {
  console.log(`=== ${file}: ${what}`);
  const res = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit", env: process.env });
  if (res.status !== 0) failed++;
  console.log("");
}
console.log(failed ? `${failed} journey(s) reported failures` : "All journeys passed");
process.exit(failed ? 1 : 0);
