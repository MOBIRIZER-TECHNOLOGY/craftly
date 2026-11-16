import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { languageMenuEntry } from "@/components/languageMenu";
import { m } from "@/i18n";
import { openProblemsDialog } from "@/components/problemsDialogState";
import {
  Avatar,
  BrandMark,
  Button,
  IconArchive,
  IconBrand,
  IconButton,
  IconChevronDown,
  IconFolder,
  IconHome,
  IconBug,
  IconInfo,
  IconPanelClose,
  IconPanelOpen,
  IconPlus,
  IconTemplate,
  IconTrash,
  IconUpload,
  MenuPopover,
  cx,
  toast,
  type MenuEntry,
} from "@/ui";
import { designPath, navigate, type Route } from "@/router";
import { importProjectFile } from "@/export/projectFile";
import { ProjectFileError, type ImportReport } from "@/export/projectFormat";
import { AboutDialog } from "./AboutDialog";
import { closeBackupDialog, useBackupDialogRequest } from "./backupReminderState";
import { openCreateDialog } from "./createDialogState";
import { pickFiles } from "./files";
import "./Shell.css";

// the backup code (the ZIP writer and reader, the library reader) is only loaded when someone opens the dialog
const BackupDialog = lazy(() => import("./BackupDialog").then((mod) => ({ default: mod.BackupDialog })));

type NavId = "home" | "projects" | "templates" | "brand" | "trash";

interface NavEntry {
  id: NavId;
  label: string;
  href: string;
  icon: ReactNode;
}

const NAV: NavEntry[] = [
  { id: "home", label: m.dashboard.shell.nav.home, href: "#/", icon: <IconHome aria-hidden="true" /> },
  { id: "projects", label: m.dashboard.shell.nav.projects, href: "#/projects", icon: <IconFolder aria-hidden="true" /> },
  { id: "templates", label: m.dashboard.shell.nav.templates, href: "#/templates", icon: <IconTemplate aria-hidden="true" /> },
  { id: "brand", label: m.dashboard.shell.nav.brand, href: "#/brand", icon: <IconBrand aria-hidden="true" /> },
  { id: "trash", label: m.dashboard.shell.nav.trash, href: "#/trash", icon: <IconTrash aria-hidden="true" /> },
];

const TAB_BAR_LEFT: NavId[] = ["home", "projects"];
const TAB_BAR_RIGHT: NavId[] = ["templates", "brand"];
const byId = (id: NavId) => NAV.find((entry) => entry.id === id) as NavEntry;

const RAIL_KEY = "craftly:rail-expanded";

function readRailPreference(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

/** The page the route belongs to (unknown routes show Home). */
export function activeNav(route: Route): NavId {
  return NAV.some((entry) => entry.id === route.name) ? (route.name as NavId) : "home";
}

/* ------------------------------------------------------------------ */
/* Account menu                                                       */
/* ------------------------------------------------------------------ */

/** Import a .craftly file chosen by the user and open the design it contains. */
function importProject(): void {
  void pickFiles({ accept: ".craftly,.json,application/json" }).then(async ([file]) => {
    if (!file) return;
    try {
      const report: ImportReport = { skipped: 0 };
      const design = await importProjectFile(file, report);
      // what could not be read, and what was taken out, is said: nothing is left out without a word
      const notes: string[] = [];
      if (report.skipped) notes.push(m.dashboard.imported.skipped(report.skipped));
      if (report.remote) notes.push(m.dashboard.imported.remote(report.remote));
      if (report.comments) notes.push(m.dashboard.imported.comments(report.comments));
      if (notes.length) toast.info(m.dashboard.imported.withNotes(design.title, notes.join(" ")));
      else toast.success(m.dashboard.imported.done(design.title));
      navigate(designPath(design.id));
    } catch (error) {
      // a project file's own problems come with words for a person; anything else is the browser failing to store the design,
      // and its own text ("Failed to execute 'put' on 'IDBObjectStore'...") is no use to them
      const detail = error instanceof ProjectFileError ? error.message : m.dashboard.importFailed.notStored;
      toast.error(m.dashboard.importFailed.toast(detail));
    }
  });
}

function useAccountMenu(includeTrash: boolean) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupLoaded, setBackupLoaded] = useState(false);

  const items: MenuEntry[] = [
    { type: "label", label: m.dashboard.account.onThisDevice },
    { id: "import", label: m.dashboard.account.importProject, icon: <IconUpload aria-hidden="true" />, onSelect: importProject },
    {
      id: "backup",
      label: m.dashboard.account.backup,
      icon: <IconArchive aria-hidden="true" />,
      onSelect: () => {
        setBackupLoaded(true);
        setBackupOpen(true);
      },
    },
    ...(includeTrash ? [{ id: "trash", label: m.dashboard.account.trash, icon: <IconTrash aria-hidden="true" />, onSelect: () => navigate("/trash") }] : []),
    { id: "problems", label: m.dashboard.account.reportProblem, icon: <IconBug aria-hidden="true" />, onSelect: () => openProblemsDialog() },
    { id: "about", label: m.dashboard.account.about, icon: <IconInfo aria-hidden="true" />, onSelect: () => setAboutOpen(true) },
    { type: "divider" },
    languageMenuEntry(),
  ];

  const popover = (
    <>
      <MenuPopover open={anchor !== null} anchor={anchor} onClose={() => setAnchor(null)} items={items} placement="top-start" aria-label={m.dashboard.account.menuLabel} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {backupLoaded ? (
        <Suspense fallback={null}>
          <BackupDialog open={backupOpen} onClose={() => setBackupOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
  return { anchor, setAnchor, popover };
}

/* ------------------------------------------------------------------ */
/* Shell                                                              */
/* ------------------------------------------------------------------ */

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const current = activeNav(route);
  const [expanded, setExpanded] = useState(readRailPreference);
  const scrollRef = useRef<HTMLDivElement>(null);
  const desktopMenu = useAccountMenu(false);
  const mobileMenu = useAccountMenu(true);
  // the backup reminder's "Back up now" asks for the dialog too (backupReminderState.ts)
  const backupRequest = useBackupDialogRequest();

  // every page starts at the top
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [route.name, route.id]);

  const toggleRail = () => {
    setExpanded((value) => {
      try {
        localStorage.setItem(RAIL_KEY, value ? "0" : "1");
      } catch {
        /* the preference just is not remembered */
      }
      return !value;
    });
  };

  return (
    <div className={cx("cf-dash", expanded && "is-rail-expanded")} data-route={current}>
      {/* ---- left rail (desktop) ---- */}
      <nav className={cx("cf-dnav", expanded && "is-expanded")} aria-label={m.dashboard.shell.mainNav} id="cf-dnav">
        <div className="cf-dnav__top">
          <IconButton
            className="cf-dnav__toggle"
            label={expanded ? m.dashboard.shell.collapseSidebar : m.dashboard.shell.expandSidebar}
            aria-expanded={expanded}
            aria-controls="cf-dnav"
            icon={expanded ? <IconPanelClose aria-hidden="true" /> : <IconPanelOpen aria-hidden="true" />}
            onClick={toggleRail}
          />
          {expanded ? (
            <span className="cf-dnav__brand">
              <BrandMark size={26} />
              Craftly
            </span>
          ) : null}
        </div>

        {expanded ? (
          <Button className="cf-dnav__create-wide" variant="primary" size="lg" block icon={<IconPlus aria-hidden="true" />} onClick={() => openCreateDialog()}>
            {m.dashboard.shared.createDesign}
          </Button>
        ) : (
          <div className="cf-dnav__create">
            <IconButton
              className="cf-dnav__create-btn"
              size="lg"
              label={m.dashboard.shared.createDesign}
              icon={<IconPlus aria-hidden="true" />}
              onClick={() => openCreateDialog()}
            />
            <span className="cf-dnav__create-label" aria-hidden="true">
              {m.dashboard.shell.create}
            </span>
          </div>
        )}

        <ul className="cf-dnav__list">
          {NAV.map((entry) => (
            <li key={entry.id}>
              <a className={cx("cf-dnav__item", entry.id === current && "is-active")} href={entry.href} aria-current={entry.id === current ? "page" : undefined}>
                <span className="cf-dnav__icon">{entry.icon}</span>
                <span className="cf-dnav__label">{entry.label}</span>
              </a>
            </li>
          ))}
        </ul>

        <div className="cf-dnav__bottom">
          {expanded ? (
            <Button
              className="cf-dnav__account-wide"
              variant="ghost"
              block
              icon={<Avatar name={m.dashboard.shell.you} size={28} />}
              iconRight={<IconChevronDown aria-hidden="true" />}
              aria-haspopup="menu"
              aria-expanded={desktopMenu.anchor !== null}
              onClick={(event) => desktopMenu.setAnchor(event.currentTarget)}
            >
              {m.dashboard.shell.you}
            </Button>
          ) : (
            <IconButton
              className="cf-dnav__account"
              size="lg"
              label={m.dashboard.account.menuLabel}
              icon={<Avatar name={m.dashboard.shell.you} size={34} />}
              aria-haspopup="menu"
              aria-expanded={desktopMenu.anchor !== null}
              onClick={(event) => desktopMenu.setAnchor(event.currentTarget)}
            />
          )}
        </div>
        {desktopMenu.popover}
      </nav>

      {/* ---- content column ---- */}
      <div className="cf-dash__column">
        <header className="cf-dash__mobilebar">
          <a className="cf-dash__logo" href="#/" aria-label={m.dashboard.shell.homeLink}>
            <BrandMark size={28} />
            <span>Craftly</span>
          </a>
          <IconButton
            label={m.dashboard.account.menuLabel}
            icon={<Avatar name={m.dashboard.shell.you} size={32} />}
            aria-haspopup="menu"
            aria-expanded={mobileMenu.anchor !== null}
            onClick={(event) => mobileMenu.setAnchor(event.currentTarget)}
          />
          {mobileMenu.popover}
        </header>

        <main className="cf-dash__sheet" id="cf-dash-main">
          <div className="cf-dash__scroll" ref={scrollRef}>
            {children}
          </div>
        </main>
      </div>

      {backupRequest.loaded ? (
        <Suspense fallback={null}>
          <BackupDialog open={backupRequest.open} startNow={backupRequest.start} onClose={closeBackupDialog} />
        </Suspense>
      ) : null}

      {/* ---- bottom tab bar (phones) ---- */}
      <nav className="cf-dtabbar" aria-label={m.dashboard.shell.mainNav}>
        {TAB_BAR_LEFT.map((id) => (
          <TabLink key={id} entry={byId(id)} active={current === id} />
        ))}
        <div className="cf-dtabbar__create">
          <IconButton
            className="cf-dtabbar__create-btn"
            size="lg"
            label={m.dashboard.shared.createDesign}
            icon={<IconPlus aria-hidden="true" />}
            onClick={() => openCreateDialog()}
          />
        </div>
        {TAB_BAR_RIGHT.map((id) => (
          <TabLink key={id} entry={byId(id)} active={current === id} />
        ))}
      </nav>
    </div>
  );
}

function TabLink({ entry, active }: { entry: NavEntry; active: boolean }) {
  return (
    <a className={cx("cf-dtabbar__item", active && "is-active")} href={entry.href} aria-current={active ? "page" : undefined}>
      <span className="cf-dtabbar__icon">{entry.icon}</span>
      <span className="cf-dtabbar__label">{entry.label}</span>
    </a>
  );
}
