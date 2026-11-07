import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { hitTestElement, toLocalPoint } from "@/core/geometry";
import { useEditor } from "@/core/store";
import type { DesignElement, Point } from "@/core/types";
import {
  IconButton,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconExitFullscreen,
  IconFullscreen,
  IconNotes,
  IconPause,
  IconPlay,
  cx,
  useLatest,
  useMedia,
  useResizeObserver,
} from "@/ui";
import { PresentPlayer } from "./PresentPlayer";
import "./present.css";

const IDLE_MS = 2000;
/** StrictMode mounts effects twice in development; a second request inside the same gesture would only log a warning. */
let lastFullscreenRequest = 0;
const SWIPE_PX = 56;

/** The hyperlink of the topmost element at `p` (or of its group), `undefined` when that element has none, `null` when nothing is hit. */
function linkAt(elements: DesignElement[], p: Point, inherited?: string): string | undefined | null {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (el.hidden || !hitTestElement(el, p)) continue;
    const link = el.link || inherited;
    if (el.type === "group") {
      const inner = linkAt(el.children, toLocalPoint(el, p), link);
      return inner === null ? link : inner;
    }
    return link;
  }
  return null;
}

/** Only web and mail links are followed; anything else (javascript:, data: ...) is ignored. */
function safeUrl(link: string): string | null {
  const text = link.trim();
  if (!text) return null;
  if (/^(https?:|mailto:)/i.test(text)) return text;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return null;
  return `https://${text}`;
}

/**
 * Full-screen presenter: one page at a time, fitted to the screen on a dark background.
 * Right / Space / PageDown / click = next, Left / PageUp = previous, Home / End, P = auto-play, N = notes, F = full screen, Esc = exit.
 *
 * Animations, transitions and auto-play are played by a `PresentPlayer` that owns the canvas; this component keeps
 * the page number, the controls and the keyboard, and mirrors what the player reports.
 */
export function PresentMode() {
  const design = useEditor((s) => s.design);
  const docVersion = useEditor((s) => s.docVersion);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const playerRef = useRef<PresentPlayer | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const idleTimer = useRef(0);

  const count = design?.pages.length ?? 0;
  const [index, setIndex] = useState(() => {
    const s = useEditor.getState();
    return Math.max(0, s.design?.pages.findIndex((p) => p.id === s.activePageId) ?? 0);
  });
  const [notesOn, setNotesOn] = useState(false);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [overLink, setOverLink] = useState(false);
  const [autoplay, setAutoplay] = useState(false);
  /** the page whose rendering threw (a damaged element must not leave the show blank without a word) */
  const [failedId, setFailedId] = useState<string | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const reduceMotion = useMedia("(prefers-reduced-motion: reduce)");

  // read while rendering: once the editor behind the presenter turns inert the browser has already dropped the focus
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null,
  );

  const current = Math.min(index, Math.max(0, count - 1));
  const page = design?.pages[current];
  const indexRef = useLatest(current);
  const countRef = useLatest(count);

  useResizeObserver(stageRef, (entry) => setStage({ w: Math.floor(entry.contentRect.width), h: Math.floor(entry.contentRect.height) }));

  // every move goes through the player: it completes a running transition, turns auto-play off and picks the transition to play
  const go = useCallback(
    (to: number) => {
      const player = playerRef.current;
      if (player) player.goTo(to);
      else setIndex(Math.max(0, Math.min(countRef.current - 1, to)));
    },
    [countRef],
  );
  // relative to the page the player is on, which can be a frame ahead of this component's state while auto-play runs
  const next = useCallback(() => {
    const player = playerRef.current;
    if (player) player.step(1);
    else go(indexRef.current + 1);
  }, [go, indexRef]);
  const prev = useCallback(() => {
    const player = playerRef.current;
    if (player) player.step(-1);
    else go(indexRef.current - 1);
  }, [go, indexRef]);
  const toggleAutoplay = useCallback(() => playerRef.current?.toggleAutoplay(), []);

  const exit = useCallback(() => {
    const s = useEditor.getState();
    const id = s.design?.pages[indexRef.current]?.id;
    // the editor continues on the page the show ended on
    if (id) s.actions.setActivePage(id);
    s.actions.setPresenting(false);
  }, [indexRef]);
  const exitRef = useLatest(exit);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void Promise.resolve(root.requestFullscreen?.()).catch(() => undefined);
  }, []);

  /* ---- enter full screen; leaving it (Esc is swallowed by the browser) ends the show ---- */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement === root) {
        entered = true;
        setFullscreen(true);
      } else {
        setFullscreen(false);
        if (entered) exitRef.current();
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    try {
      if (Date.now() - lastFullscreenRequest > 400) {
        lastFullscreenRequest = Date.now();
        void Promise.resolve(root.requestFullscreen?.()).catch(() => undefined);
      }
    } catch {
      /* denied: the overlay still covers the whole window */
    }
    root.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => undefined);
      // keyboard users end the show where they started it
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [exitRef, opener]);

  /* ---- controls fade after a moment without input ---- */
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
  }, [wake]);

  /* ---- keyboard ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Enter / Space belong to a focused button (exit, arrows ...)
      const onButton = e.target instanceof Element && !!e.target.closest("button");
      let handled = true;
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
          next();
          break;
        case " ":
        case "Enter":
          if (onButton) handled = false;
          else next();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
          prev();
          break;
        case "Home":
          go(0);
          break;
        case "End":
          go(countRef.current - 1);
          break;
        case "Escape":
          exitRef.current();
          break;
        case "p":
        case "P":
          toggleAutoplay();
          break;
        case "n":
        case "N":
          setNotesOn((v) => !v);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
      wake();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [next, prev, go, countRef, exitRef, toggleFullscreen, toggleAutoplay, wake]);

  /* ---- the player paints the page, plays its animations and transitions, runs auto-play ---- */
  const ready = !!design && !!page;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!ready || !canvas) return;
    const player = new PresentPlayer(
      {
        canvas,
        onIndex: setIndex,
        onAutoplay: setAutoplay,
        onFailed: setFailedId,
        // straight onto the DOM: a state update per frame would re-render the whole presenter 60 times a second
        onProgress: (fraction) => {
          if (progressRef.current) progressRef.current.style.transform = `scaleX(${fraction})`;
        },
      },
      indexRef.current,
    );
    playerRef.current = player;
    return () => {
      player.dispose();
      if (playerRef.current === player) playerRef.current = null;
      setAutoplay(false);
    };
  }, [ready, indexRef]);

  useEffect(() => {
    playerRef.current?.configure({ design: design ?? null, docVersion, stageW: stage.w, stageH: stage.h, reducedMotion: reduceMotion });
  }, [ready, design, docVersion, stage.w, stage.h, reduceMotion]);

  /* ---- pointer: click = next (or follow a link), swipe = previous / next ---- */
  const linkFromEvent = (e: { clientX: number; clientY: number }): string | undefined | null => {
    const canvas = canvasRef.current;
    if (!canvas || !design || !page) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const p = { x: ((e.clientX - r.left) / r.width) * design.width, y: ((e.clientY - r.top) / r.height) * design.height };
    if (p.x < 0 || p.y < 0 || p.x > design.width || p.y > design.height) return null;
    return linkAt(page.elements, p);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    wake();
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    wake();
    const link = linkFromEvent(e);
    const hasLink = !!(link && safeUrl(link));
    if (hasLink !== overLink) setOverLink(hasLink);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0) next();
      else prev();
      // the click that follows a swipe must not advance a second time
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 80);
    }
  };
  const onStageClick = (e: ReactMouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const link = linkFromEvent(e);
    const url = link ? safeUrl(link) : null;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    next();
  };

  if (!design || !page) return null;

  return (
    <div
      ref={rootRef}
      className={cx("cf-present", idle && "is-idle", overLink && "is-link")}
      role="dialog"
      aria-modal="true"
      aria-label="Presentation"
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a click on the stage turns the page; the keys of the presenter (Right, Space ...) do it for the keyboard */}
      <div ref={stageRef} className="cf-present__stage" onClick={onStageClick}>
        <canvas ref={canvasRef} className="cf-present__page" aria-label={`Page ${current + 1} of ${count}`} role="img" hidden={failedId === page.id} />
        {failedId === page.id ? (
          <p className="cf-present__error" role="alert">
            This page couldn't be drawn. Use the arrows to carry on, or press Esc to go back and fix it.
          </p>
        ) : null}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- keeps a click on the controls from turning the page */}
        <div className={cx("cf-present__controls", idle && "is-idle")} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <IconButton label="Previous page" shortcut="Left" icon={<IconChevronLeft aria-hidden="true" />} disabled={current === 0} onClick={prev} />
          <span className="cf-present__count" aria-hidden="true">
            {current + 1} / {count}
          </span>
          <IconButton label="Next page" shortcut="Right" icon={<IconChevronRight aria-hidden="true" />} disabled={current >= count - 1} onClick={next} />
          <span className="cf-present__sep" aria-hidden="true" />
          <IconButton
            label="Auto-play"
            shortcut="P"
            icon={autoplay ? <IconPause aria-hidden="true" /> : <IconPlay aria-hidden="true" />}
            active={autoplay}
            onClick={toggleAutoplay}
          />
          <IconButton label={notesOn ? "Hide notes" : "Show notes"} shortcut="N" icon={<IconNotes aria-hidden="true" />} active={notesOn} onClick={() => setNotesOn((v) => !v)} />
          <IconButton
            label={fullscreen ? "Exit full screen" : "Enter full screen"}
            shortcut="F"
            icon={fullscreen ? <IconExitFullscreen aria-hidden="true" /> : <IconFullscreen aria-hidden="true" />}
            onClick={toggleFullscreen}
          />
          <IconButton label="Exit presentation" shortcut="Esc" icon={<IconClose aria-hidden="true" />} onClick={exit} />
        </div>
      </div>

      {notesOn ? (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the notes scroll, so the keyboard has to reach them
        <aside className="cf-present__notes" aria-label="Speaker notes" tabIndex={0}>
          <h2 className="cf-present__notes-title">Notes - page {current + 1}</h2>
          <p className={cx("cf-present__notes-text", !page.notes?.trim() && "is-empty")}>{page.notes?.trim() ? page.notes : "No notes for this page."}</p>
        </aside>
      ) : null}

      {autoplay ? (
        <div className="cf-present__progress" aria-hidden="true">
          <span ref={progressRef} className="cf-present__progress-bar" />
        </div>
      ) : null}

      <div className="cf-sr-only" aria-live="polite">{`Page ${current + 1} of ${count}`}</div>
    </div>
  );
}
