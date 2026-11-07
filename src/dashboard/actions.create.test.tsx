import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as assets from "@/core/assets";
import { addAssetFromFile, listAssets } from "@/core/assets";
import * as library from "@/core/library";
import { getDesign, listDesigns } from "@/core/library";
import type { ImageElement, Template } from "@/core/types";
import { DESIGN_TYPES, getDesignType } from "@/data/designTypes";
import { TEMPLATES } from "@/data/templates";
import * as renderPage from "@/render/renderPage";
import { Hosts, emptyLibrary, imageFile, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import {
  IMAGE_ACCEPT,
  MAX_SIZE_PX,
  MIN_SIZE_PX,
  createBlankAndOpen,
  createCustomAndOpen,
  createFromAsset,
  createFromImageFile,
  createFromTemplate,
  fitToLimits,
  pickImageAndCreate,
  uploadImageFiles,
} from "./actions";
import { closeCreateDialog, openCreateDialog, useCreateDialog } from "./createDialogState";
import { closeTemplatePreview, openTemplatePreview, usePreviewTemplate } from "./templatePreview";

const type = (id: string) => getDesignType(id) as NonNullable<ReturnType<typeof getDesignType>>;

/** The one design in the library. */
async function onlyDesign() {
  const all = await listDesigns();
  expect(all).toHaveLength(1);
  return all[0];
}

beforeEach(async () => {
  await emptyLibrary();
  render(<Hosts />);
});

afterEach(async () => {
  act(() => {
    closeCreateDialog();
    closeTemplatePreview();
    toast.clear();
  });
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("fitToLimits", () => {
  it("keeps a size that is already inside the limits", () => {
    expect(fitToLimits(1000, 500)).toEqual({ width: 1000, height: 500 });
    expect(fitToLimits(MIN_SIZE_PX, MAX_SIZE_PX)).toEqual({ width: MIN_SIZE_PX, height: MAX_SIZE_PX });
  });

  it("scales a picture that is too big down, keeping its shape", () => {
    expect(fitToLimits(16000, 8000)).toEqual({ width: 8000, height: 4000 });
    expect(fitToLimits(3000, 12000)).toEqual({ width: 2000, height: 8000 });
  });

  it("scales a picture that is too small up, keeping its shape", () => {
    expect(fitToLimits(20, 100)).toEqual({ width: 40, height: 200 });
    expect(fitToLimits(10, 10)).toEqual({ width: 40, height: 40 });
  });

  it("gives up on the shape when it cannot satisfy both limits", () => {
    expect(fitToLimits(100000, 10)).toEqual({ width: MAX_SIZE_PX, height: MIN_SIZE_PX });
  });

  it("counts a side that is not positive as one pixel, which then scales up to the minimum", () => {
    expect(fitToLimits(0, 0)).toEqual({ width: MIN_SIZE_PX, height: MIN_SIZE_PX });
    expect(fitToLimits(-50, 300)).toEqual({ width: MIN_SIZE_PX, height: MAX_SIZE_PX });
  });

  it("rounds to whole pixels", () => {
    const { width, height } = fitToLimits(1000.4, 333.3);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });
});

describe("createBlankAndOpen", () => {
  it("makes a blank design of the catalogue type and opens it in the editor", async () => {
    await createBlankAndOpen(type("instagram-post"));
    const saved = await onlyDesign();
    expect(saved).toMatchObject({ typeId: "instagram-post", width: 1080, height: 1350, folderId: null, pageCount: 1, title: "Untitled design" });
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
    const full = await getDesign(saved.id);
    expect(full?.unit).toBe("px");
    expect(full?.pages[0].elements).toEqual([]);
  });

  it("keeps the unit the type is shown in", async () => {
    await createBlankAndOpen(type("poster"));
    const saved = await onlyDesign();
    expect((await getDesign(saved.id))?.unit).toBe("in");
    expect(saved.width).toBe(type("poster").width);
  });

  it("files the design in a folder when asked", async () => {
    const folder = await library.createFolder("Campaign");
    await createBlankAndOpen(type("logo"), { folderId: folder.id });
    expect((await onlyDesign()).folderId).toBe(folder.id);
  });

  it("closes the Create dialog and the template preview on the way to the editor", async () => {
    const dialog = renderHook(() => useCreateDialog());
    const preview = renderHook(() => usePreviewTemplate());
    act(() => {
      openCreateDialog();
      openTemplatePreview(TEMPLATES[0]);
    });
    expect(dialog.result.current.open).toBe(true);
    expect(preview.result.current).not.toBeNull();
    await createBlankAndOpen(type("logo"));
    expect(dialog.result.current.open).toBe(false);
    expect(preview.result.current).toBeNull();
  });

  it("makes only one design when it is called twice at once, as a double click would", async () => {
    await Promise.all([createBlankAndOpen(type("logo")), createBlankAndOpen(type("logo"))]);
    expect(await listDesigns()).toHaveLength(1);
    await createBlankAndOpen(type("logo"));
    expect(await listDesigns()).toHaveLength(2);
  });

  it("says what went wrong and stays where it is when the design cannot be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.location.hash = "#/projects";
    vi.spyOn(library, "createBlankDesign").mockRejectedValueOnce(new Error("The disk is full."));
    await createBlankAndOpen(type("logo"));
    expect(await screen.findByText("Couldn't create the design. The disk is full.")).toBeTruthy();
    expect(window.location.hash).toBe("#/projects");
    expect(await listDesigns()).toEqual([]);
    await createBlankAndOpen(type("logo"));
    expect(await listDesigns()).toHaveLength(1);
  });

  it("asks to try again when the failure has no message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(library, "createBlankDesign").mockRejectedValueOnce("no details");
    await createBlankAndOpen(type("logo"));
    expect(await screen.findByText("Couldn't create the design. Please try again.")).toBeTruthy();
  });

  it("makes a blank design of every catalogue type", async () => {
    for (const designType of DESIGN_TYPES.slice(0, 3)) {
      await createBlankAndOpen(designType);
    }
    expect((await listDesigns()).map((design) => design.typeId).sort()).toEqual(
      DESIGN_TYPES.slice(0, 3)
        .map((item) => item.id)
        .sort(),
    );
  });
});

describe("createCustomAndOpen", () => {
  it("makes a custom-size design in whole pixels and opens it", async () => {
    await createCustomAndOpen(1080.6, 720.2, "mm");
    const saved = await onlyDesign();
    expect(saved).toMatchObject({ typeId: "custom", width: 1081, height: 720 });
    expect((await getDesign(saved.id))?.unit).toBe("mm");
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
  });

  it("files it in a folder when asked", async () => {
    const folder = await library.createFolder("Sizes");
    await createCustomAndOpen(500, 500, "px", { folderId: folder.id });
    expect((await onlyDesign()).folderId).toBe(folder.id);
  });

  it("reports a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(library, "createBlankDesign").mockRejectedValueOnce(new Error("Nope."));
    await createCustomAndOpen(500, 500, "px");
    expect(await screen.findByText("Couldn't create the design. Nope.")).toBeTruthy();
  });
});

describe("createFromImageFile", () => {
  it("makes a design the size of the picture with the picture filling the page, and opens it", async () => {
    const result = await createFromImageFile(imageFile("holiday.png"));
    expect(result).toBeNull();
    const saved = await onlyDesign();
    const [asset] = await listAssets();
    expect(asset.name).toBe("holiday");
    expect(saved).toMatchObject({ typeId: "custom", title: "holiday", width: 64, height: 48, pageCount: 1 });
    const design = await getDesign(saved.id);
    const picture = design?.pages[0].elements[0] as ImageElement;
    expect(picture).toMatchObject({ type: "image", src: assets.assetSrc(asset.id), x: 0, y: 0, width: 64, height: 48, naturalWidth: 64, naturalHeight: 48, name: "holiday" });
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
  });

  it("gives the design a thumbnail, as the editor's autosave does", async () => {
    await createFromImageFile(imageFile("holiday.png"));
    expect((await onlyDesign()).thumbnail).toBe("data:image/jpeg;base64,AAAA");
  });

  it("opens the design without a thumbnail when the picture cannot be drawn", async () => {
    vi.spyOn(renderPage, "renderPageToCanvas").mockRejectedValue(new Error("no canvas"));
    expect(await createFromImageFile(imageFile("holiday.png"))).toBeNull();
    const saved = await onlyDesign();
    expect(saved.thumbnail).toBeUndefined();
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
  });

  it("does not wait longer than two seconds for the thumbnail", async () => {
    vi.spyOn(renderPage, "renderPageToCanvas").mockImplementation(() => new Promise(() => undefined));
    const started = Date.now();
    expect(await createFromImageFile(imageFile("slow.png"))).toBeNull();
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect((await onlyDesign()).thumbnail).toBeUndefined();
  }, 10_000);

  it("scales a huge picture down to the 8000 pixel limit", async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 10000"></svg>'], "wide.svg", { type: "image/svg+xml" });
    expect(await createFromImageFile(svg)).toBeNull();
    const saved = await onlyDesign();
    expect(saved).toMatchObject({ width: 8000, height: 4000 });
    const picture = (await getDesign(saved.id))?.pages[0].elements[0] as ImageElement;
    expect(picture).toMatchObject({ width: 8000, height: 4000, naturalWidth: 20000, naturalHeight: 10000 });
  });

  it("files the design in a folder when asked", async () => {
    const folder = await library.createFolder("Photos");
    await createFromImageFile(imageFile("a.png"), { folderId: folder.id });
    expect((await onlyDesign()).folderId).toBe(folder.id);
  });

  it("explains that a file that is not an image cannot be used, and creates nothing", async () => {
    const message = await createFromImageFile(new File(["hello"], "notes.txt", { type: "text/plain" }));
    expect(message).toBe("That file is not an image. Choose a PNG, JPG, WebP, GIF or SVG file.");
    expect(await listDesigns()).toEqual([]);
    expect(await listAssets()).toEqual([]);
  });

  it("explains it when the picture cannot be read", async () => {
    vi.spyOn(assets, "addAssetFromFile").mockRejectedValueOnce(new Error("corrupt"));
    expect(await createFromImageFile(imageFile("broken.png"))).toBe("Craftly could not read that image. Try a different file.");
    expect(await listDesigns()).toEqual([]);
  });

  it("explains it when the design cannot be saved, and lets the user try again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(library, "createDesignFromPages").mockRejectedValueOnce(new Error("Storage is full."));
    expect(await createFromImageFile(imageFile("a.png"))).toBe("Couldn't create the design. Storage is full.");
    expect(await createFromImageFile(imageFile("a.png"))).toBeNull();
  });

  it("does nothing while another design is being created", async () => {
    let release: () => void = () => undefined;
    const real = library.createBlankDesign;
    vi.spyOn(library, "createBlankDesign").mockImplementationOnce(async (options) => {
      await new Promise<void>((resolve) => (release = resolve));
      return real(options);
    });
    const first = createBlankAndOpen(type("logo"));
    await waitFor(() => expect(library.createBlankDesign).toHaveBeenCalledTimes(1));
    expect(await createFromImageFile(imageFile("busy.png"))).toBeNull();
    expect(await listAssets()).toEqual([]);
    release();
    await first;
    expect(await listDesigns()).toHaveLength(1);
  });
});

describe("pickImageAndCreate", () => {
  it("asks for an image, then makes a design from it", async () => {
    const picker = stubFilePicker([imageFile("picked.png")]);
    await pickImageAndCreate();
    expect(picker.lastAccept()).toBe(IMAGE_ACCEPT);
    expect(picker.lastMultiple()).toBe(false);
    expect((await onlyDesign()).title).toBe("picked");
  });

  it("does nothing when the dialog is cancelled", async () => {
    const picker = stubFilePicker([]);
    await pickImageAndCreate();
    expect(picker.opened()).toBe(1);
    expect(await listDesigns()).toEqual([]);
    expect(document.querySelector(".cf-toast")).toBeNull();
  });

  it("tells the user when the chosen file is not an image", async () => {
    stubFilePicker([new File(["x"], "notes.txt", { type: "text/plain" })]);
    await pickImageAndCreate();
    expect(await screen.findByText("That file is not an image. Choose a PNG, JPG, WebP, GIF or SVG file.")).toBeTruthy();
    expect(await listDesigns()).toEqual([]);
  });

  it("files the design in a folder when asked", async () => {
    const folder = await library.createFolder("Photos");
    stubFilePicker([imageFile("in-folder.png")]);
    await pickImageAndCreate({ folderId: folder.id });
    expect((await onlyDesign()).folderId).toBe(folder.id);
  });
});

describe("createFromAsset", () => {
  it("makes a design from an image that is already in the uploads", async () => {
    const asset = await addAssetFromFile(imageFile("logo.png"));
    await createFromAsset(asset);
    const saved = await onlyDesign();
    expect(saved.title).toBe("logo");
    const picture = (await getDesign(saved.id))?.pages[0].elements[0] as ImageElement;
    expect(picture.src).toBe(assets.assetSrc(asset.id));
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
  });

  it("names the design 'Untitled design' when the image has no name", async () => {
    const asset = await addAssetFromFile(imageFile("logo.png"));
    await createFromAsset({ ...asset, name: "" });
    expect((await onlyDesign()).title).toBe("Untitled design");
  });

  it("reports a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const asset = await addAssetFromFile(imageFile("logo.png"));
    vi.spyOn(library, "createDesignFromPages").mockRejectedValueOnce(new Error("Nope."));
    await createFromAsset(asset);
    expect(await screen.findByText("Couldn't create the design. Nope.")).toBeTruthy();
  });
});

describe("createFromTemplate", () => {
  const template = TEMPLATES[0];

  it("copies the template into a new design with fresh ids and opens it", async () => {
    await createFromTemplate(template);
    const saved = await onlyDesign();
    expect(saved).toMatchObject({ title: template.name, typeId: template.typeId, width: template.width, height: template.height, pageCount: template.pages.length });
    const design = await getDesign(saved.id);
    expect(design?.id).not.toBe(template.id);
    const templatePageIds = new Set(template.pages.map((page) => page.id));
    expect(design?.pages.some((page) => templatePageIds.has(page.id))).toBe(false);
    expect(design?.pages[0].elements.length).toBe(template.pages[0].elements.length);
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
  });

  it("gives the design a thumbnail and the unit of its type", async () => {
    const poster: Template = { ...template, typeId: "poster" };
    await createFromTemplate(poster);
    const saved = await onlyDesign();
    expect(saved.thumbnail).toBe("data:image/jpeg;base64,AAAA");
    expect((await getDesign(saved.id))?.unit).toBe("in");
  });

  it("shows sizes in pixels for a template whose type is not in the catalogue", async () => {
    await createFromTemplate({ ...template, typeId: "no-such-type" });
    expect((await getDesign((await onlyDesign()).id))?.unit).toBe("px");
  });

  it("files the design in a folder when asked", async () => {
    const folder = await library.createFolder("Templates");
    await createFromTemplate(template, { folderId: folder.id });
    expect((await onlyDesign()).folderId).toBe(folder.id);
  });

  it("closes the template preview on the way to the editor", async () => {
    const preview = renderHook(() => usePreviewTemplate());
    act(() => openTemplatePreview(template));
    await createFromTemplate(template);
    expect(preview.result.current).toBeNull();
  });

  it("reports a failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(library, "createDesignFromPages").mockRejectedValueOnce(new Error("Nope."));
    await createFromTemplate(template);
    expect(await screen.findByText("Couldn't start a design from this template. Nope.")).toBeTruthy();
    expect(await listDesigns()).toEqual([]);
  });
});

describe("uploadImageFiles", () => {
  it("stores the images and says how many", async () => {
    const stored = await uploadImageFiles([imageFile("a.png"), imageFile("b.jpg", "image/jpeg")]);
    expect(stored.map((asset) => asset.name)).toEqual(["a", "b"]);
    expect((await listAssets()).map((asset) => asset.name).sort()).toEqual(["a", "b"]);
    expect(await screen.findByText("Uploaded 2 images")).toBeTruthy();
  });

  it("says 'image' for a single one", async () => {
    await uploadImageFiles([imageFile("only.png")]);
    expect(await screen.findByText("Uploaded 1 image")).toBeTruthy();
  });

  it("stays quiet about success when asked, for callers that say something more specific", async () => {
    await uploadImageFiles([imageFile("quiet.png")], { quiet: true });
    expect(await listAssets()).toHaveLength(1);
    expect(document.querySelector(".cf-toast")).toBeNull();
  });

  it("skips files that are not images and names them", async () => {
    const stored = await uploadImageFiles([imageFile("good.png"), new File(["x"], "notes.txt", { type: "text/plain" })]);
    expect(stored).toHaveLength(1);
    expect(await screen.findByText("Couldn't upload notes.txt. Use PNG, JPG, WebP, GIF or SVG images.")).toBeTruthy();
    expect(screen.getByText("Uploaded 1 image")).toBeTruthy();
  });

  it("names two skipped files, and counts the rest", async () => {
    const bad = (name: string) => new File(["x"], name, { type: "text/plain" });
    await uploadImageFiles([bad("a.txt"), bad("b.txt")]);
    expect(await screen.findByText("Couldn't upload a.txt, b.txt. Use PNG, JPG, WebP, GIF or SVG images.")).toBeTruthy();
    act(() => toast.clear());
    await uploadImageFiles([bad("a.txt"), bad("b.txt"), bad("c.txt"), bad("d.txt")]);
    expect(await screen.findByText("Couldn't upload a.txt, b.txt and 2 more. Use PNG, JPG, WebP, GIF or SVG images.")).toBeTruthy();
  });

  it("skips an image that cannot be stored and carries on with the others", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(assets, "addAssetFromFile").mockRejectedValueOnce(new Error("corrupt"));
    const stored = await uploadImageFiles([imageFile("bad.png"), imageFile("ok.png")]);
    expect(stored.map((asset) => asset.name)).toEqual(["ok"]);
    expect(await screen.findByText("Couldn't upload bad.png. Use PNG, JPG, WebP, GIF or SVG images.")).toBeTruthy();
  });

  it("does nothing for an empty list", async () => {
    expect(await uploadImageFiles([])).toEqual([]);
    expect(document.querySelector(".cf-toast")).toBeNull();
  });
});
