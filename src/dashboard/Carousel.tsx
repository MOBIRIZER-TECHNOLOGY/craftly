import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { IconButton, IconChevronLeft, IconChevronRight, cx } from "@/ui";
import "./Carousel.css";

interface CarouselProps {
  /** accessible name of the scrolling region, e.g. "Recent designs" */
  label: string;
  children: ReactNode;
  className?: string;
}

/** A horizontal scroller with previous / next arrows that appear when there is more to see. Swipe or scroll works too. */
export function Carousel({ label, children, className }: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  const count = Children.count(children);

  const update = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setCanPrev(track.scrollLeft > 4);
    setCanNext(track.scrollLeft + track.clientWidth < track.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    update();
    track.addEventListener("scroll", update, { passive: true });
    // items change size when their pictures arrive, so watch them as well as the track
    const observer = new ResizeObserver(update);
    observer.observe(track);
    for (const child of Array.from(track.children)) observer.observe(child);
    return () => {
      track.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [count, update]);

  const scroll = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: direction * Math.max(240, Math.round(track.clientWidth * 0.82)), behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div className={cx("cf-carousel", canPrev && "can-prev", canNext && "can-next", className)}>
      <div className="cf-carousel__track" ref={trackRef} role="group" aria-label={label}>
        {children}
      </div>
      <IconButton
        className="cf-carousel__arrow cf-carousel__arrow--prev"
        label={`Previous ${label.toLowerCase()}`}
        icon={<IconChevronLeft aria-hidden="true" />}
        onClick={() => scroll(-1)}
        tabIndex={canPrev ? 0 : -1}
      />
      <IconButton
        className="cf-carousel__arrow cf-carousel__arrow--next"
        label={`Next ${label.toLowerCase()}`}
        icon={<IconChevronRight aria-hidden="true" />}
        onClick={() => scroll(1)}
        tabIndex={canNext ? 0 : -1}
      />
    </div>
  );
}
