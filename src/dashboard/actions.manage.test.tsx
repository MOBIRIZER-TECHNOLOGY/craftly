import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as assets from "@/core/assets";
import { addAssetFromFile, listAssets } from "@/core/assets";
import * as library from "@/core/library";
import { createFolder, getDesign, getSummary, listDesigns, listFolders, listVersions, moveToFolder, moveToTrash, saveVersion } from "@/core/library";
import type { DesignSummary } from "@/core/types";
import { Hosts, dialogGone, dismissOpenDialogs, emptyLibrary, imageFile, seedDesign } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import {
  createFolderAction,
  deleteAssetAction,
  deleteFolderAction,
  deleteForeverAction,
  duplicateDesignAction,
  emptyTrashAction,
  moveDesignAction,
  moveToNewFolderAction,
  openDesign,
  renameAssetAction,
  renameDesignAction,
  renameFolderAction,
  restoreDesignAction,
  toggleStarAction,
  trashDesignAction,
} from "./actions";

const summaryOf = async (id: string): Promise<DesignSummary> => (await getSummary(id)) as DesignSummary;

/** Type into the open "name" dialog and press Enter. */
async function answerPrompt(user: ReturnType<typeof userEvent.setup>, expectedTitle: string, text: string) {
  const dialog = await screen.findByRole("dialog", { name: expectedTitle });
  const input = within(dialog).getByRole("textbox");
  await user.clear(input);
  if (text) await user.type(input, text);
  await user.keyboard("{Enter}");
}

beforeEach(async () => {
  await emptyLibrary();
  render(<Hosts />);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => toast.clear());
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("uploaded images", () => {
  it("renames an image from the name dialog", async () => {
    const user = userEvent.setup();
    const asset = await addAssetFromFile(imageFile("holiday.png"));
    const done = renameAssetAction(asset);
    const dialog = await screen.findByRole("dialog", { name: "Rename image" });
    expect((within(dialog).getByRole("textbox") as HTMLInputElement).value).toBe("holiday");
    await user.keyboard("Beach{Enter}");
    await done;
    expect((await listAssets())[0].name).toBe("Beach");
  });

  it("leaves the name alone when the dialog is cancelled or the name is unchanged", async () => {
    const user = userEvent.setup();
    const asset = await addAssetFromFile(imageFile("holiday.png"));
    const rename = vi.spyOn(assets, "renameAsset");
    const cancelled = renameAssetAction(asset);
    await screen.findByRole("dialog", { name: "Rename image" });
    await user.keyboard("{Escape}");
    await cancelled;
    await dialogGone();
    const unchanged = renameAssetAction(asset);
    await screen.findByRole("dialog", { name: "Rename image" });
    await user.keyboard("{Enter}");
    await unchanged;
    expect(rename).not.toHaveBeenCalled();
    expect((await listAssets())[0].name).toBe("holiday");
  });

  it("says so when the image cannot be renamed", async () => {
    const user = userEvent.setup();
    const asset = await addAssetFromFile(imageFile("holiday.png"));
    vi.spyOn(assets, "renameAsset").mockRejectedValueOnce(new Error("Locked."));
    const done = renameAssetAction(asset);
    await answerPrompt(user, "Rename image", "Beach");
    await done;
    expect(await screen.findByText("Couldn't rename the image. Locked.")).toBeTruthy();
  });

  it("deletes an image after the user confirms", async () => {
    const user = userEvent.setup();
    const asset = await addAssetFromFile(imageFile("logo.png"));
    const done = deleteAssetAction(asset);
    const dialog = await screen.findByRole("dialog", { name: "Delete “logo”?" });
    expect(dialog.textContent).toContain("Designs that still use it will lose the picture.");
    await user.click(within(dialog).getByRole("button", { name: "Delete image" }));
    await done;
    expect(await listAssets()).toEqual([]);
    expect(await screen.findByText("Image deleted")).toBeTruthy();
  });

  it("keeps the image when the user cancels", async () => {
    const user = userEvent.setup();
    const asset = await addAssetFromFile(imageFile("logo.png"));
    const done = deleteAssetAction(asset);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await done;
    expect(await listAssets()).toHaveLength(1);
    expect(screen.queryByText("Image deleted")).toBeNull();
  });

  it("says so when the image cannot be deleted", async () => {
    const user = userEvent.setup();
    const asset = await addAssetFromFile(imageFile("logo.png"));
    vi.spyOn(assets, "deleteAsset").mockRejectedValueOnce(new Error("Busy."));
    const done = deleteAssetAction(asset);
    await user.click(await screen.findByRole("button", { name: "Delete image" }));
    await done;
    expect(await screen.findByText("Couldn't delete the image. Busy.")).toBeTruthy();
    expect(screen.queryByText("Image deleted")).toBeNull();
  });
});

describe("designs", () => {
  it("opens a design in the editor", async () => {
    const design = await seedDesign({ title: "Open me" });
    openDesign(await summaryOf(design.id));
    expect(window.location.hash).toBe(`#/design/${design.id}`);
  });

  it("renames a design from the name dialog, with the current title prefilled", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Old title" });
    const done = renameDesignAction(await summaryOf(design.id));
    const dialog = await screen.findByRole("dialog", { name: "Rename design" });
    expect((within(dialog).getByRole("textbox") as HTMLInputElement).value).toBe("Old title");
    expect((within(dialog).getByRole("textbox") as HTMLInputElement).placeholder).toBe("Untitled design");
    await user.keyboard("  New title  {Enter}");
    await done;
    expect((await summaryOf(design.id)).title).toBe("New title");
    expect((await getDesign(design.id))?.title).toBe("New title");
  });

  it("leaves the title alone when cancelled or unchanged", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Same" });
    const rename = vi.spyOn(library, "renameDesign");
    const summary = await summaryOf(design.id);
    const cancelled = renameDesignAction(summary);
    await screen.findByRole("dialog", { name: "Rename design" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await cancelled;
    await dialogGone();
    const unchanged = renameDesignAction(summary);
    await screen.findByRole("dialog", { name: "Rename design" });
    await user.keyboard("{Enter}");
    await unchanged;
    expect(rename).not.toHaveBeenCalled();
  });

  it("says so when the design cannot be renamed", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Before" });
    vi.spyOn(library, "renameDesign").mockRejectedValueOnce(new Error("Read-only."));
    const done = renameDesignAction(await summaryOf(design.id));
    await answerPrompt(user, "Rename design", "After");
    await done;
    expect(await screen.findByText("Couldn't rename the design. Read-only.")).toBeTruthy();
  });

  it("makes a copy and offers to open it", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Original", starred: true });
    await duplicateDesignAction(await summaryOf(design.id));
    const all = await listDesigns();
    expect(all.map((item) => item.title).sort()).toEqual(["Original", "Original (copy)"]);
    const copy = all.find((item) => item.title === "Original (copy)") as DesignSummary;
    expect(copy.starred).toBe(false);
    expect(await screen.findByText("Made a copy")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(window.location.hash).toBe(`#/design/${copy.id}`);
  });

  it("says so when the original has gone", async () => {
    const design = await seedDesign({ title: "Gone" });
    const summary = await summaryOf(design.id);
    await library.deleteForever(design.id);
    await duplicateDesignAction(summary);
    expect(await screen.findByText("Couldn't make a copy. The original design could not be found.")).toBeTruthy();
    expect(screen.queryByText("Made a copy")).toBeNull();
  });

  it("stars and unstars a design", async () => {
    const design = await seedDesign({ title: "Star me" });
    await toggleStarAction(await summaryOf(design.id));
    expect((await summaryOf(design.id)).starred).toBe(true);
    await toggleStarAction(await summaryOf(design.id));
    expect((await summaryOf(design.id)).starred).toBe(false);
  });

  it("says so when the star cannot be changed", async () => {
    const design = await seedDesign({ title: "Star me" });
    vi.spyOn(library, "setStarred").mockRejectedValueOnce(new Error("Nope."));
    await toggleStarAction(await summaryOf(design.id));
    expect(await screen.findByText("Couldn't update the star. Nope.")).toBeTruthy();
  });
});

describe("moving designs", () => {
  it("moves a design into a folder and says where", async () => {
    const design = await seedDesign({ title: "Movable" });
    const folder = await createFolder("Campaign");
    await moveDesignAction(await summaryOf(design.id), folder);
    expect((await summaryOf(design.id)).folderId).toBe(folder.id);
    expect(await screen.findByText("Moved to “Campaign”")).toBeTruthy();
  });

  it("moves a design back to Projects", async () => {
    const folder = await createFolder("Campaign");
    const design = await seedDesign({ title: "Movable", folderId: folder.id });
    await moveDesignAction(await summaryOf(design.id), null);
    expect((await summaryOf(design.id)).folderId).toBeNull();
    expect(await screen.findByText("Moved to Projects")).toBeTruthy();
  });

  it("does nothing when the design is already there", async () => {
    const folder = await createFolder("Campaign");
    const inFolder = await seedDesign({ title: "In folder", folderId: folder.id });
    const atRoot = await seedDesign({ title: "At root" });
    const move = vi.spyOn(library, "moveToFolder");
    await moveDesignAction(await summaryOf(inFolder.id), folder);
    await moveDesignAction(await summaryOf(atRoot.id), null);
    expect(move).not.toHaveBeenCalled();
    expect(document.querySelector(".cf-toast")).toBeNull();
  });

  it("says so when the design cannot be moved", async () => {
    const design = await seedDesign({ title: "Movable" });
    const folder = await createFolder("Campaign");
    vi.spyOn(library, "moveToFolder").mockRejectedValueOnce(new Error("Locked."));
    await moveDesignAction(await summaryOf(design.id), folder);
    expect(await screen.findByText("Couldn't move the design. Locked.")).toBeTruthy();
    expect(screen.queryByText("Moved to “Campaign”")).toBeNull();
  });

  it("creates a folder from the move menu and moves the design into it", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Movable" });
    const done = moveToNewFolderAction(await summaryOf(design.id));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    expect((within(dialog).getByRole("button", { name: "Create and move" }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard("Logos{Enter}");
    await done;
    const [folder] = await listFolders();
    expect(folder.name).toBe("Logos");
    expect((await summaryOf(design.id)).folderId).toBe(folder.id);
    expect(await screen.findByText("Moved to “Logos”")).toBeTruthy();
  });

  it("creates nothing when the folder name dialog is cancelled", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Movable" });
    const done = moveToNewFolderAction(await summaryOf(design.id));
    await screen.findByRole("dialog", { name: "New folder" });
    await user.keyboard("{Escape}");
    await done;
    expect(await listFolders()).toEqual([]);
    expect((await summaryOf(design.id)).folderId).toBeNull();
  });

  it("says so when the folder cannot be created", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Movable" });
    vi.spyOn(library, "createFolder").mockRejectedValueOnce(new Error("Full."));
    const done = moveToNewFolderAction(await summaryOf(design.id));
    await answerPrompt(user, "New folder", "Logos");
    await done;
    expect(await screen.findByText("Couldn't create the folder. Full.")).toBeTruthy();
    expect((await summaryOf(design.id)).folderId).toBeNull();
  });
});

describe("trash", () => {
  it("moves a design to the trash and offers to undo it", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Throw away" });
    await trashDesignAction(await summaryOf(design.id));
    expect((await summaryOf(design.id)).trashedAt).toEqual(expect.any(Number));
    expect(await screen.findByText("Moved to trash")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(async () => expect((await summaryOf(design.id)).trashedAt).toBeNull());
  });

  it("says so when the design cannot be moved to the trash", async () => {
    const design = await seedDesign({ title: "Throw away" });
    vi.spyOn(library, "moveToTrash").mockRejectedValueOnce(new Error("Locked."));
    await trashDesignAction(await summaryOf(design.id));
    expect(await screen.findByText("Couldn't move the design to the trash. Locked.")).toBeTruthy();
    expect(screen.queryByText("Moved to trash")).toBeNull();
    expect((await summaryOf(design.id)).trashedAt).toBeNull();
  });

  it("says so when the undo does not work", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Throw away" });
    await trashDesignAction(await summaryOf(design.id));
    vi.spyOn(library, "restoreFromTrash").mockRejectedValueOnce(new Error("Locked."));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn't restore the design. Locked.")).toBeTruthy();
  });

  it("restores a design from the trash and offers to open it", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Bring back" });
    await moveToTrash(design.id);
    await restoreDesignAction(await summaryOf(design.id));
    expect((await summaryOf(design.id)).trashedAt).toBeNull();
    expect(await screen.findByText("Restored “Bring back”")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(window.location.hash).toBe(`#/design/${design.id}`);
  });

  it("says so when the design cannot be restored", async () => {
    const design = await seedDesign({ title: "Bring back" });
    await moveToTrash(design.id);
    vi.spyOn(library, "restoreFromTrash").mockRejectedValueOnce(new Error("Locked."));
    await restoreDesignAction(await summaryOf(design.id));
    expect(await screen.findByText("Couldn't restore the design. Locked.")).toBeTruthy();
    expect(screen.queryByText("Restored “Bring back”")).toBeNull();
  });

  it("deletes a design and its version history forever after the user confirms", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Delete me" });
    await saveVersion(design, "first");
    await moveToTrash(design.id);
    const done = deleteForeverAction(await summaryOf(design.id));
    const dialog = await screen.findByRole("dialog", { name: "Delete “Delete me” forever?" });
    expect(dialog.textContent).toContain("You can't undo it.");
    await user.click(within(dialog).getByRole("button", { name: "Delete forever" }));
    await done;
    expect(await getDesign(design.id)).toBeNull();
    expect(await getSummary(design.id)).toBeNull();
    expect(await listVersions(design.id)).toEqual([]);
    expect(await screen.findByText("Design deleted")).toBeTruthy();
  });

  it("keeps the design when the user cancels", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Keep me" });
    const done = deleteForeverAction(await summaryOf(design.id));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await done;
    expect(await getDesign(design.id)).not.toBeNull();
    expect(screen.queryByText("Design deleted")).toBeNull();
  });

  it("says so when the design cannot be deleted", async () => {
    const user = userEvent.setup();
    const design = await seedDesign({ title: "Stuck" });
    vi.spyOn(library, "deleteForever").mockRejectedValueOnce(new Error("Busy."));
    const done = deleteForeverAction(await summaryOf(design.id));
    await user.click(await screen.findByRole("button", { name: "Delete forever" }));
    await done;
    expect(await screen.findByText("Couldn't delete the design. Busy.")).toBeTruthy();
  });

  it("empties the trash after the user confirms, leaving other designs alone", async () => {
    const user = userEvent.setup();
    const a = await seedDesign({ title: "Trashed A" });
    const b = await seedDesign({ title: "Trashed B" });
    await seedDesign({ title: "Alive" });
    await moveToTrash(a.id);
    await moveToTrash(b.id);
    const done = emptyTrashAction(2);
    const dialog = await screen.findByRole("dialog", { name: "Empty the trash?" });
    expect(dialog.textContent).toContain("2 designs will be deleted forever from this device.");
    await user.click(within(dialog).getByRole("button", { name: "Empty trash" }));
    await done;
    expect((await listDesigns()).map((design) => design.title)).toEqual(["Alive"]);
    expect(await screen.findByText("Trash emptied")).toBeTruthy();
  });

  it("says 'design' for a trash with one design, and keeps everything when cancelled", async () => {
    const user = userEvent.setup();
    const a = await seedDesign({ title: "Trashed A" });
    await moveToTrash(a.id);
    const done = emptyTrashAction(1);
    const dialog = await screen.findByRole("dialog", { name: "Empty the trash?" });
    expect(dialog.textContent).toContain("1 design will be deleted forever");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await done;
    expect(await listDesigns()).toHaveLength(1);
    expect(screen.queryByText("Trash emptied")).toBeNull();
  });

  it("says so when the trash cannot be emptied", async () => {
    const user = userEvent.setup();
    vi.spyOn(library, "emptyTrash").mockRejectedValueOnce(new Error("Busy."));
    const done = emptyTrashAction(3);
    await user.click(await screen.findByRole("button", { name: "Empty trash" }));
    await done;
    expect(await screen.findByText("Couldn't empty the trash. Busy.")).toBeTruthy();
  });
});

describe("folders", () => {
  it("creates a folder from the name dialog and returns it", async () => {
    const user = userEvent.setup();
    const done = createFolderAction();
    const dialog = await screen.findByRole("dialog", { name: "Create folder" });
    expect((within(dialog).getByRole("textbox") as HTMLInputElement).placeholder).toBe("Untitled folder");
    await user.keyboard("Campaign{Enter}");
    const folder = await done;
    expect(folder?.name).toBe("Campaign");
    expect((await listFolders()).map((item) => item.name)).toEqual(["Campaign"]);
    expect(await screen.findByText("Created “Campaign”")).toBeTruthy();
  });

  it("returns nothing when the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const done = createFolderAction();
    await screen.findByRole("dialog", { name: "Create folder" });
    await user.keyboard("{Escape}");
    expect(await done).toBeNull();
    expect(await listFolders()).toEqual([]);
  });

  it("returns nothing and says so when the folder cannot be created", async () => {
    const user = userEvent.setup();
    vi.spyOn(library, "createFolder").mockRejectedValueOnce(new Error("Full."));
    const done = createFolderAction();
    await answerPrompt(user, "Create folder", "Campaign");
    expect(await done).toBeNull();
    expect(await screen.findByText("Couldn't create the folder. Full.")).toBeTruthy();
  });

  it("renames a folder", async () => {
    const user = userEvent.setup();
    const folder = await createFolder("Old name");
    const done = renameFolderAction(folder);
    const dialog = await screen.findByRole("dialog", { name: "Rename folder" });
    expect((within(dialog).getByRole("textbox") as HTMLInputElement).value).toBe("Old name");
    await user.keyboard("New name{Enter}");
    await done;
    expect((await listFolders()).map((item) => item.name)).toEqual(["New name"]);
  });

  it("leaves the name alone when cancelled or unchanged, and says so when renaming fails", async () => {
    const user = userEvent.setup();
    const folder = await createFolder("Same");
    const rename = vi.spyOn(library, "renameFolder");
    const cancelled = renameFolderAction(folder);
    await screen.findByRole("dialog", { name: "Rename folder" });
    await user.keyboard("{Escape}");
    await cancelled;
    await dialogGone();
    const unchanged = renameFolderAction(folder);
    await screen.findByRole("dialog", { name: "Rename folder" });
    await user.keyboard("{Enter}");
    await unchanged;
    await dialogGone();
    expect(rename).not.toHaveBeenCalled();
    rename.mockRejectedValueOnce(new Error("Locked."));
    const failing = renameFolderAction(folder);
    await answerPrompt(user, "Rename folder", "Other");
    await failing;
    expect(await screen.findByText("Couldn't rename the folder. Locked.")).toBeTruthy();
  });

  it("deletes a folder after the user confirms, moving its designs back to Projects", async () => {
    const user = userEvent.setup();
    const folder = await createFolder("Campaign");
    const design = await seedDesign({ title: "Inside" });
    await moveToFolder(design.id, folder.id);
    const done = deleteFolderAction(folder, 1);
    const dialog = await screen.findByRole("dialog", { name: "Delete “Campaign”?" });
    expect(dialog.textContent).toContain("The 1 design inside will move back to Projects. Nothing else is deleted.");
    await user.click(within(dialog).getByRole("button", { name: "Delete folder" }));
    expect(await done).toBe(true);
    expect(await listFolders()).toEqual([]);
    expect((await summaryOf(design.id)).folderId).toBeNull();
    expect(await screen.findByText("Folder deleted")).toBeTruthy();
  });

  it("explains that an empty folder affects nothing else", async () => {
    const user = userEvent.setup();
    const folder = await createFolder("Empty one");
    const done = deleteFolderAction(folder, 0);
    const dialog = await screen.findByRole("dialog", { name: "Delete “Empty one”?" });
    expect(dialog.textContent).toContain("The folder is empty, so nothing else is affected.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await done).toBe(false);
    expect(await listFolders()).toHaveLength(1);
  });

  it("returns false and says so when the folder cannot be deleted", async () => {
    const user = userEvent.setup();
    const folder = await createFolder("Stuck");
    vi.spyOn(library, "deleteFolder").mockRejectedValueOnce(new Error("Busy."));
    const done = deleteFolderAction(folder, 2);
    await user.click(await screen.findByRole("button", { name: "Delete folder" }));
    expect(await done).toBe(false);
    expect(await screen.findByText("Couldn't delete the folder. Busy.")).toBeTruthy();
    expect(screen.queryByText("Folder deleted")).toBeNull();
  });
});
