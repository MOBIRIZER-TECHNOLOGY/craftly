/**
 * The words of downloads and files (src/export): the Download panel, the messages of a download, a print, a project file,
 * a backup and an archive that could not be read. The words a download writes INTO its file (the web page's buttons, a
 * PDF's or SVG's metadata, the print sheet's alt text) are part of the file and stay as they are.
 */
import { num, plural } from "../format";

/** A number as these words have always written it: without a thousands separator ("8192 px", "1000 KB"). */
const plain = (n: number) => num(n, { useGrouping: false });

export const exporting = {
  /** the Download panel (DownloadPanel.tsx) */
  panel: {
    empty: "Open a design to download it.",
    /** the panel's name, and its button */
    download: "Download",
    fileType: "File type",
    suggested: "Suggested",
    /** the kinds of file in the File type list: a name and a hint each (PNG, JPG and SVG are names of formats) */
    types: {
      pngHint: "Sharp images",
      jpgHint: "Small photos",
      pdfStandard: "PDF Standard",
      pdfStandardHint: "Screens and sharing",
      pdfPrint: "PDF Print",
      pdfPrintHint: "300 dpi",
      svgHint: "Editable vector",
      gif: "Animated GIF",
      gifHint: "Plays on any device",
      video: "Video (WebM)",
      videoHint: "Smooth, small files",
      videoUnsupported: "Not supported in this browser",
      sizes: "Several sizes",
      sizesHint: "One ZIP, a file per size",
      html: "Web page (HTML)",
      htmlHint: "A slideshow in any browser",
    },
    pagesToDownload: "Pages to download",
    page: (n: number) => `Page ${plain(n)}`,
    /** the pixel size of the download: "1,080 × 1,920 px" */
    pixels: (width: number, height: number) => `${num(width)} × ${num(height)} px`,
    downloaded: (fileName: string) => `Downloaded ${fileName}`,
    cancelled: "Download cancelled",
    status: {
      finishing: "Finishing up…",
      picture: (n: number, total: number) => `Rendering picture ${plain(n)} of ${plain(total)}…`,
      recordingHidden: "Recording pauses while this tab is in the background. Switch back to keep going.",
      recording: (seconds: number, total: number) => `Recording ${plain(seconds)} s of ${plain(total)} s…`,
      preparing: "Preparing your download…",
      frame: (n: number, total: number) => `Rendering frame ${plain(n)} of ${plain(total)}…`,
      page: (n: number, total: number) => `Preparing page ${plain(n)} of ${plain(total)}…`,
    },
    size: "Size",
    /** the Size slider's value: "×2 · 3,840 × 2,160 px" */
    sizeValue: (scale: number, pixels: string) => `×${plain(scale)} · ${pixels}`,
    reduced: (longest: number) => `Reduced to fit ${num(longest)} px on the longest side.`,
    transparent: "Transparent background",
    quality: "Quality",
    percent: (value: number) => `${plain(value)}%`,
    presets: "Presets",
    pdfPreset: "PDF preset",
    digital: "Digital",
    print: "Print",
    printHint: "300 dpi pages, sharp when printed.",
    digitalHint: "Light pages for screens, email and sharing.",
    compress: "Compress PDF",
    compressHint: "Makes the file smaller with slightly lower image quality.",
    bleed: "Bleed",
    bleedSize: "Bleed size",
    bleedHint: (mm: number) =>
      `The page background is extended ${plain(mm)} mm beyond every edge, so nothing white shows when the sheet is cut. Keep what matters away from the edges.`,
    cropMarks: "Crop marks",
    cropMarksHint: "Thin lines outside the page that show the printer where to cut. The PDF page becomes larger to hold them.",
    embedFonts: "Embed fonts",
    embedFontsHint: "Text looks the same everywhere. Turn off for a smaller file; the SVG then relies on fonts installed on the viewing device.",
    resolution: "Resolution",
    frameRate: "Frame rate",
    fps: (fps: number) => `${plain(fps)} fps`,
    videoHint: "Recorded as it plays, so it takes as long as the animation. Keep this tab open and in front while it records.",
    notAnimated: "Nothing is animated yet - use Animate on the toolbar",
    bigGif: "Many sites accept GIFs of about 15 MB at most. A lower resolution or frame rate makes this one smaller.",
    sizes: "Sizes",
    sizesCount: (ticked: number, max: number) => `${plain(ticked)} of ${plain(max)}`,
    sizesToDownload: "Sizes to download",
    /** the size the design has now, when it is no format of its own */
    originalSize: "Original size",
    thisDesign: (name: string) => `${name} (this design)`,
    format: "Format",
    formatOfEachSize: "Format of each size",
    sizesHintPdf:
      "Every size is made from a copy that is scaled to fit and centred, as Resize does it. This design is not changed. The files come together in one .zip, one PDF for each size.",
    sizesHintPictures:
      "Every size is made from a copy that is scaled to fit and centred, as Resize does it. This design is not changed. The files come together in one .zip, each exactly as many pixels as its size.",
    htmlHint:
      "One .html file that shows the pages as a slideshow in any browser, for people who do not have Craftly: next and back with the buttons, the arrow keys, a click or a swipe, and a full screen button. Nothing is loaded from the internet.",
    htmlPictures: "Every page is a picture. Animations, transitions and links are not carried over; pages change with a short fade.",
    includeNotes: "Include speaker notes",
    notesShown: "The notes are shown under each page. Everyone who gets the file can read them.",
    notesPrivate: "Notes are private and stay out of the file.",
    selectPages: "Select pages",
    allPages: "All pages",
    currentPage: "Current page",
    custom: "Custom",
    selectAll: "Select all",
    selectNone: "Select none",
    pageOf: (n: number, count: number) => `Page ${plain(n)} of ${plain(count)}`,
    everyPage: "Every page in this design",
    everyPagePlayed: "Every page in this design - played one after another",
    everyPageZip: "Every page in this design - saved together as a .zip",
    estimated: "Estimated size",
    files: (n: number) => plural(n, { one: "1 file", other: `${plain(n)} files` }),
    progress: "Download progress",
  },

  /** sizes, lengths and counts (options.ts, animated/frames.ts) */
  amounts: {
    pages: (n: number) => plural(n, { one: "1 page", other: `${plain(n)} pages` }),
    kb: (n: number) => `${plain(n)} KB`,
    /** megabytes, with one decimal (`tenths`) or none */
    mb: (n: number, tenths: boolean) => `${num(n, { useGrouping: false, minimumFractionDigits: tenths ? 1 : 0, maximumFractionDigits: tenths ? 1 : 0 })} MB`,
    seconds: (s: number) => `${plain(s)} s`,
    minutes: (min: number) => `${plain(min)} min`,
    minutesSeconds: (min: number, s: number) => `${plain(min)} min ${plain(s)} s`,
  },

  /** the messages of a download that failed or came out other than asked (errors.ts and the exporters) */
  errors: {
    cancelled: "The download was cancelled.",
    tooLargeAt: (scale: number) => `This design is too large to export at ${plain(scale)}x - try a smaller size.`,
    noMemory: "There is not enough free memory to export this design. Close other tabs or try a smaller size.",
    tooLarge: "This design is too large to export. Try fewer pages or a smaller size.",
    tooLargeAtThisSize: "This design is too large to export at this size - try a smaller size.",
    generic: "Something went wrong while preparing the download. Please try again.",
    noPages: "Select at least one page to download.",
    noSuchPage: "That page does not exist.",
    cannotCopy: "Your browser cannot copy images. Download the page instead.",
    copyFailed: "Could not copy the page. Allow clipboard access for this site, or download it instead.",
    /** `scale` and `requested` are multipliers ("x2"), the sizes pixels */
    scaledDown: (scale: number, width: number, height: number, requested: number, longest: number) =>
      `Scaled down to x${plain(scale)} (${plain(width)} x ${plain(height)} px) instead of x${plain(requested)} because exports are limited to ${plain(longest)} px on the longest side.`,
    imagesMissing: (pages: readonly number[]) => `Some images could not be loaded on page(s) ${pages.join(", ")}. Replace or remove them and try again.`,
    svgImages: "Some images could not be embedded, so they are shown as grey boxes.",
    svgFonts: "Some fonts could not be embedded; other programs may substitute them.",
    svgFilteredImages: "Some filtered images could not be embedded.",
    svgGraphic: "A graphic could not be read and was left out.",
    webPageTooLarge: (mb: number) => `These pages make a web page of more than ${plain(mb)} MB. Choose fewer pages.`,
  },

  /** printing (print.ts) */
  print: {
    unavailable: "Printing is not available here.",
    nothing: "There is nothing to print.",
    prepareFailed: "Could not prepare the pages for printing.",
    dialogFailed: "Could not open the print dialog. Allow pop-ups for this site or download the PDF instead.",
  },

  /** GIFs and videos (animated/) */
  animation: {
    gifTooLong: "This animation is too long to save as a GIF. Choose fewer pages or a lower frame rate.",
    gifTooLarge: "This animation is too large to save as a GIF at this size. Try a lower resolution or frame rate, or fewer pages.",
    videoTooLong: (minutes: number) => `A video can be at most ${plain(minutes)} minutes long because it is recorded in real time. Choose fewer pages.`,
    tooBigToDraw: "This animation is too large for your browser to draw. Try a lower resolution.",
    stalled: "The tab was in the background while the video recorded, so part of it may stand still. Keep the tab visible while a video records.",
    gifTooBig: (mb: number) => `This GIF is getting too big (over ${plain(mb)} MB). Try a lower resolution or frame rate, or fewer pages.`,
    cannotRecord: "Your browser cannot record video.",
    noRecorder: "Your browser cannot record video. Try Chrome, Edge or Firefox, or download an animated GIF instead.",
    noWebm: "This browser cannot record WebM video. Try Chrome, Edge or Firefox, or download an animated GIF instead.",
    recordFailed: "The video could not be recorded. Please try again.",
    cannotStart: "Your browser could not start recording video. Download an animated GIF instead.",
  },

  /** several sizes in one download (multiSizePlan.ts) */
  sizes: {
    tickOne: "Tick at least one size.",
    tooMany: (ticked: number, max: number) => `${plain(ticked)} sizes are ticked; one download holds ${plain(max)} at most.`,
    tooManyPixels: (millions: number, maxMillions: number) =>
      `That is ${plain(millions)} million pixels in all; one download holds ${plain(maxMillions)} million. Choose fewer sizes or fewer pages.`,
  },

  /** .craftly project files (projectFile.ts, projectFormat.ts) */
  project: {
    notAProject: "That does not look like a Craftly project file",
    newer: "This project was saved by a newer version of Craftly. Update the app, then try again.",
    cannotUpdate: "This project could not be brought up to date for this version of Craftly.",
    imageMissing: "An uploaded image is missing. Replace the missing image before saving a project file.",
    /** said in place of the name of an image the file does not hold */
    unnamedImage: "an image missing from the file",
    unreadImages: (count: number, names: readonly string[]) =>
      `Could not read ${plain(count)} embedded image(s): ${names.map((name) => `“${name}”`).join(", ")}. Export a complete project file from the source design and try again.`,
  },

  /** library backups (backupFormat.ts) */
  backup: {
    notABackup: "That file is not a Craftly backup.",
    newer: "This backup was made by a newer version of Craftly. Update the app, then try again.",
    damaged: "This backup is damaged.",
    tooLarge:
      "Your library is larger than one backup file can hold (4 GB). Delete uploads you no longer need, or save the biggest designs one by one with Share > Save project file.",
    cancelled: "Cancelled.",
    storage: "Your browser has no room left for this. Free some space and try again.",
    unsupported: "This backup cannot be opened here.",
  },

  /** archives that cannot be read (zipRead.ts); the backup dialog shows these */
  zip: {
    notAZip: "That file is not a ZIP archive.",
    split: "Archives split over several files are not supported.",
    zip64: "ZIP64 archives (over 4 GB) are not supported.",
    listOutOfPlace: "This archive is damaged: its file list is out of place.",
    listUnreadable: "This archive is damaged: its file list is unreadable.",
    fileDamaged: (name: string) => `The file "${name}" in this archive is damaged.`,
    encrypted: (name: string) => `The file "${name}" is encrypted, which is not supported.`,
    compression: (name: string) => `The file "${name}" uses a compression method that is not supported.`,
    tooLarge: (name: string) => `The file "${name}" is too large to open.`,
    noDecompression: "This browser cannot open compressed archives.",
  },
};
