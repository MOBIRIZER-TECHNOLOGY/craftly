import { useEffect, useState } from "react";
import { Button, IconPause, IconPlay, IconRefresh, IconTimer, Popover, cx } from "@/ui";
import { formatClock } from "./clock";

/** A stopwatch for rehearsing: the state lives here so it keeps counting while the popover is closed. */
export function TimerButton() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [banked, setBanked] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [, setTick] = useState(0);

  const running = startedAt !== null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed = banked + (startedAt === null ? 0 : Date.now() - startedAt);
  const showTime = running || elapsed > 0;

  const start = () => setStartedAt(Date.now());
  const pause = () => {
    setBanked(elapsed);
    setStartedAt(null);
  };
  const reset = () => {
    setBanked(0);
    setStartedAt(null);
  };

  return (
    <>
      <Button
        ref={setAnchor}
        variant="ghost"
        className={cx("cf-bottombar__btn cf-bottombar__timer", running && "is-running")}
        icon={<IconTimer aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={showTime ? `Timer, ${formatClock(elapsed)}` : "Timer"}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cx("cf-bottombar__lbl", showTime && "cf-bottombar__lbl--keep")}>{showTime ? formatClock(elapsed) : "Timer"}</span>
      </Button>
      <Popover open={open} anchor={anchor} onClose={() => setOpen(false)} placement="top-start" offset={8} className="cf-timerpop" aria-label="Timer">
        <div className="cf-timerpop__body">
          <div className="cf-timerpop__time" role="timer" aria-live="off">
            {formatClock(elapsed)}
          </div>
          <div className="cf-timerpop__actions">
            <Button variant="primary" icon={running ? <IconPause aria-hidden="true" /> : <IconPlay aria-hidden="true" />} onClick={running ? pause : start}>
              {running ? "Pause" : elapsed > 0 ? "Resume" : "Start"}
            </Button>
            <Button variant="secondary" icon={<IconRefresh aria-hidden="true" />} disabled={elapsed === 0 && !running} onClick={reset}>
              Reset
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}
