import { describe, expect, it } from "vitest";
import { deviceName } from "./account";

/**
 * The name a device gets in a person's list of devices and in "(edited on …)": the browser and the system, read from the user
 * agent. Edge and Chrome both say "Chrome/" and Chrome and Safari both say "Safari/", so the order of the checks is what tells
 * them apart.
 */
describe("deviceName", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0", "Edge on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36", "Chrome on Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Safari on macOS"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0", "Firefox on Linux"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iOS"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on iOS"],
  ])("calls %s “%s”", (agent, name) => {
    expect(deviceName(agent)).toBe(name);
  });

  it("names only the browser when the system is not one it knows, and says Browser when it knows neither", () => {
    expect(deviceName("Mozilla/5.0 (X11; FreeBSD amd64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox");
    expect(deviceName("curl/8.9.1")).toBe("Browser");
    expect(deviceName("")).toBe("Browser");
  });

  it("reads the user agent of the browser it runs in when none is given", () => {
    expect(deviceName()).toBe(deviceName(navigator.userAgent));
  });
});
