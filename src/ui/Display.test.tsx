import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { contrastRatio, hslToHex } from "@/core/color";
import { Avatar, avatarColour } from "./Avatar";
import { Badge } from "./Badge";
import { BrandMark, RotateHandleIcon } from "./BrandMark";
import { Divider } from "./Divider";
import { EmptyState } from "./EmptyState";
import { Kbd } from "./Kbd";
import { Skeleton } from "./Skeleton";
import { Spinner } from "./Spinner";

describe("<Badge>", () => {
  it("shows its content as a neutral soft pill by default", () => {
    render(<Badge>New</Badge>);
    const badge = screen.getByText("New");
    expect(badge.classList.contains("cf-badge--neutral")).toBe(true);
    expect(badge.classList.contains("cf-badge--soft")).toBe(true);
  });

  it("takes its tone, variant and class from the props", () => {
    render(
      <Badge tone="danger" variant="solid" className="extra">
        3
      </Badge>,
    );
    const badge = screen.getByText("3");
    expect(badge.classList.contains("cf-badge--danger")).toBe(true);
    expect(badge.classList.contains("cf-badge--solid")).toBe(true);
    expect(badge.classList.contains("extra")).toBe(true);
  });
});

describe("<Avatar>", () => {
  it("shows the first and last initial of a full name, named after the person", () => {
    render(<Avatar name="ada king lovelace" />);
    const avatar = screen.getByRole("img", { name: "ada king lovelace" });
    expect(avatar.textContent).toBe("AL");
    expect(avatar.getAttribute("title")).toBe("ada king lovelace");
  });

  it("shows one initial for a single name and a question mark for no name", () => {
    const { rerender } = render(<Avatar name="Plato" />);
    expect(screen.getByRole("img").textContent).toBe("P");
    rerender(<Avatar name="   " />);
    expect(screen.getByRole("img").textContent).toBe("?");
  });

  it("keeps whole characters when the name starts with an emoji", () => {
    render(<Avatar name="😀 Smile" />);
    expect(screen.getByRole("img").textContent).toBe("😀S");
  });

  it("gives the same name the same colour and different names different ones", () => {
    const { rerender } = render(<Avatar name="Ada Lovelace" />);
    const first = screen.getByRole("img").style.background;
    rerender(<Avatar name="Ada Lovelace" />);
    expect(screen.getByRole("img").style.background).toBe(first);
    rerender(<Avatar name="Grace Hopper" />);
    expect(screen.getByRole("img").style.background).not.toBe(first);
  });

  it("uses the colour it is given", () => {
    render(<Avatar name="Ada" color="rgb(10, 20, 30)" />);
    expect(screen.getByRole("img").style.background).toBe("rgb(10, 20, 30)");
  });

  describe("the default colour", () => {
    const NAMES = ["You", "Ada Lovelace", "Grace Hopper", "Linus T", "Zoe", ...Array.from({ length: 720 }, (_, i) => `Person ${i * 37}`)];
    const parsed = (name: string) => {
      const [, hue, lightness] = avatarColour(name)
        .match(/^hsl\((\d+) 58% (\d+)%\)$/)!
        .map(Number);
      return { hue, lightness };
    };

    it("keeps the white initials at 4.5:1 on the colour of any name", () => {
      const hues = new Set<number>();
      for (const name of NAMES) {
        const { hue, lightness } = parsed(name);
        hues.add(hue);
        expect(contrastRatio("#ffffff", hslToHex(hue, 58, lightness)), name).toBeGreaterThanOrEqual(4.5);
      }
      // the sample covers the colour wheel, greens and teals included
      expect(hues.size).toBeGreaterThan(200);
      expect([...hues].some((hue) => hue > 60 && hue < 200)).toBe(true);
    });

    it("stays as light as it always was (42 %) wherever that is readable, and is never darker than needed", () => {
      let darker = 0;
      for (const name of NAMES) {
        const { hue, lightness } = parsed(name);
        if (contrastRatio("#ffffff", hslToHex(hue, 58, 42)) >= 4.5) expect(lightness, name).toBe(42);
        else {
          darker += 1;
          expect(contrastRatio("#ffffff", hslToHex(hue, 58, lightness + 1)), name).toBeLessThan(4.5);
        }
      }
      expect(darker).toBeGreaterThan(0);
    });

    it("is a deep green for the person called You, who is the one the dashboard shows", () => {
      expect(avatarColour("You")).toBe("hsl(167 58% 33%)");
      expect(hslToHex(167, 58, 33)).toBe("#238570");
    });

    it("is what the avatar paints when no colour is given", () => {
      const { rerender } = render(<Avatar name="You" />);
      const painted = screen.getByRole("img").style.background;
      rerender(<Avatar name="You" color={avatarColour("You")} />);
      expect(screen.getByRole("img").style.background).toBe(painted);
    });
  });

  it("scales its size and text, with a minimum text size", () => {
    const { rerender } = render(<Avatar name="Ada" size={50} />);
    expect(screen.getByRole("img").style.width).toBe("50px");
    expect(screen.getByRole("img").style.height).toBe("50px");
    expect(screen.getByRole("img").style.fontSize).toBe("20px");
    rerender(<Avatar name="Ada" size={16} />);
    expect(screen.getByRole("img").style.fontSize).toBe("10px");
    rerender(<Avatar name="Ada" />);
    expect(screen.getByRole("img").style.width).toBe("32px");
  });

  it("shows a picture instead of initials when it has a source", () => {
    render(<Avatar name="Ada" src="https://example.test/ada.png" className="extra" />);
    const avatar = screen.getByRole("img", { name: "Ada" });
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe("https://example.test/ada.png");
    expect(avatar.querySelector("img")?.getAttribute("alt")).toBe("");
    expect(avatar.textContent).toBe("");
    expect(avatar.classList.contains("extra")).toBe(true);
  });
});

describe("<Divider>", () => {
  it("is a horizontal separator by default and a vertical one on request", () => {
    const { rerender } = render(<Divider />);
    expect(screen.getByRole("separator").getAttribute("aria-orientation")).toBe("horizontal");
    rerender(<Divider vertical className="extra" />);
    const rule = screen.getByRole("separator");
    expect(rule.getAttribute("aria-orientation")).toBe("vertical");
    expect(rule.classList.contains("cf-divider--vertical")).toBe(true);
    expect(rule.classList.contains("extra")).toBe(true);
  });
});

describe("<EmptyState>", () => {
  it("shows the title, the text and the call to action", () => {
    render(<EmptyState icon={<svg data-testid="icon" />} title="Nothing here" text="Create something first." action={<button>Create</button>} className="extra" />);
    expect(screen.getByRole("heading", { level: 3, name: "Nothing here" })).toBeTruthy();
    expect(screen.getByText("Create something first.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
    expect(screen.getByTestId("icon").closest(".cf-empty__icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("heading").closest(".cf-empty")?.classList.contains("extra")).toBe(true);
  });

  it("takes the heading level that fits where it sits: an h3 unless told otherwise", () => {
    const { rerender } = render(<EmptyState icon={<svg />} title="Empty" />);
    expect(screen.getByRole("heading", { level: 3, name: "Empty" })).toBeTruthy();
    rerender(<EmptyState icon={<svg />} title="Empty" headingLevel={2} />);
    expect(screen.getByRole("heading", { level: 2, name: "Empty" })).toBeTruthy();
    rerender(<EmptyState icon={<svg />} title="Empty" headingLevel={4} />);
    expect(screen.getByRole("heading", { level: 4, name: "Empty" })).toBeTruthy();
  });

  it("leaves out the text and the action when there are none", () => {
    const { container } = render(<EmptyState icon={<svg />} title="Empty" />);
    expect(container.querySelector(".cf-empty__text")).toBeNull();
    expect(container.querySelector(".cf-empty__action")).toBeNull();
  });
});

describe("<Spinner>", () => {
  it("is announced as a status when it has a label", () => {
    render(<Spinner label="Loading designs" size={40} />);
    const spinner = screen.getByRole("status", { name: "Loading designs" });
    expect(spinner.style.width).toBe("40px");
    expect(spinner.getAttribute("aria-hidden")).toBeNull();
  });

  it("is decorative without a label", () => {
    const { container } = render(<Spinner className="extra" />);
    const spinner = container.querySelector(".cf-spinner") as HTMLElement;
    expect(screen.queryByRole("status")).toBeNull();
    expect(spinner.getAttribute("aria-hidden")).toBe("true");
    expect(spinner.style.width).toBe("18px");
    expect(spinner.classList.contains("extra")).toBe(true);
  });
});

describe("<Kbd>", () => {
  it("shows one key cap per key of a shortcut", () => {
    const { container } = render(<Kbd keys="Ctrl+Shift+Z" />);
    expect(Array.from(container.querySelectorAll("kbd")).map((el) => el.textContent)).toEqual(["Ctrl", "Shift", "Z"]);
  });

  it("shows free content as a single key cap", () => {
    const { container } = render(<Kbd className="extra">Esc</Kbd>);
    const caps = container.querySelectorAll("kbd");
    expect(caps).toHaveLength(1);
    expect(caps[0].textContent).toBe("Esc");
    expect(caps[0].classList.contains("extra")).toBe(true);
  });
});

describe("<Skeleton>", () => {
  it("is a hidden full-width block by default", () => {
    const { container } = render(<Skeleton />);
    const block = container.querySelector(".cf-skeleton") as HTMLElement;
    expect(block.getAttribute("aria-hidden")).toBe("true");
    expect(block.style.width).toBe("100%");
    expect(block.style.height).toBe("16px");
    expect(block.style.borderRadius).toBe("8px");
  });

  it("takes its size and radius from the props and merges extra style", () => {
    const { container } = render(<Skeleton width={120} height="2rem" radius={4} className="extra" style={{ opacity: 0.5 }} />);
    const block = container.querySelector(".cf-skeleton") as HTMLElement;
    expect(block.style.width).toBe("120px");
    expect(block.style.height).toBe("2rem");
    expect(block.style.borderRadius).toBe("4px");
    expect(block.style.opacity).toBe("0.5");
    expect(block.classList.contains("extra")).toBe(true);
  });

  it("is a circle that uses the width for both sides", () => {
    const { container } = render(<Skeleton circle width={40} height={10} />);
    const block = container.querySelector(".cf-skeleton") as HTMLElement;
    expect(block.style.height).toBe("40px");
    expect(block.style.borderRadius).toBe("50%");
  });
});

describe("<BrandMark>", () => {
  it("is decorative without a title", () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("width")).toBe("32");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("is an image with a name when given a title, and takes a size", () => {
    render(<BrandMark title="Craftly" size={64} />);
    const mark = screen.getByRole("img", { name: "Craftly" });
    expect(mark.getAttribute("width")).toBe("64");
    expect(mark.getAttribute("aria-hidden")).toBeNull();
  });

  it("fills the gradient tile in the colour variant, with an id of its own for each mark", () => {
    const { container } = render(
      <>
        <BrandMark />
        <BrandMark />
      </>,
    );
    const gradients = Array.from(container.querySelectorAll("linearGradient"));
    expect(gradients).toHaveLength(2);
    expect(gradients[0].id).not.toBe(gradients[1].id);
    const tile = container.querySelector("rect") as SVGRectElement;
    expect(tile.getAttribute("fill")).toBe(`url(#${gradients[0].id})`);
  });

  it("is a translucent white tile in the light variant, with no gradient", () => {
    const { container } = render(<BrandMark variant="light" style={{ opacity: 0.9 }} />);
    expect(container.querySelector("linearGradient")).toBeNull();
    expect(container.querySelector("rect")?.getAttribute("fill")).toBe("rgba(255,255,255,.22)");
    expect((container.querySelector("svg") as SVGElement).style.opacity).toBe("0.9");
  });
});

describe("<RotateHandleIcon>", () => {
  it("is a decorative glyph of the requested size", () => {
    const { container } = render(<RotateHandleIcon size={20} className="extra" />);
    const svg = container.querySelector("svg") as SVGElement;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("class")).toBe("extra");
  });

  it("is 16 px by default", () => {
    const { container } = render(<RotateHandleIcon />);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe("16");
  });
});
