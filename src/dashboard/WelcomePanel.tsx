import { useId, useRef } from "react";
import { CONFIGURED_SERVER, useCloud } from "@/cloud/state";
import { markFirstRunDone, useFirstRunDone } from "@/components/firstRun";
import { m } from "@/i18n";
import { navigate } from "@/router";
import { Button, IconButton, IconClose, IconCustomSize, IconFilePlus, IconLaptop, IconTemplate, IconUser, type LucideIcon } from "@/ui";
import { openCreateDialog } from "./createDialogState";
import { useDesigns } from "./data";
import { pickAnyFileAndOpen } from "./openFile";
import "./WelcomePanel.css";

interface Way {
  id: string;
  title: string;
  text: string;
  icon: LucideIcon;
  run: () => void;
}

const WAYS: Way[] = [
  { id: "blank", title: m.dashboard.welcome.blankTitle, text: m.dashboard.welcome.blankText, icon: IconCustomSize, run: () => openCreateDialog() },
  { id: "template", title: m.dashboard.welcome.templateTitle, text: m.dashboard.welcome.templateText, icon: IconTemplate, run: () => navigate("/templates") },
  { id: "file", title: m.dashboard.welcome.fileTitle, text: m.dashboard.welcome.fileText, icon: IconFilePlus, run: () => void pickAnyFileAndOpen() },
];

/**
 * Whether the welcome is for this visit: the library has been read and holds no design at all (the trash included, so a returning
 * person who emptied their projects is not greeted as new), nobody is signed in, and it was not dismissed on this device.
 */
export function useWelcomeVisible(): boolean {
  const { all, ready, error } = useDesigns();
  const signedIn = useCloud((s) => s.session !== null);
  const dismissed = useFirstRunDone("welcome");
  return ready && !error && all.length === 0 && !signedIn && !dismissed;
}

/**
 * The first-run welcome on Home: what Craftly is, the three quickest ways to start, and that the work stays on this device. It is
 * part of the page, never a dialog, so nothing waits on it; the close button puts it away for good, and it is gone by itself as
 * soon as there is a design. The place it leaves keeps the keyboard, so the next Tab goes on from here.
 */
export function WelcomePanel() {
  const visible = useWelcomeVisible();
  const headingId = useId();
  const slot = useRef<HTMLDivElement>(null);

  const dismiss = () => {
    slot.current?.focus();
    markFirstRunDone("welcome");
  };

  return (
    <div className="cf-welcome-slot" tabIndex={-1} ref={slot}>
      {visible ? (
        <section className="cf-welcome" aria-labelledby={headingId}>
          <div className="cf-welcome__head">
            <h2 id={headingId} className="cf-welcome__title">
              {m.dashboard.welcome.title}
            </h2>
            <IconButton className="cf-welcome__close" label={m.dashboard.welcome.dismiss} icon={<IconClose aria-hidden="true" />} onClick={dismiss} />
          </div>
          <p className="cf-welcome__intro">{m.dashboard.welcome.intro}</p>
          <ol className="cf-welcome__ways" aria-label={m.dashboard.welcome.ways}>
            {WAYS.map((way) => {
              const Icon = way.icon;
              return (
                <li key={way.id} className="cf-welcome__item">
                  <button type="button" className="cf-welcome__way" data-way={way.id} onClick={way.run}>
                    <span className="cf-welcome__icon" aria-hidden="true">
                      <Icon strokeWidth={2} />
                    </span>
                    <span className="cf-welcome__text">
                      <span className="cf-welcome__way-title">{way.title}</span>
                      <span className="cf-welcome__way-text">{way.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="cf-welcome__foot">
            <IconLaptop className="cf-welcome__foot-icon" aria-hidden="true" />
            <p className="cf-welcome__local">{m.dashboard.welcome.local}</p>
            {CONFIGURED_SERVER ? (
              <Button size="sm" variant="ghost" icon={<IconUser aria-hidden="true" />} onClick={() => navigate("/signin")}>
                {m.dashboard.welcome.signIn}
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
