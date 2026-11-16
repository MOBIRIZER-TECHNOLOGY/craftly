/** The words of the app around the screens: the crash screen, problem reports, uploaded fonts and the notices (src/components, src/*.ts). */
import { num, plural } from "../format";

export const app = {
  crash: {
    titleLoad: "A part of Craftly could not load",
    title: "Something went wrong",
    unexpected: "Craftly hit an unexpected problem. Your designs are saved on this device, so nothing you finished is lost.",
    loadFailure: "Check your connection, then reload. Your designs are saved on this device.",
    stoppedAgain: "Craftly stopped again when this design was opened. Go back to an earlier version below, or save a copy of the design to a file before you try anything else.",
    /** `savedAt` is the time of day the design was last saved, when it is known */
    designStopped: (savedAt: string | null) =>
      `Craftly stopped unexpectedly. Your design is saved on this device${savedAt ? ` (last saved at ${savedAt})` : ""}, so reloading should bring you back to where you were.`,
    reload: "Reload Craftly",
    goToProjects: "Go to your projects",
    report: "Report this problem",
  },
  recovery: {
    title: "Go back to an earlier version",
    looking: "Looking for earlier versions…",
    none: "There are no earlier versions of this design yet.",
    useVersion: "Use this version",
    saveCopy: "Save a copy of the design to a file",
    restoreFailed: "That version could not be restored. Try another one.",
    copySaved: "Saved a copy of the design",
    copyFailed: "The copy could not be saved.",
  },
  problems: {
    title: "Report a problem",
    clear: "Clear the list",
    listLabel: "Problems on this device",
    /** how many times the same problem happened, after its title */
    count: (n: number) => `×${num(n)}`,
    sent: "Sent",
    empty: "No problems have been recorded on this device.",
    emptyHint: "If something does not work, reload the page and try again. When Craftly notices a problem it writes it down here, on this device only.",
  },
  report: {
    holds:
      "This is everything a report holds: the error, the screen it happened on, the version of Craftly, your browser and the size of its window. It never holds your designs, their text or pictures, or file names.",
    sentOnlyOnPress: "Nothing is sent unless you press Send.",
    neverSent: "Nothing is sent anywhere. Copy or download it to share it, for example in a bug report.",
    textLabel: "What a report holds",
    copy: "Copy report",
    download: "Download report",
    send: "Send report",
    sending: "Sending…",
    sent: "Sent",
    copied: "Report copied",
    copyFailed: "Copying did not work. Select the text and copy it yourself.",
    sentToast: "Report sent. Thank you.",
    sendFailed: "The report could not be sent. You can copy it instead.",
  },
  customFonts: {
    /** the names of font weights, by their number */
    weights: {
      100: "Thin",
      200: "Extra light",
      300: "Light",
      400: "Regular",
      500: "Medium",
      600: "Semibold",
      700: "Bold",
      800: "Extra bold",
      900: "Black",
    } as Record<number, string>,
    /** a variable font file */
    everyWeight: (from: number, to: number) => `Every weight from ${num(from)} to ${num(to)}`,
    italic: (weight: string) => `${weight} italic`,
    /** "Regular, Bold, Regular italic · 3 files" */
    styles: (names: string, files: number) => `${names} · ${plural(files, { one: `${num(files)} file`, other: `${num(files)} files` })}`,
    uploadRefused: (file: string, reason: string) => `${file}: ${reason}`,
    notStored: (file: string) => `${file} could not be saved on this device.`,
    added: (family: string) => `${family} was added to your fonts.`,
    addedCompressed: (family: string) => `${family} was added to your fonts. The name comes from the file name; rename it if it is not the font's name.`,
    addedMany: (n: number) => `${num(n)} font files were added to your fonts.`,
    deleteTitle: (family: string) => `Delete ${family}?`,
    deleteMessage:
      "The font is removed from this device. Text that uses it, in any design, is then shown in a substitute font. The designs themselves are not changed: upload the font again under the same name and they look as before.",
    deleteConfirm: "Delete font",
    deleted: (family: string) => `${family} was deleted.`,
    deleteFailed: (family: string) => `${family} could not be deleted.`,
    renamedOther: (asked: string, got: string) => `Craftly already has a font called ${asked}, so yours is called ${got}.`,
    renameFailed: (family: string) => `${family} could not be renamed.`,
    empty: "No uploaded fonts yet.",
    rename: "Rename",
    renameLabel: (family: string) => `Rename ${family}`,
    deleteLabel: (family: string) => `Delete ${family}`,
    use: (family: string) => `Use ${family}`,
    upload: "Upload a font",
    uploadInput: "Font files to upload",
    licence: "Upload only fonts you have the right to use. TTF, OTF, WOFF or WOFF2 files, up to 10 MB each. They stay on this device.",
    familyName: "Family name",
    renameHint: (family: string) => `Designs that already use ${family} keep that name and show a substitute font until you choose the font again.`,
  },
  leaveEditor: {
    title: "Leave with unsaved changes?",
    message: "Stay to retry saving or download a project file. Leaving will discard the unsaved changes in this tab.",
    leave: "Leave editor",
    stay: "Stay in editor",
  },
  databaseNotices: {
    blocked: "Your designs are waiting for another Craftly tab that is still on an older version. Close or reload that tab.",
    replaced: "Craftly was updated in another tab. Reload this tab to keep working.",
    replacedUnsaved: "Craftly updated in another tab. Download your unsaved changes as a project file before reloading.",
  },
  update: {
    ready: "A new version of Craftly is ready. Reload to use it.",
    notSaved: "Craftly could not save your changes. Save or download a project file before updating.",
    retry: "Retry update",
  },
  uploadNotices: {
    flattenedSvg: "This SVG had parts Craftly does not keep, so it was added as a picture.",
  },
  problemCatcher: {
    notice: "Something unexpected went wrong. If something does not work, reload the page.",
    details: "Details",
  },
};
