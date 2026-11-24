import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractSvgColors } from "@/core/svg";
import { useEditor } from "@/core/store";
import type { GraphicElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { lastElement, mountPanels, pageElements } from "@/test/tabsHarness";
import { useAppsNav } from "./appKit";

/**
 * The picture of the code is made asynchronously. Most tests use the real rasterizer; with `hold` set, each request waits
 * in `pending` until the test settles it, so a test can decide which of two requests answers first.
 */
const raster = vi.hoisted(() => ({ hold: false, pending: [] as Array<{ resolve(url: string): void; reject(error: Error): void }> }));
vi.mock("./qrLogo", async (importOriginal) => {
  const real = await importOriginal<typeof import("./qrLogo")>();
  return {
    ...real,
    rasterizeQrWithLogo: (...args: Parameters<typeof real.rasterizeQrWithLogo>) =>
      raster.hold ? new Promise<string>((resolve, reject) => raster.pending.push({ resolve, reject })) : real.rasterizeQrWithLogo(...args),
  };
});

beforeEach(() => {
  raster.hold = false;
  raster.pending.length = 0;
  resetEditor();
  useAppsNav.setState({ app: "qr", query: "" });
});

async function openQr() {
  const user = userEvent.setup();
  mountPanels({ tab: "apps" });
  await screen.findByRole("heading", { name: "QR code" });
  return user;
}

const code = () => screen.queryByRole("img", { name: /^QR code for / }) as HTMLImageElement | null;
const add = () => screen.getByRole("button", { name: "Add to design" });
const kind = (name: string) => screen.getByRole("radio", { name });
/** The text the code carries (it is the picture's description). */
const payload = () =>
  code()
    ?.getAttribute("alt")
    ?.replace(/^QR code for /, "");
const decodeSvg = (img: HTMLImageElement) => decodeURIComponent(img.getAttribute("src")!.replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));

async function pickLevel(user: ReturnType<typeof userEvent.setup>, label: RegExp) {
  await user.click(screen.getByRole("combobox", { name: "Error correction" }));
  await user.click(await screen.findByRole("option", { name: label }));
}

describe("QR code app", () => {
  it("starts with a code for a web address", async () => {
    await openQr();
    expect(screen.getByText("Scannable codes for links, text and Wi-Fi")).toBeTruthy();
    expect(payload()).toBe("https://example.com");
    expect(screen.getByRole("textbox", { name: "Web address" })).toHaveProperty("value", "https://example.com");
    expect(kind("Link").getAttribute("aria-checked")).toBe("true");
    expect(add().hasAttribute("disabled")).toBe(false);
    const svg = decodeSvg(code()!);
    expect(extractSvgColors(svg).sort()).toEqual(["#0e1318", "#ffffff"]);
  });

  it("makes a new code as the address is typed", async () => {
    const user = await openQr();
    const field = screen.getByRole("textbox", { name: "Web address" });
    await user.clear(field);
    await user.type(field, "  https://craftly.app/hello  ");
    expect(payload()).toBe("https://craftly.app/hello");
  });

  it("shows a placeholder instead of a code when there is nothing to encode", async () => {
    const user = await openQr();
    await user.clear(screen.getByRole("textbox", { name: "Web address" }));
    expect(code()).toBeNull();
    expect(screen.getByText("Your code appears here")).toBeTruthy();
    expect(add().hasAttribute("disabled")).toBe(true);
  });

  it("encodes plain text", async () => {
    const user = await openQr();
    await user.click(kind("Text"));
    expect(screen.queryByRole("textbox", { name: "Web address" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Text" })).toHaveProperty("value", "Hello from Craftly");
    expect(payload()).toBe("Hello from Craftly");
    await user.clear(screen.getByRole("textbox", { name: "Text" }));
    await user.type(screen.getByRole("textbox", { name: "Text" }), "Meet at 5");
    expect(payload()).toBe("Meet at 5");
  });

  it("describes a long text with its first 60 characters", async () => {
    const user = await openQr();
    await user.click(kind("Text"));
    const field = screen.getByRole("textbox", { name: "Text" });
    await user.clear(field);
    await user.click(field);
    await user.paste("x".repeat(80));
    expect(code()?.getAttribute("alt")).toBe(`QR code for ${"x".repeat(60)}...`);
  });

  it("encodes an email address", async () => {
    const user = await openQr();
    await user.click(kind("Email"));
    expect(code()).toBeNull();
    await user.type(screen.getByRole("textbox", { name: "Email address" }), " hello@craftly.app ");
    expect(payload()).toBe("mailto:hello@craftly.app");
  });

  describe("Wi-Fi", () => {
    async function openWifi() {
      const user = await openQr();
      await user.click(kind("Wi-Fi"));
      return user;
    }

    it("needs a network name before it makes a code", async () => {
      await openWifi();
      expect(code()).toBeNull();
      expect(add().hasAttribute("disabled")).toBe(true);
    });

    it("writes the network and password the way phones read them", async () => {
      const user = await openWifi();
      await user.type(screen.getByRole("textbox", { name: "Network name" }), "Cafe Net");
      await user.type(screen.getByRole("textbox", { name: "Password" }), "secret");
      expect(payload()).toBe("WIFI:T:WPA;S:Cafe Net;P:secret;;");
    });

    it("escapes the characters that have a meaning in the format", async () => {
      const user = await openWifi();
      await user.type(screen.getByRole("textbox", { name: "Network name" }), "My;Net");
      await user.type(screen.getByRole("textbox", { name: "Password" }), 'pa:ss,w"ord\\');
      expect(payload()).toBe('WIFI:T:WPA;S:My\\;Net;P:pa\\:ss\\,w\\"ord\\\\;;');
    });

    it("leaves the password out for an open network", async () => {
      const user = await openWifi();
      await user.type(screen.getByRole("textbox", { name: "Network name" }), "Open Net");
      await user.type(screen.getByRole("textbox", { name: "Password" }), "ignored");
      await user.click(screen.getByRole("combobox", { name: "Wi-Fi security" }));
      await user.click(await screen.findByRole("option", { name: "No password" }));
      expect(screen.queryByRole("textbox", { name: "Password" })).toBeNull();
      expect(payload()).toBe("WIFI:T:nopass;S:Open Net;P:;;");
    });

    it("can use the older WEP security", async () => {
      const user = await openWifi();
      await user.type(screen.getByRole("textbox", { name: "Network name" }), "Old Net");
      await user.click(screen.getByRole("combobox", { name: "Wi-Fi security" }));
      await user.click(await screen.findByRole("option", { name: "WEP" }));
      expect(payload()).toBe("WIFI:T:WEP;S:Old Net;P:;;");
    });
  });

  describe("when the text is too long", () => {
    async function overfill() {
      const user = await openQr();
      await user.click(kind("Text"));
      const field = screen.getByRole("textbox", { name: "Text" });
      await user.clear(field);
      await user.click(field);
      await user.paste("a".repeat(2000));
      return user;
    }

    it("explains instead of drawing a broken code", async () => {
      const user = await overfill();
      // 2000 characters fit at the medium level
      expect(code()).not.toBeNull();
      await pickLevel(user, /^High/);
      expect(code()).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain("That is too long for a QR code at this error-correction level. Shorten it or choose a lower level.");
      expect(screen.getByText("Too much data")).toBeTruthy();
      expect(add().hasAttribute("disabled")).toBe(true);
    });

    it("works again at a lower level", async () => {
      const user = await overfill();
      await pickLevel(user, /^High/);
      expect(screen.queryByRole("alert")).not.toBeNull();
      await pickLevel(user, /^Low/);
      expect(screen.queryByRole("alert")).toBeNull();
      expect(code()).not.toBeNull();
    });
  });

  describe("colours", () => {
    async function pick(user: ReturnType<typeof userEvent.setup>, field: string, hex: string) {
      await user.click(screen.getByRole("button", { name: new RegExp(`^${field}: `) }));
      const dialog = await screen.findByRole("dialog", { name: field });
      await user.click(within(dialog).getByRole("button", { name: hex }));
      await user.keyboard("{Escape}");
    }

    it("recolours the squares and the background", async () => {
      const user = await openQr();
      await pick(user, "Square colour", "#1d4ed8");
      await pick(user, "Background colour", "#be123c");
      await waitFor(() => expect(extractSvgColors(decodeSvg(code()!)).sort()).toEqual(["#1d4ed8", "#be123c"]));
    });

    it("lists the choices with the colours of the code", async () => {
      await openQr();
      expect(screen.getByRole("button", { name: "Square colour: #0e1318. Change colour" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Background colour: #ffffff. Change colour" })).toBeTruthy();
    });

    it("warns when the two colours are too close to scan", async () => {
      const user = await openQr();
      expect(document.querySelector(".cf-app__warn")).toBeNull();
      await pick(user, "Square colour", "#ffffff");
      expect(await screen.findByText("The two colours are too close: some phones will not scan this code.")).toBeTruthy();
    });

    it("warns about light squares on a dark background", async () => {
      const user = await openQr();
      await pick(user, "Background colour", "#0e1318");
      await pick(user, "Square colour", "#ffffff");
      expect(await screen.findByText(/Light-on-dark codes are not read by every scanner/)).toBeTruthy();
      expect(screen.queryByText(/too close/)).toBeNull();
    });

    it("says nothing about colours when there is no code", async () => {
      const user = await openQr();
      await pick(user, "Square colour", "#ffffff");
      await user.clear(screen.getByRole("textbox", { name: "Web address" }));
      expect(document.querySelector(".cf-app__warn")).toBeNull();
    });
  });

  describe("adding it to the design", () => {
    it("puts the code on the page as a recolourable graphic, a little over a quarter of the page", async () => {
      const user = await openQr();
      const before = pageElements().length;
      await user.click(add());
      const el = lastElement() as GraphicElement;
      expect(pageElements()).toHaveLength(before + 1);
      expect(el.type).toBe("graphic");
      expect(el.name).toBe("QR code");
      expect(el.source).toEqual({ kind: "qr" });
      expect([el.width, el.height]).toEqual([Math.round(720 * 0.28), Math.round(720 * 0.28)]);
      expect(extractSvgColors(el.svg).sort()).toEqual(["#0e1318", "#ffffff"]);
      expect(useEditor.getState().selection).toEqual([el.id]);
    });

    it("adds the code in the colours that were chosen", async () => {
      const user = await openQr();
      await user.click(screen.getByRole("button", { name: /^Square colour: / }));
      await user.click(within(await screen.findByRole("dialog", { name: "Square colour" })).getByRole("button", { name: "#0f766e" }));
      await user.keyboard("{Escape}");
      await user.click(add());
      expect(extractSvgColors((lastElement() as GraphicElement).svg)).toContain("#0f766e");
    });

    it("does nothing without a code", async () => {
      const user = await openQr();
      await user.clear(screen.getByRole("textbox", { name: "Web address" }));
      const before = pageElements().length;
      await user.click(add());
      expect(pageElements()).toHaveLength(before);
    });

    it("adds a QR with a logo as a PNG and returns to a vector when the logo is removed", async () => {
      const user = await openQr();
      await user.upload(screen.getByLabelText("Logo (optional)"), new File(["logo"], "logo.png", { type: "image/png" }));
      await waitFor(() => expect(code()?.src).toMatch(/^data:image\/png/));
      await user.click(add());
      const withLogo = lastElement();
      expect(withLogo.type).toBe("image");
      if (withLogo.type !== "image") throw new Error("QR with a logo should be an image");
      expect(withLogo.src).toMatch(/^data:image\/png/);

      await user.click(screen.getByRole("button", { name: "Remove logo" }));
      await waitFor(() => expect(code()?.src).toMatch(/^data:image\/svg\+xml/));
      await user.click(add());
      expect(lastElement().type).toBe("graphic");
    });

    it("rejects a file that is not a picture and keeps the vector QR usable", async () => {
      const user = await openQr();
      fireEvent.change(screen.getByLabelText("Logo (optional)"), { target: { files: [new File(["notes"], "notes.txt", { type: "text/plain" })] } });
      expect((await screen.findByRole("alert")).textContent).toContain("That picture could not be read as a logo.");
      await user.click(add());
      expect(lastElement().type).toBe("graphic");
    });
  });

  it("lists the four error correction levels", async () => {
    const user = await openQr();
    const select = screen.getByRole("combobox", { name: "Error correction" });
    expect(select.textContent).toBe("Medium - 15%");
    await user.click(select);
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Low - 7% can be damaged", "Medium - 15%", "Quartile - 25%", "High - 30%"]);
  });
});

describe("making the picture of the code", () => {
  const field = () => screen.getByRole("textbox", { name: "Web address" });
  const settle = (index: number, outcome: string | Error) =>
    act(async () => {
      const request = raster.pending[index];
      if (outcome instanceof Error) request.reject(outcome);
      else request.resolve(outcome);
    });

  it("shows the picture for what was typed last, even when the picture for an older address arrives later", async () => {
    raster.hold = true;
    await openQr();
    expect(raster.pending).toHaveLength(1);
    fireEvent.change(field(), { target: { value: "https://example.com/newer" } });
    expect(raster.pending).toHaveLength(2);
    await settle(1, "data:image/png;base64,newer");
    await settle(0, "data:image/png;base64,older");
    expect(code()?.getAttribute("src")).toBe("data:image/png;base64,newer");
    expect(add().hasAttribute("disabled")).toBe(false);
  });

  it("keeps the newer picture when the request for an older address fails afterwards", async () => {
    raster.hold = true;
    await openQr();
    fireEvent.change(field(), { target: { value: "https://example.com/newer" } });
    await settle(1, "data:image/png;base64,newer");
    await settle(0, new Error("could not draw"));
    expect(code()?.getAttribute("src")).toBe("data:image/png;base64,newer");
  });

  it("offers nothing to add when the picture of the current code cannot be made", async () => {
    raster.hold = true;
    await openQr();
    await settle(0, new Error("could not draw"));
    expect(code()?.getAttribute("src")).toBeNull();
    expect(add().hasAttribute("disabled")).toBe(true);
    const before = pageElements().length;
    fireEvent.click(add());
    expect(pageElements()).toHaveLength(before);
  });

  it("ignores a file chooser that was closed without picking a file", async () => {
    const user = await openQr();
    fireEvent.change(screen.getByLabelText("Logo (optional)"), { target: { files: [] } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove logo" })).toBeNull();
    await user.click(add());
    expect(lastElement().type).toBe("graphic");
  });
});
