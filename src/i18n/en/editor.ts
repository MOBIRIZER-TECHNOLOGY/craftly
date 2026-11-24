/**
 * The words of the canvas and what acts on it: the editor shell, the floating and mini toolbars, the right-click menu, the
 * canvas itself, comments and working together live (src/editor/toolbar, canvas, comments, live and the files in src/editor).
 */
import { num, plural } from "../format";

export const editor = {
  /** Editor.tsx: loading the design and what is shown when it cannot be opened */
  shell: {
    opening: "Opening your design",
    newerTitle: "Update Craftly to open this design",
    newerText:
      "It was saved by a newer version of Craftly than the one running in this tab. Reload to get the newest version, then open it again. The design has not been changed.",
    failedTitle: "We couldn't bring this design up to date",
    failedText: (detail: string) => `${detail} Nothing has been changed, and your other designs are not affected.`,
    missingTitle: "We couldn't find this design",
    missingText: "It may have been deleted, or it was saved in another browser. Head home to open one of your designs or start a new one.",
    brokenTitle: "We couldn't open this design",
    brokenText: "Its file looks damaged. Go back to an earlier version below, or head home to open another design - your other designs are not affected.",
    backHome: "Back to home",
    /** the main region around the canvas */
    region: "Design",
  },

  /** a copy kept when the design could not be saved or sent (autosave.ts, live/connection.ts) */
  recovery: {
    saveFailed: "Could not save your design. Try again or download a project file to keep your edits.",
    downloadCopy: "Download copy",
    downloadFailed: "Could not download the recovery copy.",
  },

  /** missingFontNotice.ts; `fonts` are the names already in quotes */
  missingFonts: (fonts: readonly string[]) => {
    const rest = "The design is not changed. If you have the font, upload it under Brand > Your fonts.";
    if (fonts.length === 1) return `The font ${fonts[0]} is not on this device, so its text is shown in a substitute font. ${rest}`;
    const named = fonts.slice(0, 3);
    const more = fonts.length - named.length;
    const names = more > 0 ? `${named.join(", ")} and ${num(more)} more` : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
    return `The fonts ${names} are not on this device, so their text is shown in a substitute font. ${rest}`;
  },

  /** where the toolbars and the right-click menu line things up */
  align: {
    left: "Left",
    center: "Center",
    right: "Right",
    top: "Top",
    middle: "Middle",
    bottom: "Bottom",
  },

  /** actions offered both by the toolbars and by the right-click menu */
  actions: {
    copy: "Copy",
    paste: "Paste",
    duplicate: "Duplicate",
    copyStyle: "Copy style",
    pasteStyle: "Paste style",
    group: "Group",
    ungroup: "Ungroup",
    connect: "Connect",
    lock: "Lock",
    unlock: "Unlock",
  },

  /** contextMenuItems.ts: the right-click menu */
  contextMenu: {
    selectAll: "Select all",
    addPage: "Add page",
    pageBackground: "Page background",
    layer: "Layer",
    bringForward: "Bring forward",
    bringToFront: "Bring to front",
    sendBackward: "Send backward",
    sendToBack: "Send to back",
    alignToPage: "Align to page",
    combineShapes: "Combine shapes",
    /** the hint beside Connect */
    connectHint: "Arrow",
    convertToPath: "Convert to path",
    convertToShapes: "Convert to shapes",
    hide: "Hide",
    replaceImage: "Replace image",
    altText: "Alternative text",
    link: "Link",
    editLink: "Edit link",
  },

  /** the toolbars (src/editor/toolbar) */
  toolbar: {
    /** the name of the floating toolbar for what is selected */
    bars: {
      crop: "Crop controls",
      path: "Point editing controls",
      page: "Page controls",
      locked: "Locked element controls",
      selected: "Selected element common controls",
    },
    quickActions: "Selected element quick actions",
    /** the name of the number box beside a slider */
    sliderValue: (label: string) => `${label} value`,
    moreActions: "More actions",
    more: "More",
    pasteStyleTip: "Paste style onto the selection",
    transparency: "Transparency",
    transparencyTip: "Transparency and blend mode",
    blendMode: "Blend mode",
    blendNormal: "Normal",
    mixed: "Mixed",
    effects: "Effects",
    effectsTip: "Shadows, glow and other effects",
    animate: "Animate",
    animatePageTip: "Animate the page and set transitions",
    animateElementTip: "Make it enter, leave or move",
    position: "Position",
    positionTip: "Arrange, align and resize",
    flip: "Flip",
    flipHorizontal: "Flip horizontal",
    flipVertical: "Flip vertical",
    groupTip: "Group the selected elements",
    align: "Align",
    alignTip: "Align the selected elements to each other",
    distributeHorizontally: "Distribute horizontally",
    distributeVertically: "Distribute vertically",
    connectTip: "Draw an arrow from the first selected element to the second. It stays attached when they move.",
    border: "Border",
    borderTip: "Border style and weight",
    borderStyle: "Border style",
    borderWeight: "Border weight",
    borderColor: "Border color",
    color: "Color",
    noBorder: "No border",
    strokeStyles: { solid: "Solid", dashed: "Dashed", dotted: "Dotted" },
    cornerRadius: "Corner radius",
    cornerRadiusTip: "Round the corners",
    fillColor: "Fill color",
    fillColorMixed: "Fill color (mixed)",
  },

  /** TextBar.tsx */
  textBar: {
    /** `font` is null when the selection has several fonts */
    fontButton: (font: string | null) => `Toggle font selector, current font: ${font === null ? "multiple fonts" : font}`,
    multipleFonts: "Multiple fonts",
    font: "Font",
    fontSize: "Font size",
    textColor: "Text color",
    textColorMixed: "Text color (mixed)",
    bold: "Bold",
    italic: "Italic",
    underline: "Underline",
    strikethrough: "Strikethrough",
    cases: { none: "Normal case", upper: "Uppercase", lower: "Lowercase", title: "Title case" },
    caseLabel: (name: string) => `Text case: ${name}`,
    aligns: { left: "Left", center: "Center", right: "Right", justify: "Justified" },
    /** `current` is null when the paragraphs are aligned differently */
    alignLabel: (current: string | null) => `Toggle text alignment, current alignment: ${current === null ? "mixed" : current}`,
    alignTips: { left: "Align left", center: "Align center", right: "Align right", justify: "Align justified" },
    lists: { none: "No list", bullet: "Bulleted list", number: "Numbered list" },
    listLabel: (name: string) => `List: ${name}`,
    listMixed: "List (mixed)",
    advanced: "Advanced settings",
    spacing: "Spacing",
    letterSpacing: "Letter spacing",
    lineSpacing: "Line spacing",
  },

  /** ShapeBar.tsx: shapes and lines */
  shapeBar: {
    editPoints: "Edit points",
    editPointsTip: "Move, add and delete the points of this path",
    useAsFrame: "Use as picture frame",
    combine: "Combine",
    combineTip: "Join the selected shapes into one, or cut one out of another",
    shapeOptions: "Shape options",
    shapeOptionsTip: "Sides, points and other numbers of this shape",
    /** a control whose value is a percentage */
    percent: (label: string) => `${label} (%)`,
    params: { sides: "Sides", points: "Points", inner: "Inner size", lobes: "Lobes", amp: "Depth of the lobes", hole: "Size of the hole" },
    lineColor: "Line color",
    lineWeight: "Line weight",
    weight: "Weight",
    lineStyle: "Line style",
    routing: "Connector route",
    routes: { straight: "Straight", elbow: "Elbow", curved: "Curved" },
    lineLabel: "Line label",
    lineLabelTip: "Text drawn at the middle of the line",
    startArrowhead: "Start arrowhead",
    start: "Start",
    endArrowhead: "End arrowhead",
    end: "End",
    arrows: {
      none: "None",
      arrow: "Arrow",
      triangle: "Triangle",
      "open-arrow": "Open arrow",
      circle: "Circle",
      square: "Square",
      diamond: "Diamond",
      bar: "Bar",
    },
  },

  /** ImageBar.tsx: pictures, empty frames and cropping */
  imageBar: {
    editImage: "Edit image",
    editImageTip: "Filters and adjustments",
    crop: "Crop",
    replace: "Replace",
    replaceTip: "Choose another picture",
    upload: "Upload",
    uploadTip: "Upload a picture into this frame",
    zoom: "Zoom",
    cropZoom: "Crop zoom",
    straighten: "Straighten",
    resetCrop: "Reset crop",
    resetCropTip: "Restore the original crop",
    finishCropTip: "Finish cropping",
    ratio: "Shape of the crop",
    ratioTip: "Give the frame a fixed shape",
    ratioFree: "Free",
    ratioOriginal: "Original",
    frameShape: "Frame shape",
    frameShapeTip: "Cut the picture to a shape",
    frameNone: "No frame",
  },

  /** VideoBar.tsx: a clip on the page */
  videoBar: {
    play: "Play",
    playTip: "Play the clip on the page",
    stop: "Stop",
    stopTip: "Stop playing",
    trim: "Trim",
    trimTip: "Choose the part of the clip that plays",
    trimStart: "Start (seconds)",
    trimEnd: "End (seconds)",
    /** in seconds, as the two fields above it are */
    trimLength: (shown: number, whole: number) => `Plays ${num(shown, { maximumFractionDigits: 2 })} s of ${num(whole, { maximumFractionDigits: 2 })} s`,
    resetTrim: "Play the whole clip",
    speed: "Speed",
    speedTip: "How fast the clip plays",
    speedValue: (x: number) => `${num(x)}×`,
    sound: "Sound",
    soundOnTip: "The clip plays with its sound in Present. Click to mute it",
    soundOffTip: "The clip is muted. Click to play it with its sound in Present",
    frameShapeTip: "Cut the clip to a shape",
  },

  /** MiscBars.tsx: group, table and chart, locked selection, page */
  miscBars: {
    ungroupTip: "Split the group into its elements",
    editData: "Edit data",
    editChartTip: "Edit the chart's labels and numbers",
    editTableTip: "Edit the table's cells",
    unlockTip: "Allow editing again",
    background: "Background",
    backgroundColor: "Background color",
    pageBackground: "Page background",
  },

  /** PathBar.tsx: editing the points of a path */
  pathBar: {
    selectPoint: "Select a point to edit it",
    point: (n: number, total: number, kind: "corner" | "smooth") => `Point ${num(n)} of ${num(total)}, ${kind === "corner" ? "corner" : "smooth"}`,
    pointsSelected: (n: number) => plural(n, { one: `${num(n)} point selected`, other: `${num(n)} points selected` }),
    corner: "Corner",
    cornerTip: "Make the selected points corners",
    smooth: "Smooth",
    smoothTip: "Make the selected points smooth",
    deletePoint: "Delete point",
    deletePointTip: "Delete the selected points",
    closePath: "Close path",
    closePathTip: "Join the last point to the first",
    finishTip: "Finish editing points",
  },

  /** GraphicBar.tsx */
  graphicBar: {
    colorN: (n: number) => `Color ${num(n)}`,
    colorNOf: (n: number, total: number) => `Color ${num(n)} of ${num(total)}`,
    strokeWidth: "Stroke width",
  },

  /** LinkDialog.tsx */
  link: {
    title: "Link",
    hint: "A click on this element opens the address: in the presenter, in a PDF and in an SVG download.",
    address: "Address",
    placeholder: "example.com, or an address that starts with mailto: or tel:",
    invalid: "This is not an address a link can lead to. Use a web address such as example.com, or one that starts with https://, mailto: or tel:.",
    remove: "Remove link",
  },

  /** AltTextDialog.tsx */
  altText: {
    title: "Alternative text",
    hint: "Describe this element for people who use a screen reader. It is also saved in SVG downloads.",
    placeholder: "For example: a golden sunset over rolling hills",
    count: (n: number, max: number) => `${num(n)} / ${num(max)}`,
  },

  /** imageFile.ts: replacing a picture with a file */
  imageFile: {
    notPicture: "That file is not a picture. Choose a PNG, JPG, WebP, GIF or SVG file.",
    unreadable: "Could not read that picture. Try a different file.",
  },

  /** combine.ts: combining shapes and turning them into paths */
  combine: {
    ways: {
      union: { label: "Union", hint: "Join into one" },
      subtract: { label: "Subtract", hint: "Cut out the front" },
      intersect: { label: "Intersect", hint: "Keep the overlap" },
      exclude: { label: "Exclude", hint: "Remove the overlap" },
    },
    nothingLeft: {
      union: "These shapes have no outline to join.",
      subtract: "Nothing is left of the shape behind once the others are cut out of it.",
      intersect: "These shapes do not overlap, so there is nothing to keep.",
      exclude: "Nothing is left: the shapes cover exactly the same area.",
    },
    changed: "The shapes changed in the meantime, so nothing was changed.",
    failed: "The shapes could not be combined. Check your connection and try again.",
    pathFailed: "The shapes could not be converted to paths. Check your connection and try again.",
    noOutline: "These shapes have no outline to convert.",
  },

  /** svgShapes.ts: "Convert to shapes" */
  convert: {
    inGroup: "Take it out of its group first: inside a group it cannot be converted to shapes.",
    pictureUnreadable: "The picture could not be read, so nothing was changed. Try again.",
    pixels: "Only a picture that is an SVG drawing can be converted to shapes. This one is made of pixels.",
    pictureChanged: "The picture changed in the meantime, so nothing was changed.",
    nothingConverted: "Nothing in this drawing could be converted to shapes, so it stays a picture.",
    notPlain: "This drawing has parts that cannot become shapes (text, pictures or styles), so it stays as it is.",
    drawingUnreadable: "The drawing could not be read, so nothing was changed.",
    drawingTooLarge: (maxShapes: number, maxPoints: number) =>
      `This drawing is too large to convert: it has more than ${num(maxShapes)} shapes or ${num(maxPoints)} points. Nothing was changed.`,
    /** after a drawing was converted: how many shapes it made, and how many parts were left out or made simpler */
    drawingDone: (shapes: number, skipped: number, simplified: number) => {
      const parts = [`Converted to ${plural(shapes, { one: `${num(shapes)} shape`, other: `${num(shapes)} shapes` })}.`];
      if (skipped)
        parts.push(
          plural(skipped, { one: `${num(skipped)} part could not be converted and was left out.`, other: `${num(skipped)} parts could not be converted and were left out.` }),
        );
      if (simplified)
        parts.push(
          plural(simplified, {
            one: `${num(simplified)} part was made simpler: clipping, masks, effects and patterns are not kept.`,
            other: `${num(simplified)} parts were made simpler: clipping, masks, effects and patterns are not kept.`,
          }),
        );
      return parts.join(" ");
    },
    curved: "Curved text cannot be converted to shapes yet. Set Curve to 0 first, then convert.",
    noFont: (fonts: readonly string[]) =>
      `Craftly does not have the font file of ${fonts.map((font) => `"${font}"`).join(", ")}, so the letters cannot be converted. Choose a font from the list, or upload this one under Brand kit > Your fonts.`,
    textTooLarge: (maxLetters: number, maxPoints: number) =>
      `This text is too long to convert: it has more than ${num(maxLetters)} letters or ${num(maxPoints)} points. Nothing was changed.`,
    noLetters: "This text has no letters to convert, so it stays as it is.",
    fontUnreadable: "The font could not be read, so nothing was changed. Try again.",
    textChanged: "The text changed in the meantime, so nothing was changed.",
    /** after a text was converted: how many shapes it made, how many letters the font lacked, whether its effect was dropped */
    textDone: (shapes: number, missing: number, effectDropped: boolean) => {
      const parts = [
        `Converted to ${plural(shapes, { one: `${num(shapes)} shape`, other: `${num(shapes)} shapes` })}. The text can no longer be edited as text; Undo brings it back.`,
      ];
      if (missing)
        parts.push(
          plural(missing, { one: `${num(missing)} letter is not in the font and was left out.`, other: `${num(missing)} letters are not in the font and were left out.` }),
        );
      if (effectDropped) parts.push("The text effect is not kept.");
      return parts.join(" ");
    },
  },

  /** the canvas (src/editor/canvas) */
  canvas: {
    label: "Design canvas",
    hint: "Tab moves between the elements of the page and then on to the next control. The arrow keys move the selected element. With the Pen, the arrow keys move its point and Enter places a point there.",
    rotate: "Rotate",
    move: "Move",
    addGuideDown: "Drag down to add a guide",
    addGuideRight: "Drag right to add a guide",
    moveGuide: "Drag to move; drag onto the ruler to remove",
  },

  /** EmptyCanvasHint.tsx: shown once, on the first empty page, until something is added */
  emptyHint: {
    label: "Getting started",
    title: "Your page is empty",
    text: "Add text, shapes and photos from the Text, Elements and Uploads tabs, or drop a picture onto the page.",
    keys: "Keys:",
    textBox: "text",
    rectangle: "rectangle",
    circle: "circle",
    allShortcuts: "every shortcut",
    dismiss: "Dismiss this hint",
  },

  /** penTool.ts: what a screen reader is told while the Pen is used from the keyboard */
  pen: {
    /** a place on the page in whole pixels */
    place: (x: number, y: number) => `${num(x, { useGrouping: false })}, ${num(y, { useGrouping: false })}`,
    /** where the keyboard point is, and what Enter would do there */
    at: (place: string, next: "close" | "end" | "place") => `Pen at ${place}${next === "close" ? ". Enter closes the path." : next === "end" ? ". Enter ends the path." : ""}`,
    curveHandle: (place: string) => `Curve handle ${place}`,
    noCurveHandle: "No curve handle",
    placed: (smooth: boolean, n: number, place: string) => `${smooth ? "Smooth point" : "Point"} ${num(n)} placed at ${place}`,
    singlePoint: "A single point makes no path.",
  },

  /** src/editor/comments */
  comments: {
    title: "Comments",
    buttonOpen: (n: number) => `Comments, ${num(n)} open`,
    close: "Close comments",
    filters: { open: "Open", resolved: "Resolved", all: "All" },
    filterLegend: "Show",
    empty: { open: "No open comments.", resolved: "No resolved comments.", all: "No comments yet." },
    notShared: "This server does not share comments. The comments you add stay in your copy of the design; the others do not see them.",
    viewOnlyLink: "This link only lets you look: you can read the comments, but not add or answer them.",
    viewing: "You are viewing this design. Switch to Editing to add or answer comments.",
    hint: "Choose Comment in Tools (or press M), then click the page where the comment belongs.",
    showResolved: "Show resolved pins on the page",
    onThisPage: "On this page",
    onOtherPages: "On other pages",
    pageNumber: (n: number) => `Page ${num(n)}`,
    pageNamed: (n: number, name: string) => `Page ${num(n)}: ${name}`,
    edited: "(edited)",
    /** the heading of a thread; `page` is said for a thread of another page */
    thread: (n: number, page: string | null) => `Comment ${num(n)}${page ? `, ${page}` : ""}`,
    /** after the heading of a resolved thread */
    resolvedMark: " (resolved)",
    replies: (n: number) => `Replies to comment ${num(n)}`,
    showOnPage: "Show on page",
    resolve: "Resolve",
    reopen: "Reopen",
    editYour: { comment: "Edit your comment", reply: "Edit your reply" },
    editLabel: { comment: "Edit comment", reply: "Edit reply" },
    edit: "Edit",
    deleteLabel: { comment: "Delete comment", reply: "Delete reply" },
    deleteThis: { comment: "Delete this comment", reply: "Delete this reply" },
    deleteQuestion: { comment: "Delete this comment and its replies? This cannot be undone.", reply: "Delete this reply? This cannot be undone." },
    keep: "Keep",
    replyTo: (n: number, author: string) => `Reply to comment ${num(n)} by ${author}`,
    reply: "Reply",
    /** a pin on the page, for a screen reader and its tooltip */
    pin: (n: number, author: string, words: string, resolved: boolean) => `Comment ${num(n)} by ${author}: ${words}${resolved ? " (resolved)" : ""}`,
    newComment: "New comment",
    comment: "Comment",
    placeholder: "Add a comment",
    draftHint: "Enter posts the comment, Shift and Enter starts a new line, Escape cancels.",
    post: "Post",
    /** the author name of somebody who gave none, outside a shared design */
    you: "You",
    newFrom: (author: string, words: string) => `New comment from ${author}: ${words}`,
    newReplyFrom: (author: string, words: string) => `New reply from ${author}: ${words}`,
    manyNew: (n: number) => `${num(n)} new comments and replies.`,
  },

  /** src/editor/live: working together on a shared design */
  live: {
    /** why the server did not let this link in */
    denied: {
      "no-access": "This link is not allowed in: its key is wrong or has been withdrawn.",
      "not-found": "This shared design is no longer there.",
      "bad-request": "The server did not understand this link.",
      "server-full": "The server is full. Try again in a moment.",
      "too-large": "This design is too big for the server.",
      "server-error": "The server has a problem and could not open this shared design. The design may still be there: try again later.",
      invalid: "The server sent something that Craftly does not accept, so the connection was closed. Only join designs from a server you trust.",
    },
    /** the name of the recovery copy of a design */
    unsentTitle: (title: string) => `${title} (unsent changes)`,
    recoveryInProjects: (what: string) => `${what} A recovery copy is in Projects.`,
    recoveryDownload: (what: string) => `${what} Download a recovery copy.`,
    earlierVisit: "This design has changes from an earlier visit that never reached the server. The shared version is shown now.",
    cannotKeepUnsent: "Craftly could not keep unsent changes for a reload. Keep this tab open or download a project file.",
    /** `reason` is what the server said */
    refused: (reason: string) => `The server refused an edit: ${reason}`,
    textDeleted: "Someone else deleted the text you were editing.",
    imagesFailed: "Could not load shared images.",
    typedFirst: (name: string) => `${name} started typing in this text a moment before you, so it was closed here. One person at a time types in a text box.`,
    textTaken: (name: string) => `${name} is typing in this text. You can type in it when they are done.`,
    keyNeeded: "This server asks for a key to start sharing. Whoever runs it can give it to you.",
    keyWrong: "That key is not right. Check it with whoever runs the server.",
    serverAnswered: (status: number) => `The server answered ${status}.`,
    notAServer: "That is not the address of a server. It looks like https://live.example.com or http://localhost:8787.",
    noDesign: "There is no design open.",
    unreachable: "Couldn't reach the server. Check the address and that the server is running.",
    unreachableStop: "Couldn't reach the server, so sharing could not be stopped. The link is still on this design.",
    unreachableLink: "Couldn't reach the server. Check the link and that the server is running.",
    /** media.ts: the pictures of a shared design */
    media: {
      missing: "An uploaded image is missing. Replace it to sync this design.",
      checkFailed: (status: number) => `Could not check a shared image (server response ${status}).`,
      cannotShare: (status: number) =>
        `An uploaded image cannot be shared (server response ${status}). It may be too big for the server, or the shared design may hold as many images as it may.`,
      shareFailed: (status: number) => `Could not share an uploaded image (server response ${status}). Check the image size and try again.`,
      loadFailed: "A shared image could not be loaded.",
      unsupported: "The server returned an unsupported image.",
      damaged: "The shared image is damaged.",
      /** the file name of a picture that came from the server, before its extension */
      fileName: "Shared image",
    },
    /** JoinPage.tsx */
    join: {
      notCraftly: "This is not a link that Craftly made. Ask the person who shared the design for a new one.",
      openFailed: "The shared design could not be opened.",
      problemTitle: "This shared design could not be opened",
      askTitle: "Join this shared design?",
      askText: (server: string) =>
        `This link connects to ${server}, a server this device has not used before. That server will see your network address, and the design it sends is saved in your library. Join only if you trust whoever gave you the link.`,
      join: "Join",
      joining: "Joining the shared design",
    },
    /** LivePeople.tsx and presence.ts */
    people: (n: number) => plural(n, { one: `${num(n)} person here`, other: `${num(n)} people here` }),
    me: (name: string) => `${name} (you)`,
    andRest: (names: string) => `and ${names}`,
    /** the name of somebody who gave none: a word and the number of their connection */
    guest: (peer: number) => `Guest ${peer}`,
    guestPlaceholder: "Guest",
    typing: (name: string) => `${name} is typing…`,
    nameLabel: "Your name",
    nameHint: "The others see this name beside your pointer. It is kept on this device.",
    /** LiveSection.tsx: the connection in words */
    status: {
      live: "Live",
      liveView: "Live, view only",
      connecting: "Connecting...",
      reconnecting: "Reconnecting...",
      denied: "Not allowed in",
      /** a person who joined by a link, after its owner pressed Stop sharing */
      stopped: "Sharing stopped",
      off: "Not connected",
    },
    /** said to a person who joined by a link when its owner stops sharing: in a message, in the Share panel and on the top bar mark */
    ownerStopped: "The owner stopped sharing this design. You can go on with your own copy on this device.",
    copyFailed: "The link could not be copied. Select it and copy it by hand.",
    copy: "Copy",
    copied: "Copied",
    startFailed: "Sharing could not be started.",
    stopFailed: "Sharing could not be stopped.",
    title: "Work together",
    intro: "Edit this design at the same time as other people, and see each other's changes as they happen. It needs a Craftly live server.",
    serverAddress: "Server address",
    keyLabel: "Key to start sharing",
    start: "Start live session",
    editLink: "Edit link",
    copyEditLink: "Copy the edit link",
    editLinkHint: "Anyone with this link can change the design.",
    viewLink: "View link",
    copyViewLink: "Copy the view link",
    viewLinkHint: "Anyone with this link can look, not change.",
    youView: "You can look at this design, not change it.",
    youEdit: "You are editing this design together with the person who shared it.",
    stopSharing: "Stop sharing",
    leave: "Leave",
    keepSharing: "Keep sharing",
    stopOwner: "Everybody is sent away and the links stop working. The design stays on this device.",
    stopGuest: "This design stays on this device as your own copy.",
    badgeView: "Shared with you to look at",
    badgeEdit: "Shared: changes are sent to everybody",
  },
};
