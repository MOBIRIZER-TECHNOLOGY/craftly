/** The report of a problem, shown exactly as it would be sent, with the three things a person can do with it. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "@/core/clipboardText";
import { clearProblems, recordProblem, reportText, type Problem } from "@/core/problems";
import { downloadBlob } from "@/export/download";
import { clearToasts } from "@/test/tabsHarness";
import { ToastHost } from "@/ui";
import { ReportPanel } from "./ReportPanel";

vi.mock("@/export/download", () => ({ downloadBlob: vi.fn() }));
vi.mock("@/core/clipboardText", () => ({ copyText: vi.fn(() => Promise.resolve(true)) }));

let problem: Problem;
const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  clearProblems();
  clearToasts();
  vi.mocked(downloadBlob).mockClear();
  vi.mocked(copyText).mockClear().mockResolvedValue(true);
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  problem = recordProblem("script", new Error("Cannot read properties of undefined (reading 'x')"), { now: 1_000 })!;
});

const view = (extra: Partial<Parameters<typeof ReportPanel>[0]> = {}) =>
  render(
    <>
      <ReportPanel problem={problem} endpoint="https://reports.example.org/in" {...extra} />
      <ToastHost />
    </>,
  );

describe("<ReportPanel>", () => {
  it("shows what a report holds, as the text that would be sent, and says that nothing goes without Send", () => {
    view();
    expect(screen.getByLabelText("What a report holds").textContent).toBe(reportText(problem));
    expect(screen.getByText(/It never holds your designs/).textContent).toMatch(/Nothing is sent unless you press Send\./);
  });

  it("offers no Send, and says that nothing is sent anywhere, when no address was set", () => {
    view({ endpoint: null });
    expect(screen.queryByRole("button", { name: /Send report/ })).toBeNull();
    expect(screen.getByText(/It never holds your designs/).textContent).toMatch(/Nothing is sent anywhere\./);
    expect(screen.getByRole("button", { name: "Copy report" })).toBeTruthy();
  });

  it("sends nothing until Send is pressed", () => {
    view();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("copies the report, and says so", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(reportText(problem)));
    expect(await screen.findByText("Report copied")).toBeTruthy();
  });

  it("says when copying did not work", async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    view();
    fireEvent.click(screen.getByRole("button", { name: "Copy report" }));
    expect(await screen.findByText("Copying did not work. Select the text and copy it yourself.")).toBeTruthy();
  });

  it("downloads the report as a file", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: "Download report" }));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe("craftly-problem-report.json");
    expect(await blob.text()).toBe(reportText(problem));
  });

  it("sends the report from the button, marks it as sent and tells the list", async () => {
    const onSent = vi.fn();
    view({ onSent });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sent" }).hasAttribute("disabled")).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://reports.example.org/in");
    expect(init.body).toBe(reportText(problem));
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Report sent. Thank you.")).toBeTruthy();
  });

  it("shows that it is sending while the answer is awaited", async () => {
    let answer!: (r: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    view();
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect((await screen.findByRole("button", { name: /Sending/ })).getAttribute("aria-busy")).toBe("true");
    answer(new Response(null, { status: 204 }));
    await screen.findByRole("button", { name: "Sent" });
  });

  it("says when it could not be sent, and lets the person try again", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    const onSent = vi.fn();
    view({ onSent });
    fireEvent.click(screen.getByRole("button", { name: "Send report" }));
    expect(await screen.findByText("The report could not be sent. You can copy it instead.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send report" }).hasAttribute("disabled")).toBe(false);
    expect(onSent).not.toHaveBeenCalled();
  });

  it("starts as sent for a problem that was sent before", () => {
    problem = { ...problem, sent: true };
    view();
    expect(screen.getByRole("button", { name: "Sent" }).hasAttribute("disabled")).toBe(true);
  });

  it("reads the address from the build when none is given", () => {
    render(<ReportPanel problem={problem} />);
    expect(screen.queryByRole("button", { name: "Send report" })).not.toBeNull(); // the development server has an address of its own
  });
});
