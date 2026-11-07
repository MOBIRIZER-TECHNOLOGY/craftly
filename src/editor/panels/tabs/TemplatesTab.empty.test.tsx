import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stubLayout } from "@/test/helpers";
import { emptyDesign, mountPanels } from "@/test/tabsHarness";

/* The catalogue is bundled, so the "still loading" state can only be reached by emptying it. */
vi.mock("@/data/templates", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/data/templates")>();
  return { ...real, TEMPLATES: [], searchTemplates: () => [] };
});

let restoreLayout: (() => void) | null = null;
afterEach(() => {
  restoreLayout?.();
  restoreLayout = null;
});

describe("the Templates tab before any template has loaded", () => {
  it("says templates are on their way and holds six placeholders in the wall", async () => {
    restoreLayout = stubLayout(400, 700);
    mountPanels({ design: emptyDesign(), tab: "templates" });
    expect(await screen.findByText("Templates are on their way")).toBeTruthy();
    expect(screen.getByText(/Ready-made layouts for this design size will appear here/)).toBeTruthy();
    const skeletons = () => document.querySelectorAll<HTMLElement>(".cf-tpl__skeletons .cf-skeleton");
    expect(skeletons()).toHaveLength(6);
    // two columns of the 400px wall, once the wall has been measured (until then they have the default width, see below)
    await waitFor(() => expect(skeletons()[0].style.width).toBe("196px"));
    expect(skeletons()).toHaveLength(6);
    // nothing to choose from, so no category chips either
    expect(screen.queryByRole("group", { name: "Template categories" })).toBeNull();
    expect(screen.queryByText("No templates found")).toBeNull();
  });

  it("draws the placeholders at a default width until the wall has been measured", async () => {
    mountPanels({ design: emptyDesign(), tab: "templates" });
    await screen.findByText("Templates are on their way");
    const first = document.querySelector<HTMLElement>(".cf-tpl__skeletons .cf-skeleton");
    expect(first?.style.width).toBe("150px");
  });
});
