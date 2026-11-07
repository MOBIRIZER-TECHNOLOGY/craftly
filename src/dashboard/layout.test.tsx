import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setMedia } from "@/test/media";
import { Carousel } from "./Carousel";
import { designsStore } from "./data";
import { Hero } from "./Hero";
import { Page, PageHeader, Section, SeeAll } from "./Page";
import { StorageNotice } from "./StorageNotice";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("<Page>, <PageHeader>, <Section>", () => {
  it("<Page> holds its content in a centred column with the class it is given", () => {
    const { container } = render(<Page className="extra">content</Page>);
    const column = container.firstElementChild as HTMLElement;
    expect(column.classList.contains("cf-dpage")).toBe(true);
    expect(column.classList.contains("extra")).toBe(true);
    expect(column.textContent).toBe("content");
  });

  it("<PageHeader> shows the title as the page heading, with subtitle, breadcrumb and buttons when given", () => {
    render(<PageHeader title="Projects" subtitle="All your designs" above={<nav aria-label="Breadcrumb">crumbs</nav>} actions={<button>Create</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeTruthy();
    expect(screen.getByText("All your designs")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("<PageHeader> leaves out what it was not given", () => {
    const { container } = render(<PageHeader title="Trash" />);
    expect(container.querySelector(".cf-dpage__subtitle")).toBeNull();
    expect(container.querySelector(".cf-dpage__actions")).toBeNull();
  });

  it("<Section> is a region named by its heading, with a slot for an action", () => {
    render(
      <Section title="Recent designs" action={<button>See all</button>} className="extra">
        <p>cards</p>
      </Section>,
    );
    const region = screen.getByRole("region", { name: "Recent designs" });
    expect(within(region).getByRole("heading", { level: 2, name: "Recent designs" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "See all" })).toBeTruthy();
    expect(within(region).getByText("cards")).toBeTruthy();
    expect(region.classList.contains("extra")).toBe(true);
  });
});

describe("<SeeAll>", () => {
  it("goes to a route", async () => {
    const user = userEvent.setup();
    render(<SeeAll to="/projects" />);
    await user.click(screen.getByRole("button", { name: "See all" }));
    expect(window.location.hash).toBe("#/projects");
  });

  it("runs a callback instead of going anywhere when it has one", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<SeeAll to="/projects" onClick={onClick} label="Browse" />);
    await user.click(screen.getByRole("button", { name: "Browse" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe("");
  });

  it("does nothing when it has neither", async () => {
    const user = userEvent.setup();
    render(<SeeAll />);
    await user.click(screen.getByRole("button", { name: "See all" }));
    expect(window.location.hash).toBe("");
  });
});

describe("<Hero>", () => {
  it("shows the heading, the Home and Templates pills and the search it is given", () => {
    render(
      <Hero title="What will you design today?" active="home">
        <input aria-label="Search box" />
      </Hero>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "What will you design today?" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Search box" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Templates" }).getAttribute("aria-selected")).toBe("false");
  });

  it("marks the Templates pill when that page is active, and can be compact", () => {
    const { container } = render(
      <Hero title="Templates" active="templates" compact>
        x
      </Hero>,
    );
    expect(screen.getByRole("tab", { name: "Templates" }).getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector(".cf-hero")?.classList.contains("cf-hero--compact")).toBe(true);
  });

  it("goes to the other page when its pill is pressed", async () => {
    const user = userEvent.setup();
    render(
      <Hero title="Home" active="home">
        x
      </Hero>,
    );
    await user.click(screen.getByRole("tab", { name: "Templates" }));
    expect(window.location.hash).toBe("#/templates");
    await user.click(screen.getByRole("tab", { name: "Home" }));
    expect(window.location.hash).toBe("#/");
  });
});

describe("<StorageNotice>", () => {
  it("warns that designs cannot be saved and shows the reason", () => {
    render(<StorageNotice detail="IndexedDB is not available in this browser." />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Craftly can't reach this browser's local storage.");
    expect(alert.textContent).toContain("(IndexedDB is not available in this browser.)");
  });

  it("tries to read the library again from the button", async () => {
    const user = userEvent.setup();
    const reload = vi.spyOn(designsStore, "reload").mockImplementation(() => undefined);
    render(<StorageNotice detail="blocked" />);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("<Carousel>", () => {
  /** Give the track a scroll position and size (jsdom has none). */
  function measure(track: HTMLElement, metrics: { scrollLeft: number; clientWidth: number; scrollWidth: number }) {
    for (const [name, value] of Object.entries(metrics)) Object.defineProperty(track, name, { configurable: true, writable: true, value });
  }
  const track = () => screen.getByRole("group", { name: "Recent designs" });
  const carousel = () => track().parentElement as HTMLElement;

  function Demo({ count = 5 }: { count?: number }) {
    return (
      <Carousel label="Recent designs" className="extra">
        {Array.from({ length: count }, (_unused, index) => (
          <div key={index}>card {index}</div>
        ))}
      </Carousel>
    );
  }

  it("holds its cards in a named group", () => {
    render(<Demo />);
    expect(within(track()).getAllByText(/^card /)).toHaveLength(5);
    expect(carousel().classList.contains("extra")).toBe(true);
  });

  it("shows no arrows when everything fits", () => {
    render(<Demo />);
    expect(carousel().classList.contains("can-prev")).toBe(false);
    expect(carousel().classList.contains("can-next")).toBe(false);
    expect(screen.getByRole("button", { name: "Previous recent designs" }).tabIndex).toBe(-1);
    expect(screen.getByRole("button", { name: "Next recent designs" }).tabIndex).toBe(-1);
  });

  it("shows the arrows that lead somewhere as the track is scrolled", () => {
    render(<Demo />);
    measure(track(), { scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(track());
    expect(carousel().classList.contains("can-next")).toBe(true);
    expect(carousel().classList.contains("can-prev")).toBe(false);
    expect(screen.getByRole("button", { name: "Next recent designs" }).tabIndex).toBe(0);
    measure(track(), { scrollLeft: 300, clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(track());
    expect(carousel().classList.contains("can-prev")).toBe(true);
    expect(carousel().classList.contains("can-next")).toBe(true);
    expect(screen.getByRole("button", { name: "Previous recent designs" }).tabIndex).toBe(0);
    measure(track(), { scrollLeft: 700, clientWidth: 300, scrollWidth: 1000 });
    fireEvent.scroll(track());
    expect(carousel().classList.contains("can-next")).toBe(false);
    expect(carousel().classList.contains("can-prev")).toBe(true);
  });

  it("scrolls most of a screenful with the arrows", async () => {
    const user = userEvent.setup();
    const scrollBy = vi.spyOn(HTMLElement.prototype, "scrollBy").mockImplementation(() => undefined);
    render(<Demo />);
    measure(track(), { scrollLeft: 300, clientWidth: 600, scrollWidth: 2000 });
    fireEvent.scroll(track());
    await user.click(screen.getByRole("button", { name: "Next recent designs" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: Math.round(600 * 0.82), behavior: "smooth" });
    await user.click(screen.getByRole("button", { name: "Previous recent designs" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -Math.round(600 * 0.82), behavior: "smooth" });
  });

  it("scrolls at least 240 pixels, and without animation for people who prefer less motion", async () => {
    const user = userEvent.setup();
    const scrollBy = vi.spyOn(HTMLElement.prototype, "scrollBy").mockImplementation(() => undefined);
    setMedia("(prefers-reduced-motion: reduce)", true);
    render(<Demo />);
    measure(track(), { scrollLeft: 0, clientWidth: 100, scrollWidth: 2000 });
    fireEvent.scroll(track());
    await user.click(screen.getByRole("button", { name: "Next recent designs" }));
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 240, behavior: "auto" });
  });

  it("looks again when its cards change, and stops listening when it goes away", () => {
    const remove = vi.spyOn(HTMLElement.prototype, "removeEventListener");
    const { rerender, unmount } = render(<Demo count={2} />);
    rerender(<Demo count={6} />);
    expect(within(track()).getAllByText(/^card /)).toHaveLength(6);
    unmount();
    expect(remove.mock.calls.some((call) => call[0] === "scroll")).toBe(true);
  });

  it("updates when the size of the track or of a card changes, for instance when their pictures arrive", () => {
    const observed: Element[] = [];
    const reports: Array<() => void> = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          reports.push(() => callback([], this as unknown as ResizeObserver));
        }
        observe(el: Element) {
          observed.push(el);
        }
        unobserve() {}
        disconnect() {}
      },
    );
    render(<Demo count={3} />);
    expect(observed).toHaveLength(4);
    expect(observed[0]).toBe(track());
    measure(track(), { scrollLeft: 0, clientWidth: 300, scrollWidth: 1000 });
    expect(carousel().classList.contains("can-next")).toBe(false);
    act(() => reports.forEach((report) => report()));
    expect(carousel().classList.contains("can-next")).toBe(true);
  });
});
