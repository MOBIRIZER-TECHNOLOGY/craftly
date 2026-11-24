import { describe, expect, it } from "vitest";
import { BULK_LIMITS, applyFill, bulkData, fieldKey, fillParagraph, fillText, pageFills, pagePlaceholders, placeholderFor, recordValues } from "./bulk";
import { parseDelimited } from "./delimited";
import { createGroup, createPage, createShape, createTable, createText } from "./factory";
import type { TableElement, TextElement, TextParagraph } from "./types";

const sheet = (text: string) => bulkData(parseDelimited(text, BULK_LIMITS));
const values = (pairs: Record<string, string>) => new Map(Object.entries(pairs));
const text = (p: TextParagraph | null) => p?.runs.map((r) => r.text).join("");

describe("bulkData: a sheet with a row of names", () => {
  it("reads the names of the columns and the rows under them", () => {
    const data = sheet("Name,Role\nAda,Engineer\nGrace,Admiral");
    expect(data?.fields).toEqual([
      { name: "Name", key: "name", col: 0 },
      { name: "Role", key: "role", col: 1 },
    ]);
    expect(data?.records).toEqual([
      ["Ada", "Engineer"],
      ["Grace", "Admiral"],
    ]);
  });

  it("needs a row under the names, and a name", () => {
    expect(sheet("Name,Role")).toBeNull();
    expect(sheet("")).toBeNull();
    expect(sheet(",\nAda,Engineer")).toBeNull();
  });

  it("leaves out a column without a name and the second of two columns with one name", () => {
    const data = sheet("Name,,name , Job  title \nAda,x,y,Engineer");
    expect(data?.fields).toEqual([
      { name: "Name", key: "name", col: 0 },
      { name: "Job title", key: "job title", col: 3 },
    ]);
  });

  it("takes braces and line breaks out of a name, so that it can be written between braces", () => {
    const data = sheet('"{First}\nname"\nAda');
    expect(data?.fields).toEqual([{ name: "First name", key: "first name", col: 0 }]);
  });

  it("gives the values of a record by key, with the line ends of a text box and an empty value for a short row", () => {
    const data = { fields: [{ name: "A", key: "a", col: 0 }, { name: "B", key: "b", col: 2 }], records: [] }; // prettier-ignore
    expect([...recordValues(data, ["one\r\ntwo\rthree", "skipped"])]).toEqual([
      ["a", "one\ntwo\nthree"],
      ["b", ""],
    ]);
  });
});

describe("names in braces", () => {
  it("compares names without capitals and without the spaces around and inside them", () => {
    expect(fieldKey("  Job   Title ")).toBe("job title");
    expect(placeholderFor("Job title")).toBe("{{Job title}}");
  });

  it("fills the names that have a value and leaves the others", () => {
    expect(fillText("Dear {{ NAME }}, {{role}} at {{Company}}", values({ name: "Ada", role: "" }))).toBe("Dear Ada,  at {{Company}}");
  });

  it("does not read a value as braces again", () => {
    expect(fillText("{{a}} {{b}}", values({ a: "{{b}}", b: "B" }))).toBe("{{b}} B");
  });

  it("takes single braces, empty braces and braces over two lines as ordinary text", () => {
    const same = "{name} {{}} {{na\nme}}";
    expect(fillText(same, values({ name: "Ada" }))).toBe(same);
  });

  it("lists the names on a page once each: in text boxes, inside groups and in tables", () => {
    const table = createTable();
    table.cells[1][1] = "{{Price}}";
    const page = createPage({
      elements: [
        createText({ text: "Hello {{Name}} and {{ name }}" }),
        createGroup([createText({ text: "{{Role}}" }), createShape("rect")]),
        table,
        createText({ text: "No braces here" }),
      ],
    });
    expect(pagePlaceholders(page)).toEqual(["name", "role", "price"]);
    expect(pagePlaceholders(createPage())).toEqual([]);
  });
});

describe("fillParagraph", () => {
  it("answers null when the paragraph has no braces with a value", () => {
    expect(fillParagraph({ runs: [{ text: "Hello {{Other}}" }] }, values({ name: "Ada" }))).toBeNull();
    expect(fillParagraph({ runs: [{ text: "" }] }, values({ name: "Ada" }))).toBeNull();
  });

  it("fills braces inside one run and keeps the run's style and the paragraph's settings", () => {
    const filled = fillParagraph({ align: "center", list: "bullet", runs: [{ text: "To {{Name}}!", bold: true, color: "#ff0000" }] }, values({ name: "Ada" }));
    expect(filled).toEqual({ align: "center", list: "bullet", runs: [{ text: "To Ada!", bold: true, color: "#ff0000" }] });
  });

  it("fills several braces of one run", () => {
    expect(text(fillParagraph({ runs: [{ text: "{{a}}-{{b}}-{{a}}" }] }, values({ a: "1", b: "22" })))).toBe("1-22-1");
  });

  it("gives a value the style of the run its braces begin in when they lie in several runs", () => {
    const paragraph: TextParagraph = { runs: [{ text: "Dear {{Na", italic: true }, { text: "m" }, { text: "e}}, welcome", bold: true }] };
    expect(fillParagraph(paragraph, values({ name: "Ada" }))).toEqual({
      runs: [
        { text: "Dear Ada", italic: true },
        { text: ", welcome", bold: true },
      ],
    });
  });

  it("fills braces in one run and braces across runs of the same paragraph", () => {
    const paragraph: TextParagraph = { runs: [{ text: "{{a}} {{" }, { text: "b}} {{a}}", underline: true }] };
    expect(fillParagraph(paragraph, values({ a: "x", b: "yy" }))).toEqual({ runs: [{ text: "x yy" }, { text: " x", underline: true }] });
  });

  it("leaves one empty run, in the style of the first, when a value is empty and nothing else is there", () => {
    expect(fillParagraph({ runs: [{ text: "{{a", bold: true }, { text: "}}" }] }, values({ a: "" }))).toEqual({ runs: [{ text: "", bold: true }] });
  });

  it("does not change the paragraph it was given", () => {
    const paragraph: TextParagraph = { runs: [{ text: "{{a}}" }] };
    fillParagraph(paragraph, values({ a: "x" }));
    expect(paragraph).toEqual({ runs: [{ text: "{{a}}" }] });
  });
});

describe("pageFills", () => {
  const cellTable = (): TableElement => {
    const table = createTable();
    table.cells = [
      ["Item", "Price"],
      ["{{Item}}", "{{price}} EUR"],
    ];
    return table;
  };

  it("has an entry for every text box and table with braces to fill, inside groups too, and says which are locked", () => {
    const title = createText({ text: "{{Name}}\nsecond line" });
    const inner = createText({ text: "{{Role}}", locked: true });
    const plain = createText({ text: "Nothing" });
    const other = createText({ text: "{{Unknown}}" });
    const table = cellTable();
    const page = createPage({ elements: [title, createGroup([inner]), plain, other, table, createShape("rect")] });
    const fills = pageFills(page, values({ name: "Ada", role: "Engineer", item: "Pen", price: "2" }));
    expect(fills.map((f) => [f.id, f.locked])).toEqual([
      [title.id, false],
      [inner.id, true],
      [table.id, false],
    ]);
    expect(fills[0].paragraphs?.map(text)).toEqual(["Ada", "second line"]);
    expect(fills[2].cells).toEqual([
      ["Item", "Price"],
      ["Pen", "2 EUR"],
    ]);
  });

  it("has no entry for a table whose braces have no value", () => {
    expect(pageFills(createPage({ elements: [cellTable()] }), values({ name: "Ada" }))).toEqual([]);
  });

  it("puts a fill into its element, and into no element of another kind", () => {
    const box = createText({ text: "{{Name}}" });
    const table = cellTable();
    const page = createPage({ elements: [box, table] });
    const [forText, forTable] = pageFills(page, values({ name: "Ada", item: "Pen" }));
    applyFill(box, forText);
    applyFill(table, forTable);
    expect((box as TextElement).paragraphs.map(text)).toEqual(["Ada"]);
    expect(table.cells[1]).toEqual(["Pen", "{{price}} EUR"]);
    const shape = createShape("rect");
    const before = JSON.stringify(shape);
    applyFill(shape, forText);
    applyFill(box, forTable);
    applyFill(table, forText);
    expect(JSON.stringify(shape)).toBe(before);
    expect(box.paragraphs.map(text)).toEqual(["Ada"]);
    expect(table.cells[1][0]).toBe("Pen");
  });
});
