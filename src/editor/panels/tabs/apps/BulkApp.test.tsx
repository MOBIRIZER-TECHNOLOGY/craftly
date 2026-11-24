import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { addAssetFromFile } from "@/core/assets";
import { MAX_CELL_CHARS, MAX_INPUT_CHARS } from "@/core/delimited";
import { createDesign, createGroup, createImage, createPage, createTable, createText, paragraphsToText } from "@/core/factory";
import { flatten } from "@/core/ops";
import { getDesign, listDesigns } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design, Page, TableElement, TextElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { lastElement, mountPanels } from "@/test/tabsHarness";
import { useAppsNav } from "./appKit";
import { createBulkDesigns, createBulkPages, readBulkData, useBulkData } from "./bulkCreate";

const SHEET = "Name\tRole\nAda\tEngineer\nGrace\tAdmiral";

beforeEach(() => {
  resetEditor();
  useAppsNav.setState({ app: "bulk", query: "" });
  useBulkData.setState({ data: null, imageColumns: {} });
});

/** A badge page with every place a name in braces can be, and a page after it. */
function badgeDesign(): Design {
  const table = createTable({ x: 100, y: 500 });
  table.cells[0][0] = "{{Name}}";
  const badge = createPage({
    name: "Badge",
    elements: [
      createText({ text: "Hello {{Name}}", align: "center", x: 400, y: 100, name: "greeting" }),
      createGroup([createText({ text: "{{ role }}", x: 0, y: 0, name: "role" })], { x: 100, y: 300 }),
      createText({ text: "{{Name}}, {{Role}}", x: 100, y: 400, locked: true, name: "locked" }),
      table,
    ],
  });
  return createDesign({ title: "Badges", width: 1280, height: 720, pages: [badge, createPage({ name: "Back" })] });
}

async function openBulk(design?: Design) {
  const user = userEvent.setup();
  mountPanels({ tab: "apps", design });
  await screen.findByRole("heading", { name: "Bulk create" });
  return user;
}

async function importSheet(user: ReturnType<typeof userEvent.setup>, text = SHEET) {
  await user.click(screen.getByRole("textbox", { name: "Data to import" }));
  await user.paste(text);
  await user.click(screen.getByRole("button", { name: "Import" }));
}

const pages = (): Page[] => useEditor.getState().design?.pages ?? [];
const status = () => document.querySelector(".cf-bulk__status")?.textContent;
const createButton = () => screen.getByRole("button", { name: /^Create/ }) as HTMLButtonElement;
const named = (page: Page, name: string) => flatten(page.elements).find((el) => el.name === name) as TextElement;
const textOf = (page: Page, name: string) => paragraphsToText(named(page, name).paragraphs);

describe("Bulk create app", () => {
  it("starts by asking for data, with nothing to create", async () => {
    await openBulk();
    expect(screen.getByText("A page for every row of your data")).toBeTruthy();
    expect(screen.getByText("The first row names the columns. Up to 1,000 rows under it are used in batches.")).toBeTruthy();
    expect(status()).toBe("Import your data to see its columns here.");
    expect(createButton().textContent).toBe("Create pages");
    expect(createButton().disabled).toBe(true);
    expect(screen.queryByText("Columns")).toBeNull();
  });

  it("reads pasted rows and offers a button for every column", async () => {
    const user = await openBulk();
    await importSheet(user);
    expect((await screen.findAllByText("Read 2 rows with 2 columns.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add a text box with {{Name}}" }).textContent).toBe("{{Name}}");
    expect(screen.getByRole("button", { name: "Add a text box with {{Role}}" })).toBeTruthy();
    expect(status()).toBe("No column is on this page yet.");
    expect(createButton().disabled).toBe(true);
    // the field is empty again for the next paste
    expect((screen.getByRole("textbox", { name: "Data to import" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("refuses a sheet without a row under its names and keeps what was read before", async () => {
    const user = await openBulk();
    await importSheet(user, "Name\tRole");
    expect((await screen.findAllByText("This needs a first row with the names of the columns and at least one row under it.")).length).toBeGreaterThan(0);
    expect(useBulkData.getState().data).toBeNull();
    await importSheet(user);
    await importSheet(user, "only one line");
    expect(useBulkData.getState().data?.records).toHaveLength(2);
  });

  it("adds a text box with the name of a column in braces, and then knows the column is on the page", async () => {
    const user = await openBulk();
    await importSheet(user);
    await user.click(await screen.findByRole("button", { name: "Add a text box with {{Name}}" }));
    expect(paragraphsToText((lastElement() as TextElement).paragraphs)).toBe("{{Name}}");
    expect(await screen.findByRole("button", { name: "Add another text box with {{Name}}. It is on this page" })).toBeTruthy();
    // the box of the next column lands a line under the first, not on it
    const first = lastElement();
    await user.click(screen.getByRole("button", { name: "Add a text box with {{Role}}" }));
    expect(paragraphsToText((lastElement() as TextElement).paragraphs)).toBe("{{Role}}");
    expect(lastElement().y).toBeGreaterThan(first.y + first.height);
    expect(status()).toBe("");
    expect(createButton().textContent).toBe("Create 2 pages");
    expect(createButton().disabled).toBe(false);
  });

  it("makes a filled copy of the open page for every row, after it and in the order of the rows", async () => {
    const design = badgeDesign();
    const user = await openBulk(design);
    await importSheet(user);
    await waitFor(() => expect(createButton().textContent).toBe("Create 2 pages"));
    const before = pages()[0];
    const centre = named(before, "greeting").x + named(before, "greeting").width / 2;
    await user.click(createButton());

    expect(pages().map((p) => p.name)).toEqual(["Badge", "Ada", "Grace", "Back"]);
    const [template, ada, grace] = pages();
    // the page with the braces is as it was
    expect(template).toBe(before);
    expect(textOf(ada, "greeting")).toBe("Hello Ada");
    expect(textOf(grace, "greeting")).toBe("Hello Grace");
    expect(textOf(ada, "role")).toBe("Engineer");
    expect(textOf(grace, "role")).toBe("Admiral");
    expect((ada.elements[3] as TableElement).cells[0][0]).toBe("Ada");
    // every element of a copy has an id of its own
    const ids = pages().flatMap((p) => flatten(p.elements).map((el) => el.id));
    expect(new Set(ids).size).toBe(ids.length);
    // a centred box that got wider or narrower is still centred where it was
    for (const page of [ada, grace]) {
      const box = named(page, "greeting");
      expect(box.width).not.toBe(named(before, "greeting").width);
      expect(Math.abs(box.x + box.width / 2 - centre)).toBeLessThan(1);
    }
    // the first new page is the open one, and the message says what happened
    expect(useEditor.getState().activePageId).toBe(ada.id);
    expect(await screen.findByText("Created 2 pages, one for each row.")).toBeTruthy();
  });

  it("fills a locked box too and leaves it locked", async () => {
    const user = await openBulk(badgeDesign());
    await importSheet(user);
    await waitFor(() => expect(createButton().disabled).toBe(false));
    await user.click(createButton());
    const ada = pages()[1];
    expect(textOf(ada, "locked")).toBe("Ada, Engineer");
    expect(named(ada, "locked").locked).toBe(true);
    expect(named(ada, "greeting").locked).toBeFalsy();
  });

  it("takes all the pages back with one undo", async () => {
    const design = badgeDesign();
    const user = await openBulk(design);
    await importSheet(user);
    await waitFor(() => expect(createButton().disabled).toBe(false));
    await user.click(createButton());
    expect(pages()).toHaveLength(4);
    act(() => useEditor.getState().actions.undo());
    expect(pages().map((p) => p.id)).toEqual(design.pages.map((p) => p.id));
    act(() => useEditor.getState().actions.redo());
    expect(pages().map((p) => p.name)).toEqual(["Badge", "Ada", "Grace", "Back"]);
  });

  it("names braces that match no column, and leaves them as they are on the new pages", async () => {
    const design = createDesign({ width: 1280, height: 720, pages: [createPage({ elements: [createText({ text: "{{Name}} of {{Company}} and {{ team }}", name: "line" })] })] });
    const user = await openBulk(design);
    await importSheet(user, "Name\nAda");
    await waitFor(() => expect(status()).toBe("No column is called {{company}}, {{team}}."));
    expect(createButton().textContent).toBe("Create 1 page");
    await user.click(createButton());
    expect(textOf(pages()[1], "line")).toBe("Ada of {{Company}} and {{ team }}");
    expect(await screen.findByText("Created 1 page from your data.")).toBeTruthy();
  });

  it("keeps the name of the page when the first column of a row is empty, and cuts a long name", async () => {
    const design = createDesign({ width: 1280, height: 720, pages: [createPage({ name: "Card", elements: [createText({ text: "{{Role}}" })] })] });
    const user = await openBulk(design);
    await importSheet(user, `Name\tRole\n\tEngineer\n${"N".repeat(200)}\tAdmiral`);
    await waitFor(() => expect(createButton().disabled).toBe(false));
    await user.click(createButton());
    expect(pages().map((p) => p.name)).toEqual(["Card", "Card", "N".repeat(80)]);
  });

  it("removes the data again", async () => {
    const user = await openBulk();
    await importSheet(user);
    await user.click(await screen.findByRole("button", { name: "Remove the data" }));
    expect(screen.queryByText("Columns")).toBeNull();
    expect(useBulkData.getState().data).toBeNull();
    expect(status()).toBe("Import your data to see its columns here.");
  });

  it("keeps the data while another tab of the panel is used", async () => {
    const user = await openBulk();
    await importSheet(user);
    await screen.findByRole("button", { name: "Add a text box with {{Name}}" });
    await user.click(screen.getByRole("tab", { name: "Projects" }));
    await user.click(screen.getByRole("tab", { name: "Apps" }));
    expect(await screen.findByRole("button", { name: "Add a text box with {{Name}}" })).toBeTruthy();
  });

  it("creates standalone designs without changing the open design, and opens the first", async () => {
    const design = badgeDesign();
    const user = await openBulk(design);
    await importSheet(user);
    await user.click(screen.getByRole("radio", { name: "Designs" }));
    await waitFor(() => expect(createButton().textContent).toBe("Create 2 designs"));
    await user.click(createButton());

    expect(pages()).toEqual(design.pages);
    const saved = await listDesigns();
    expect(saved.map((item) => item.title).sort()).toEqual(["Badges — Ada", "Badges — Grace"]);
    const ada = await listDesigns().then((items) => items.find((item) => item.title === "Badges — Ada"));
    expect(ada?.pageCount).toBe(1);
    const adaDesign = await getDesign(ada!.id);
    expect(textOf(adaDesign!.pages[0], "greeting")).toBe("Hello Ada");
    expect(textOf(adaDesign!.pages[0], "locked")).toBe("Ada, Engineer");
    expect(named(adaDesign!.pages[0], "locked").locked).toBe(true);
    expect(await screen.findByText("Created 2 standalone designs.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(window.location.hash).toBe(`#/design/${ada?.id}`);
  });

  it("adds no page to a design that is only looked at, and says so", async () => {
    const user = await openBulk(badgeDesign());
    await importSheet(user);
    await waitFor(() => expect(createButton().disabled).toBe(false));
    act(() => useEditor.getState().actions.setMode("view"));
    await user.click(createButton());
    expect(pages()).toHaveLength(2);
    expect(await screen.findByText("This design can only be looked at, so no pages were added.")).toBeTruthy();
  });
});

describe("readBulkData and createBulkPages", () => {
  it("says what was left out of a sheet that is too large", () => {
    const rows = ["Name", ...Array.from({ length: 1200 }, (_, i) => `Person ${i}`)].join("\n");
    expect(readBulkData(rows)).toEqual({ ok: true, clean: false, message: "Read 1,000 rows with 1 column. Only the first 1,000 rows are used." });
    expect(useBulkData.getState().data?.records).toHaveLength(1000);

    const wide = [Array.from({ length: 60 }, (_, i) => `C${i}`).join("\t"), Array.from({ length: 60 }, () => "x").join("\t")].join("\n");
    expect(readBulkData(wide).message).toBe("Read 1 row with 50 columns. Only the first 50 columns are used.");

    expect(readBulkData(`Name\n${"x".repeat(MAX_CELL_CHARS + 5)}`).message).toBe(
      `Read 1 row with 1 column. 1 cell was shortened to ${MAX_CELL_CHARS.toLocaleString("en-US")} characters.`,
    );

    const long = `Name\n${"abcdefghi\n".repeat(MAX_INPUT_CHARS / 10 + 10)}`;
    const report = readBulkData(long);
    expect(report.clean).toBe(false);
    expect(report.message).toContain("The text was too long, so only its beginning was read.");
  });

  it("says that a clean sheet came in whole", () => {
    expect(readBulkData("Name,Role\nAda,Engineer")).toEqual({ ok: true, clean: true, message: "Read 1 row with 2 columns." });
  });

  it("makes nothing without data or without a design", async () => {
    expect(await createBulkPages()).toBe(0);
    readBulkData("Name\nAda");
    expect(await createBulkPages()).toBe(0);
    act(() => useEditor.getState().actions.openDesign(createDesign({ width: 1280, height: 720, pages: [createPage({ elements: [createText({ text: "{{Name}}" })] })] })));
    let made = 0;
    await act(async () => {
      made = await createBulkPages();
    });
    expect(made).toBe(1);
    expect(pages()).toHaveLength(2);
  });

  it("copies a page that has no braces as it is, one for each row", async () => {
    readBulkData("Name\nAda\nGrace");
    act(() =>
      useEditor.getState().actions.openDesign(createDesign({ width: 1280, height: 720, pages: [createPage({ elements: [createText({ text: "No braces", name: "plain" })] })] })),
    );
    await act(async () => {
      await createBulkPages();
    });
    expect(pages().map((p) => textOf(p, "plain"))).toEqual(["No braces", "No braces", "No braces"]);
  });

  it("creates more than 100 rows in batches as one undo step", async () => {
    readBulkData(`Name\n${Array.from({ length: 120 }, (_unused, i) => `Person ${i + 1}`).join("\n")}`);
    act(() => useEditor.getState().actions.openDesign(createDesign({ width: 1280, height: 720, pages: [createPage({ elements: [createText({ text: "{{Name}}" })] })] })));
    await act(async () => {
      expect(await createBulkPages()).toBe(120);
    });
    expect(pages()).toHaveLength(121);
    expect(useEditor.getState().past).toHaveLength(1);
  });
});

describe("bulk image columns", () => {
  it("matches row values to upload names and makes missing names empty frames", async () => {
    const asset = await addAssetFromFile(new File(["picture"], "one.png", { type: "image/png" }));
    const photo = createImage({ id: "photo", src: null, name: "Photo", naturalWidth: 1, naturalHeight: 1 });
    readBulkData("Picture\none\nmissing");
    act(() => useEditor.getState().actions.openDesign(createDesign({ width: 1280, height: 720, pages: [createPage({ elements: [photo] })] })));
    useBulkData.setState({ imageColumns: { photo: "picture" } });
    await act(async () => {
      expect(await createBulkPages()).toBe(2);
    });
    const copies = pages()
      .slice(1)
      .map((page) => flatten(page.elements).find((el) => el.type === "image"));
    expect(copies[0]?.type === "image" && copies[0].src).toBe(`asset:${asset.id}`);
    expect(copies[1]?.type === "image" && copies[1].src).toBeNull();
  });

  it("maps images in standalone designs too", async () => {
    const asset = await addAssetFromFile(new File(["picture"], "one.png", { type: "image/png" }));
    const photo = createImage({ id: "photo", src: null, name: "Photo", naturalWidth: 1, naturalHeight: 1 });
    readBulkData("Picture\none\nmissing");
    act(() => useEditor.getState().actions.openDesign(createDesign({ title: "Pictures", width: 1280, height: 720, pages: [createPage({ elements: [photo] })] })));
    useBulkData.setState({ imageColumns: { photo: "picture" } });
    let made: Design[] = [];
    await act(async () => {
      made = await createBulkDesigns();
    });
    expect(made).toHaveLength(2);
    expect(
      made.map((design) => flatten(design.pages[0].elements).find((el) => el.type === "image")?.type === "image" && (flatten(design.pages[0].elements)[0] as typeof photo).src),
    ).toEqual([`asset:${asset.id}`, null]);
    expect((await listDesigns()).filter((item) => item.title.startsWith("Pictures — "))).toHaveLength(2);
  });
});
