/* Runs every browser journey in turn and exits non-zero when any step fails. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { BASE } = require("./lib.cjs");

const journeys = [
  ["journey.cjs", "create, insert, edit, pages, templates, downloads, persistence"],
  ["features.cjs", "text formatting, effects, layers, uploads, crop, filters, background, resize, find, present"],
  ["dashboard.cjs", "home, templates, create dialog, trash, projects, brand"],
  ["backup.cjs", "back up everything, restore it in an empty browser, restore twice, a file that is not a backup, a damaged backup, the dialog on a phone"],
  [
    "migrate.cjs",
    "designs and a library from another version: an old design opens whole, a newer one is refused and left alone, a backup keeps it as stored, another tab upgrading the database makes this tab save first and say so",
  ],
  ["pen.cjs", "the Pen tool and the points of a path: place points, pull a curve, close, undo, edit points, add and delete one, export as SVG, reload"],
  ["combine.cjs", "combine shapes (union, subtract, intersect, exclude) read from the pixels, a turned shape, nothing in common, convert to path, undo, reload"],
  ["connect.cjs", "arrows attached to shapes: Connect by mouse, keyboard and menu, dragging a box takes its arrow along (read from the pixels), undo, delete, duplicate, reload"],
  [
    "live.cjs",
    "editing together in three browsers against the real server: start from Share, join by the edit link, a view link that only looks, pointer drags, simultaneous edits, undo of one's own steps, reload, stop sharing",
  ],
  [
    "hostile.cjs",
    "a link that leads to a server that cannot be trusted: a design with code in it is refused in words and nothing of it is kept, an honest server opens the design, the same server turning hostile is left at once and the design stays as it was",
  ],
  ["animate.cjs", "element and page animations, timing, transitions, preview, motion templates"],
  ["present.cjs", "full-screen show: entrance animations, transitions both ways, auto-play, reduced motion"],
  ["animated-export.cjs", "animated GIF and WebM downloads: structure, length, loop, decoded by the browser, cancel"],
  ["a11y.cjs", "keyboard and screen reader basics: the first Tab reaches a control, the canvas is a stop, focus goes back after a dialog, headings and landmarks"],
  [
    "ml.cjs",
    "on-device photo tools without a download: consent gate, models dialog, the real ONNX runtime on WebGPU in its worker, cut-out, blurred background, colour pop and upscaler against hand-made models (the GPU steps skip without WebGPU)",
  ],
];
if (process.env.OFFLINE) {
  journeys.push(["offline.cjs", "service worker: reload and work offline (needs a production preview, see e2e/README.md)"]);
  journeys.push([
    "update.cjs",
    "service worker updates: a new build waits, open tabs are asked to reload, Reload saves and switches, the build before is kept (needs dist-e2e, see e2e/README.md)",
  ]);
}

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
