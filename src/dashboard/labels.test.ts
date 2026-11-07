import { describe, expect, it } from "vitest";
import { fullTypeName, shortName, shortTypeName } from "./labels";

describe("shortName", () => {
  it("drops a trailing parenthesis", () => {
    expect(shortName("Presentation (16:9)")).toBe("Presentation");
    expect(shortName("Poster (18 × 24 in)")).toBe("Poster");
    expect(shortName("Document (A4, Portrait)  ")).toBe("Document");
  });

  it("leaves a name without one alone", () => {
    expect(shortName("Business Card")).toBe("Business Card");
  });

  it("keeps the whole name when nothing else would be left", () => {
    expect(shortName("(16:9)")).toBe("(16:9)");
  });
});

describe("shortTypeName", () => {
  it("is the friendly catalogue name of a design type", () => {
    expect(shortTypeName("instagram-post")).toBe("Instagram Post");
    expect(shortTypeName("presentation")).toBe("Presentation");
    expect(shortTypeName("business-card")).toBe("Business Card");
  });

  it("calls everything else a custom size", () => {
    expect(shortTypeName("custom")).toBe("Custom size");
    expect(shortTypeName("no-such-type")).toBe("Custom size");
  });
});

describe("fullTypeName", () => {
  it("is the full catalogue name", () => {
    expect(fullTypeName("instagram-post")).toBe("Instagram Post (4:5)");
    expect(fullTypeName("presentation")).toBe("Presentation (16:9)");
  });

  it("calls everything else a custom size", () => {
    expect(fullTypeName("custom")).toBe("Custom size");
    expect(fullTypeName("")).toBe("Custom size");
  });
});
