import { describe, expect, it } from "vitest";
import { CHART_LIMITS, MAX_CELL_CHARS, MAX_INPUT_CHARS, TABLE_LIMITS, chartData, decimalMark, oneLine, parseDataNumber, parseDelimited, tabularText } from "./delimited";

const rows = (text: string) => parseDelimited(text).rows;

describe("parseDelimited: finding the delimiter", () => {
  it("reads commas, semicolons and tabs", () => {
    expect(parseDelimited("a,b\n1,2")).toMatchObject({ delimiter: ",", rows: [["a", "b"], ["1", "2"]] }); // prettier-ignore
    expect(parseDelimited("a;b\n1;2")).toMatchObject({ delimiter: ";", rows: [["a", "b"], ["1", "2"]] }); // prettier-ignore
    expect(parseDelimited("a\tb\n1\t2")).toMatchObject({ delimiter: "\t", rows: [["a", "b"], ["1", "2"]] }); // prettier-ignore
  });

  it("takes the tab of a spreadsheet copy even when the cells hold commas and semicolons", () => {
    expect(rows("Smith, John\t1,5\nDoe; Jane\t2,5")).toEqual([
      ["Smith, John", "1,5"],
      ["Doe; Jane", "2,5"],
    ]);
  });

  it("takes the semicolon when commas are the decimal marks of the numbers", () => {
    expect(parseDelimited("x;1,5;2,5\ny;3,5;4,5")).toMatchObject({ delimiter: ";", rows: [["x", "1,5", "2,5"], ["y", "3,5", "4,5"]] }); // prettier-ignore
  });

  it("does not count a delimiter inside quotes", () => {
    expect(parseDelimited('"a;b;c;d",1\n"e;f;g;h",2').delimiter).toBe(",");
  });

  it("takes the most frequent delimiter when no one divides every line alike, and a comma when there is none", () => {
    expect(parseDelimited("a,b,c\nd;e,f,g,h").delimiter).toBe(",");
    expect(parseDelimited("a;b;c\nd;e,f").delimiter).toBe(";");
    expect(parseDelimited("only words\nmore words")).toMatchObject({ delimiter: ",", rows: [["only words"], ["more words"]] });
  });

  it("uses the delimiter it is told to use", () => {
    expect(parseDelimited("a,b\tc", { delimiter: "\t" }).rows).toEqual([["a,b", "c"]]);
  });
});

describe("parseDelimited: quotes, line ends and odd shapes", () => {
  it("keeps delimiters, doubled quotes and line breaks that stand inside quotes", () => {
    expect(rows('name,note\n"Smith, John","said ""hi"""\n"two\nlines",x')).toEqual([
      ["name", "note"],
      ["Smith, John", 'said "hi"'],
      ["two\nlines", "x"],
    ]);
  });

  it("takes a quote in the middle of a field, and text after a closing quote, as they are", () => {
    expect(rows('5" nail,"big"ger\nx,y')).toEqual([
      ['5" nail', "bigger"],
      ["x", "y"],
    ]);
  });

  it("reads a quote that is never closed to the end of the text", () => {
    expect(rows('a,"b\nc,d')).toEqual([["a", "b\nc,d"]]);
  });

  it("reads Windows and old Mac line ends, drops a byte order mark, a last line end and empty lines", () => {
    expect(rows("\ufeffa,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(rows("a,b\r1,2\r")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(rows("a,b\n\n\n1,2\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps a row of empty cells and a quoted empty cell on a line of its own", () => {
    expect(rows("a\tb\n\t\nc\td")).toEqual([
      ["a", "b"],
      ["", ""],
      ["c", "d"],
    ]);
    expect(rows('a\n""\nb')).toEqual([["a"], [""], ["b"]]);
  });

  it("pads short rows with empty cells and says that the rows were not alike", () => {
    const data = parseDelimited("a,b,c\n1\n2,3");
    expect(data.rows).toEqual([
      ["a", "b", "c"],
      ["1", "", ""],
      ["2", "3", ""],
    ]);
    expect(data.ragged).toBe(true);
    expect(parseDelimited("a,b\n1,2").ragged).toBe(false);
  });

  it("gives no rows for nothing, for white space and for a lone byte order mark", () => {
    for (const text of ["", "\n\r\n", "\ufeff"]) expect(parseDelimited(text)).toMatchObject({ rows: [], cut: { rows: false, cols: false, cells: 0, input: false } });
  });

  it("puts markup and formulas into the cells as the plain text they are", () => {
    expect(rows('<img src=x onerror=alert(1)>,=HYPERLINK("x")\n${a},__proto__')).toEqual([
      ["<img src=x onerror=alert(1)>", '=HYPERLINK("x")'],
      ["${a}", "__proto__"],
    ]);
  });
});

describe("parseDelimited: limits", () => {
  it("stops at 200 rows and 50 columns for a table and says what was cut", () => {
    expect(TABLE_LIMITS).toEqual({ rows: 200, cols: 50 });
    const wide = Array.from({ length: 60 }, (_, i) => `c${i}`).join(",");
    const data = parseDelimited(Array.from({ length: 250 }, () => wide).join("\n"));
    expect(data.rows).toHaveLength(200);
    expect(data.rows[0]).toHaveLength(50);
    expect(data.rows[199][49]).toBe("c49");
    expect(data.cut).toEqual({ rows: true, cols: true, cells: 0, input: false });
  });

  it("cuts nothing at exactly the limits, also with a line end after the last row", () => {
    const line = Array.from({ length: 50 }, (_, i) => i).join("\t");
    const data = parseDelimited(Array.from({ length: 200 }, () => line).join("\n") + "\n\n");
    expect(data.rows).toHaveLength(200);
    expect(data.cut).toEqual({ rows: false, cols: false, cells: 0, input: false });
  });

  it("takes limits of its caller", () => {
    const data = parseDelimited("a,b,c\n1,2,3\n4,5,6", { rows: 2, cols: 2 });
    expect(data.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(data.cut).toMatchObject({ rows: true, cols: true });
  });

  it("shortens a cell that is longer than the limit and counts it", () => {
    const data = parseDelimited(`${"x".repeat(MAX_CELL_CHARS + 50)},"${"y".repeat(MAX_CELL_CHARS + 1)}",ok`);
    expect(data.rows[0].map((c) => c.length)).toEqual([MAX_CELL_CHARS, MAX_CELL_CHARS, 2]);
    expect(data.cut.cells).toBe(2);
  });

  it("reads only the beginning of a text that is longer than the cap, quickly", () => {
    const line = "abc,def,ghi\n";
    const huge = line.repeat(Math.ceil((MAX_INPUT_CHARS * 2) / line.length));
    const started = performance.now();
    const data = parseDelimited(huge);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(data.cut.input).toBe(true);
    expect(data.rows).toHaveLength(200);
    // without the row limit the cap on the text is what stops it
    const all = parseDelimited(huge, { rows: Infinity, cols: 50 });
    expect(all.cut).toMatchObject({ input: true, rows: false });
    expect(all.rows.length).toBeLessThanOrEqual(Math.ceil(MAX_INPUT_CHARS / line.length));
  });
});

describe("tabularText: is this paste a table?", () => {
  it("says yes to a block of a spreadsheet and to a clear CSV", () => {
    expect(tabularText("a\tb\n1\t2")?.rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(tabularText("name,qty\napples,3\npears,5\n")?.rows).toHaveLength(3);
    expect(tabularText("name;qty\napples;3")?.delimiter).toBe(";");
    // an empty corner cell, as in a block with row and column headings
    expect(tabularText("\tQ1\nNorth\t5")?.rows[0]).toEqual(["", "Q1"]);
  });

  it("says no to one row, to one column and to nothing", () => {
    expect(tabularText("a\tb\tc")).toBeNull();
    expect(tabularText("a\nb\nc")).toBeNull();
    expect(tabularText("")).toBeNull();
  });

  it("says no to rows that are not alike", () => {
    expect(tabularText("a,b,c\n1,2")).toBeNull();
    expect(tabularText("a\tb\nplain line\nc\td")).toBeNull();
  });

  it("says no to sentences that happen to hold a comma each", () => {
    expect(tabularText("Hello, world\nGoodbye, moon")).toBeNull();
    expect(tabularText("First; then\nsecond; last")).toBeNull();
    // with a tab between the cells a space after a comma means nothing
    expect(tabularText("Smith, John\t1\nDoe, Jane\t2")).not.toBeNull();
  });
});

describe("parseDataNumber", () => {
  it("reads plain numbers, signs and a decimal mark of either kind", () => {
    expect(parseDataNumber("42")).toBe(42);
    expect(parseDataNumber(" 3.5 ")).toBe(3.5);
    expect(parseDataNumber("7,5")).toBe(7.5);
    expect(parseDataNumber("-12")).toBe(-12);
    expect(parseDataNumber("+12")).toBe(12);
    expect(parseDataNumber("\u22124.25")).toBe(-4.25);
    expect(parseDataNumber(".5")).toBe(0.5);
    expect(parseDataNumber("5.")).toBe(5);
    expect(parseDataNumber("0")).toBe(0);
  });

  it("reads thousands separators when both marks are there: the last one is the decimal mark", () => {
    expect(parseDataNumber("1,234.5")).toBe(1234.5);
    expect(parseDataNumber("1.234,5")).toBe(1234.5);
    expect(parseDataNumber("1,234,567.89")).toBe(1234567.89);
    expect(parseDataNumber("1.234.567,89")).toBe(1234567.89);
    expect(parseDataNumber("1,234,567")).toBe(1234567);
    expect(parseDataNumber("1.234.567")).toBe(1234567);
  });

  it("reads the Indian grouping of lakhs and crores", () => {
    expect(parseDataNumber("12,34,567")).toBe(1234567);
    expect(parseDataNumber("\u20b91,23,456.78")).toBe(123456.78);
  });

  it("reads one mark before three digits by the decimal mark it is told, a point when told nothing", () => {
    expect(parseDataNumber("1,234")).toBe(1234);
    expect(parseDataNumber("1.234")).toBe(1.234);
    expect(parseDataNumber("1,234", ",")).toBe(1.234);
    expect(parseDataNumber("1.234", ",")).toBe(1234);
    // not three digits after it: a decimal mark whatever was said
    expect(parseDataNumber("1,23", ".")).toBe(1.23);
    expect(parseDataNumber("1.5", ",")).toBe(1.5);
    expect(parseDataNumber("1234,567")).toBe(1234.567);
  });

  it("reads spaces and apostrophes between groups of three", () => {
    expect(parseDataNumber("1 234 567")).toBe(1234567);
    expect(parseDataNumber("1\u00a0234,5")).toBe(1234.5);
    expect(parseDataNumber("12\u202f345.75")).toBe(12345.75);
    expect(parseDataNumber("1'234'567.5")).toBe(1234567.5);
    // after such groups a mark is the decimal mark, three digits or not
    expect(parseDataNumber("1 234,567")).toBe(1234.567);
  });

  it("reads percent signs, currency signs and negatives in brackets", () => {
    expect(parseDataNumber("12%")).toBe(12);
    expect(parseDataNumber("12,5 %")).toBe(12.5);
    expect(parseDataNumber("$1,234.50")).toBe(1234.5);
    expect(parseDataNumber("1.234,50 \u20ac")).toBe(1234.5);
    expect(parseDataNumber("\u00a312")).toBe(12);
    expect(parseDataNumber("\u20b9 1,200")).toBe(1200);
    expect(parseDataNumber("-$5")).toBe(-5);
    expect(parseDataNumber("$-5")).toBe(-5);
    expect(parseDataNumber("(123)")).toBe(-123);
    expect(parseDataNumber("($1,234.5)")).toBe(-1234.5);
    expect(parseDataNumber("(12%)")).toBe(-12);
  });

  it("refuses everything else", () => {
    for (const text of [
      "",
      "  ",
      "abc",
      "12x",
      "1e5",
      "0x10",
      "1,2,3",
      "1.2.3",
      "12,34,56",
      "12.34.567",
      "1,2345.6",
      "1.234.5",
      "--5",
      "(5",
      "5)",
      "(-5)",
      "$",
      "%",
      "-",
      ".",
      ",",
      "$5$",
      "5%%",
      "1 2",
      "12 34",
      "Infinity",
      "NaN",
      "1/2",
      "12:30",
      "2024-01-05",
      "\u0661\u0662",
    ])
      expect(parseDataNumber(text), JSON.stringify(text)).toBeNull();
  });
});

describe("decimalMark", () => {
  it("is a comma when a number can only be read that way and none says otherwise", () => {
    expect(decimalMark(["1,5", "1.234"], ",")).toBe(",");
    expect(decimalMark(["1.234,5", "x"], "\t")).toBe(",");
  });

  it("is a point when a number says so, when the numbers disagree and when nothing is known", () => {
    expect(decimalMark(["1.5", "1,234"], ";")).toBe(".");
    expect(decimalMark(["1,5", "2.5"], ";")).toBe(".");
    expect(decimalMark(["1,234", "12", "words"], ",")).toBe(".");
    expect(decimalMark([], "\t")).toBe(".");
  });

  it("is a comma in a file divided by semicolons when no number says anything", () => {
    expect(decimalMark(["1,234", "12"], ";")).toBe(",");
  });
});

describe("oneLine", () => {
  it("joins the lines of a cell with a space", () => {
    expect(oneLine(" two \r\n lines\nthree\tx ")).toBe("two lines three\tx");
  });
});

describe("chartData", () => {
  const chart = (text: string) => chartData(parseDelimited(text, CHART_LIMITS));

  it("takes the first column as labels and a first row without numbers as the names of the series", () => {
    expect(chart("Month,Sales,Costs\nJan,10,4\nFeb,20,5")).toEqual({
      labels: ["Jan", "Feb"],
      series: [
        { name: "Sales", values: [10, 20] },
        { name: "Costs", values: [4, 5] },
      ],
      notNumbers: 0,
    });
  });

  it("takes a numeric first row as data and names the series itself", () => {
    expect(chart("Jan,10,4\nFeb,20,5")).toEqual({
      labels: ["Jan", "Feb"],
      series: [
        { name: "Series 1", values: [10, 20] },
        { name: "Series 2", values: [4, 5] },
      ],
      notNumbers: 0,
    });
  });

  it("takes a first row with an empty corner as names, also when they are years", () => {
    expect(chart("\t2023\t2024\nNorth\t5\t6")).toEqual({
      labels: ["North"],
      series: [
        { name: "2023", values: [5] },
        { name: "2024", values: [6] },
      ],
      notNumbers: 0,
    });
  });

  it("names a series whose heading is empty", () => {
    expect(chart("Month,Sales,\nJan,10,4")?.series.map((s) => s.name)).toEqual(["Sales", "Series 2"]);
  });

  it("makes a cell that is empty or not a number 0 and counts it", () => {
    expect(chart("Month,Sales,Costs\nJan,n/a,4\nFeb,,five")).toEqual({
      labels: ["Jan", "Feb"],
      series: [
        { name: "Sales", values: [0, 0] },
        { name: "Costs", values: [4, 0] },
      ],
      notNumbers: 3,
    });
  });

  it("reads the numbers of one paste with one decimal mark", () => {
    // 1,5 can only be one and a half, so 1.234 is a thousand and more
    expect(chart("a;1,5\nb;1.234")?.series[0].values).toEqual([1.5, 1234]);
    expect(chart("a\t1.5\nb\t1,234")?.series[0].values).toEqual([1.5, 1234]);
    expect(chart('a,"$1,234.50"\nb,(12%)')?.series[0].values).toEqual([1234.5, -12]);
  });

  it("reads a single column as one series with numbered labels", () => {
    expect(chart("Sales\n10\n20")).toEqual({ labels: ["Item 1", "Item 2"], series: [{ name: "Sales", values: [10, 20] }], notNumbers: 0 });
    expect(chart("10\n20")).toEqual({ labels: ["Item 1", "Item 2"], series: [{ name: "Series 1", values: [10, 20] }], notNumbers: 0 });
  });

  it("puts labels and names of several lines on one line", () => {
    expect(chart('Month,"Net\nsales"\n"Jan\n2024",10')).toMatchObject({ labels: ["Jan 2024"], series: [{ name: "Net sales" }] });
  });

  it("gives nothing when there is no row under the headings or no data at all", () => {
    expect(chart("Month,Sales,Costs")).toBeNull();
    expect(chart("Sales")).toBeNull();
    expect(chart("")).toBeNull();
  });

  it("gives nothing when no cell is a number", () => {
    expect(chart("Name,City\nAnna,Pune\nBen,Goa")).toBeNull();
    expect(chart("Anna\nBen")).toBeNull();
  });

  it("stops at 100 rows and 12 series", () => {
    expect(CHART_LIMITS).toEqual({ rows: 101, cols: 13 });
    const line = (r: number) => [`r${r}`, ...Array.from({ length: 20 }, (_, i) => i)].join(",");
    const data = parseDelimited(["h," + Array.from({ length: 20 }, (_, i) => `s${i}`).join(","), ...Array.from({ length: 150 }, (_, r) => line(r))].join("\n"), CHART_LIMITS);
    const result = chartData(data)!;
    expect(result.labels).toHaveLength(100);
    expect(result.series).toHaveLength(12);
    expect(data.cut).toMatchObject({ rows: true, cols: true });
  });
});
