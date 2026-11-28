import { num } from "../format";

/**
 * The words of documents and what draws and shares them (src/core, src/render, src/collab): default names, the names of blend
 * modes, animations, transitions and shapes, and the errors a person is shown about storage, files and fonts. What the live
 * server says, and what is stored as a key (the labels of versions), stays English in the code.
 */
export const core = {
  /** the title of a new design, and of one whose name was cleared; stored in the design */
  untitledDesign: "Untitled design",
  /** the name of a new folder that was given none; stored */
  untitledFolder: "Untitled folder",
  /** the title of a duplicated design */
  copyOf: (title: string) => `${title} (copy)`,
  /** the name of a picture pasted without a file name; stored with the upload */
  pastedImage: "Pasted image",
  /** where an earlier version of a design came from (the list after a crash) */
  versions: {
    beforeProblem: "Before the problem",
    beforeGoingBack: "Before going back",
    beforeRestoring: "Before restoring",
    beforeUpdate: "Before the update",
    /** this device's edit of a design that was also changed on another device (src/cloud/sync.ts) */
    beforeSync: "Before sync",
    savedByYou: "Saved by you",
    savedAutomatically: "Saved automatically",
  },
  /** autosave found the stored design changed by another tab */
  saveConflict: {
    deleted: "This design was deleted in another tab. Download a project file to keep your edits.",
    changed: "This design changed in another tab. Download a project file to keep your edits.",
  },
  /** the browser's database of designs */
  storage: {
    newer: "Your designs were saved by a newer version of Craftly than this one. Reload the page to get the newest version.",
    upgradeFailed: "Craftly could not bring your saved designs up to date. They have not been changed.",
    unavailable: "IndexedDB is not available in this browser.",
    cannotOpen: "Could not open the local database.",
  },
  /** a stored or opened document of another version; `kind` is "design", "project", "backup" ... */
  migration: {
    newer: (kind: string) => `This ${kind} was saved by a newer version of Craftly. Reload the page to get the newest version, then try again.`,
    unreadable: (kind: string) => `This ${kind} is not in a format Craftly can read.`,
    failed: (kind: string, from: number, to: number) => `Craftly could not bring this ${kind} up to date (format ${num(from)} to ${num(to)}).`,
  },
  /** why an uploaded font file was not taken */
  fontFile: {
    empty: "This file is empty.",
    tooLarge: "This font file is larger than 10 MB.",
    collection: "This file holds several fonts in one (a font collection). Upload each font as its own .ttf or .otf file.",
    notAFont: "This is not a font file. Craftly takes .ttf, .otf, .woff and .woff2 files.",
    cannotCheck: "This browser cannot check font files, so the font was not added.",
    damaged: "This file could not be read as a font. It may be damaged.",
  },
  unplayableVideo: "This browser cannot play this video. Try an MP4 (H.264) or WebM file.",
  videoTooBig: (mb: number) => `This video is larger than ${mb} MB, the most Craftly keeps. Try a shorter or smaller file.`,
  unplayableAudio: "This browser cannot play this sound. Try an MP3, M4A (AAC), WAV or Ogg file.",
  audioTooBig: (mb: number) => `This sound is larger than ${mb} MB, the most Craftly keeps. Try a shorter or smaller file.`,
  undrawableSvg: "This SVG has parts Craftly does not keep, and it could not be drawn as a picture. Try a different file.",
  /** an edit of a shared design that could not be sent, when the reason has no words of its own */
  sharedImageNotSent: "Could not send a shared image.",
  /** the titles of the problems kept on this device (Report a problem) */
  problems: {
    screen: "The screen stopped",
    panel: "A panel stopped",
    script: "Something failed",
    promise: "Something failed in the background",
    save: "Saving failed",
    load: "A part of Craftly could not load",
  },
  /** blend modes; no mode is Normal */
  blend: {
    normal: "Normal",
    darken: "Darken",
    multiply: "Multiply",
    "color-burn": "Color burn",
    lighten: "Lighten",
    screen: "Screen",
    "color-dodge": "Color dodge",
    overlay: "Overlay",
    "soft-light": "Soft light",
    "hard-light": "Hard light",
    difference: "Difference",
    exclusion: "Exclusion",
    hue: "Hue",
    saturation: "Saturation",
    color: "Color",
    luminosity: "Luminosity",
  },
  /** the animations of elements and pages, by id */
  animations: {
    fade: "Fade",
    rise: "Rise",
    pan: "Pan",
    pop: "Pop",
    zoom: "Zoom",
    wipe: "Wipe",
    slide: "Slide",
    drop: "Drop",
    tumble: "Tumble",
    typewriter: "Typewriter",
    flicker: "Flicker",
    breathe: "Breathe",
    pulse: "Pulse",
    float: "Float",
    wiggle: "Wiggle",
    spin: "Spin",
    flash: "Flash",
    cascade: "Cascade",
  },
  /** the transitions between pages, by id */
  transitions: {
    dissolve: "Dissolve",
    slide: "Slide",
    push: "Push",
    wipe: "Wipe",
    zoom: "Zoom",
    "fade-black": "Dip to black",
  },
  /** the catalogue of shapes (src/render/shapePaths.ts), by id */
  shapes: {
    rect: "Square",
    ellipse: "Circle",
    triangle: "Triangle",
    "right-triangle": "Right triangle",
    diamond: "Diamond",
    trapezoid: "Trapezoid",
    parallelogram: "Parallelogram",
    "half-circle": "Half circle",
    "quarter-circle": "Quarter circle",
    arch: "Arch",
    ring: "Ring",
    pentagon: "Pentagon",
    hexagon: "Hexagon",
    octagon: "Octagon",
    polygon: "Polygon",
    star: "Star",
    "star-4": "Sparkle",
    "star-6": "Hexagram",
    burst: "Starburst",
    scallop: "Scallop badge",
    flower: "Flower",
    "arrow-right": "Arrow",
    "arrow-left": "Arrow left",
    "arrow-up": "Arrow up",
    "arrow-down": "Arrow down",
    chevron: "Chevron",
    "double-arrow": "Double arrow",
    heart: "Heart",
    plus: "Plus",
    cross: "Cross",
    lightning: "Lightning",
    moon: "Crescent",
    drop: "Teardrop",
    cloud: "Cloud",
    tag: "Tag",
    ribbon: "Ribbon",
    "cut-corner": "Cut corner",
    speech: "Speech bubble",
    "speech-round": "Round bubble",
    "blob-1": "Blob 1",
    "blob-2": "Blob 2",
    "blob-3": "Blob 3",
    "blob-4": "Blob 4",
    "blob-5": "Blob 5",
    "blob-6": "Blob 6",
  },
};
