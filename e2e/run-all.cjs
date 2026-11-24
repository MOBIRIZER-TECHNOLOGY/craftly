/* Runs every browser journey in turn and exits non-zero when any step fails. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { BASE } = require("./lib.cjs");

const journeys = [
  ["journey.cjs", "create, insert, edit, pages, templates, downloads, persistence"],
  ["features.cjs", "text formatting, effects, layers, uploads, crop, filters, background, resize, find, present"],
  ["dashboard.cjs", "home, templates, create dialog, trash, projects, brand"],
  [
    "onboarding.cjs",
    "the first visit: the welcome on an empty Home and its three ways to begin, dismissed by keyboard and kept dismissed, never shown with a design, the editor's note on an empty page, a phone in English and Hindi",
  ],
  ["backup.cjs", "back up everything, restore it in an empty browser, restore twice, a file that is not a backup, a damaged backup, the dialog on a phone"],
  [
    "migrate.cjs",
    "designs and a library from another version: an old design opens whole, a newer one is refused and left alone, a backup keeps it as stored, another tab upgrading the database makes this tab save first and say so",
  ],
  ["pen.cjs", "the Pen tool and the points of a path: place points, pull a curve, close, undo, edit points, add and delete one, export as SVG, reload"],
  ["combine.cjs", "combine shapes (union, subtract, intersect, exclude) read from the pixels, a turned shape, nothing in common, convert to path, undo, reload"],
  [
    "blend.cjs",
    "blend modes read from the pixels: the Blend mode box (mouse, keyboard, Normal), all fifteen modes against the compositing standard on the page, in the exported PNG and in the exported SVG, a group mixed as one, a text, transparency, undo, a copy, reload",
  ],
  ["connect.cjs", "arrows attached to shapes: Connect by mouse, keyboard and menu, dragging a box takes its arrow along (read from the pixels), undo, delete, duplicate, reload"],
  [
    "live.cjs",
    "editing together in three browsers against the real server: start from Share, join by the edit link, a view link that only looks, pointer drags, simultaneous edits, undo of one's own steps, reload, stop sharing",
  ],
  [
    "hostile.cjs",
    "a link that leads to a server that cannot be trusted: a design with code in it is refused in words and nothing of it is kept, an honest server opens the design, the same server turning hostile is left at once and the design stays as it was",
  ],
  [
    "crash.cjs",
    "when Craftly stops: the screen and when the design was saved, the problem written down, the report read, copied, downloaded and sent only on Send, a second stop that says so, going back to a version, a copy of the design as a file, errors that nothing caught, Report a problem in both menus, a part that cannot be fetched (needs VITE_CRAFTLY_REPORT_URL=/__report in a production build, see e2e/README.md)",
  ],
  [
    "comments.cjs",
    "comments: the Comment tool by palette and key M, posting, Esc and Cancel, the count, replies, edit, delete after asking, resolve and reopen, a pin that follows its shape and comes back with it after undo, kept out of undo, markup shown as text, no pin in a PNG or in Present, reload",
  ],
  [
    "textshapes.cjs",
    "Convert to shapes for a text box: one path per letter where the canvas draws it (read from the pixels), undo and redo, light and heavy weights, the refusals, effects and missing letters said, line breaks, SVG download, reload",
  ],
  [
    "print.cjs",
    "a print PDF from the Download panel: bleed chosen by keyboard, crop and registration marks, CMYK, read back (boxes, the DeviceCMYK image, the marks, the text layer, the bleed filled)",
  ],
  [
    "additions.cjs",
    "what was added on 2026-11-23: Bulk create, stacked charts and axis titles, shape options, font weight, Link, a fixed shape for a crop, a frame shape, margins, spell-check, Check accessibility, the presenter's clock and pointer",
  ],
  [
    "pptx.cjs",
    "a PowerPoint file from the Download panel, without and with speaker notes, read back: the package, its XML, relationships and content types, slide size, the JPEG of each page",
  ],
  [
    "mobile.cjs",
    "a phone (375 x 812, touch) and a tablet, in English and Hindi: no sideways scroll, every tab reached by taps, top bar and toolbars fit, a text added and edited, menus and Share fit, a PNG downloaded, pages, Present",
  ],
  ["animate.cjs", "element and page animations, timing, transitions, preview, motion templates"],
  [
    "video.cjs",
    "the video element: a WebM recorded in the page uploaded, placed, its first frame drawn, Trim, Speed and Sound, Play on the page, Present and an MP4 download read back from its pixels and the pitch of its sound, a reload",
  ],
  ["present.cjs", "full-screen show: entrance animations, transitions both ways, auto-play, reduced motion"],
  ["animated-export.cjs", "animated GIF and MP4 video downloads: structure, length, loop, decoded by the browser, cancel"],
  ["a11y.cjs", "keyboard and screen reader basics: the first Tab reaches a control, the canvas is a stop, focus goes back after a dialog, headings and landmarks"],
  [
    "ml.cjs",
    "on-device photo tools without a download: consent gate, models dialog, the real ONNX runtime on WebGPU in its worker, cut-out, blurred background, colour pop and upscaler against hand-made models (the GPU steps skip without WebGPU)",
  ],
];
if (!process.env.OFFLINE) {
  // these read the app's modules and catalogs in src/, which only the dev server serves
  journeys.push([
    "accounts.cjs",
    "accounts, sync and teams against the real server with accounts on: nothing new without an account, sign up and move designs in, a second device, a conflict, a team, an invite, roles, editing live without a link, removal, signing out, the server stopped, Hindi (dev server only)",
  ]);
  journeys.push([
    "language.cjs",
    "the interface in English and Hindi: the browser's language, Language in the account menu and under File, an unsaved edit kept through the switch, no English left in the Hindi bars, the Hindi untitled name, English search on a Hindi page, hi-IN dates and numbers, labels that fit at 1280 and 375 px, back to English (dev server only)",
  ]);
}
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
