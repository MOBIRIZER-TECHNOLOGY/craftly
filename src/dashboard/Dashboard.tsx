/**
 * The dashboard: app shell (rail / tab bar) plus the page for the hash route -
 * `#/` Home, `#/projects[/folderId]`, `#/templates[/categoryId]`, `#/brand`, `#/trash` - and the dialogs they share
 * (Create, template preview, name prompt).
 */
import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { useCloud } from "@/cloud/state";
import { m } from "@/i18n";
import { useRoute } from "@/router";
import { BackupReminderNotice } from "./BackupReminderNotice";
import { BrandPage } from "./BrandPage";
import { CreateDialog } from "./CreateDialog";
import { closeCreateDialog, consumeOpenCreateRequest } from "./createDialogState";
import { useDesigns } from "./data";
import { Home } from "./Home";
import { PromptHost } from "./prompt";
import { ProjectsPage } from "./ProjectsPage";
import { Shell } from "./Shell";
import { StorageNotice } from "./StorageNotice";
import { TemplatePreviewHost } from "./TemplatePreviewModal";
import { closeTemplatePreview } from "./templatePreview";
import { TemplatesPage } from "./TemplatesPage";
import { TrashPage } from "./TrashPage";
import { useAccountDialogs } from "./account/dialogState";

// the account screens: loaded when one is opened, and the space switcher only while somebody is signed in (docs/ACCOUNTS.md)
const SignInPage = lazy(() => import("./account/SignInPage").then((mod) => ({ default: mod.SignInPage })));
const ResetPage = lazy(() => import("./account/ResetPage").then((mod) => ({ default: mod.ResetPage })));
const InvitePage = lazy(() => import("./account/InvitePage").then((mod) => ({ default: mod.InvitePage })));
const TeamPage = lazy(() => import("./account/TeamPage").then((mod) => ({ default: mod.TeamPage })));
const TeamSwitcher = lazy(() => import("./account/TeamSwitcher").then((mod) => ({ default: mod.TeamSwitcher })));
const AccountDialogs = lazy(() => import("./account/AccountDialogs").then((mod) => ({ default: mod.AccountDialogs })));

const TITLES: Record<string, string> = {
  projects: m.dashboard.pageTitles.projects,
  templates: m.dashboard.pageTitles.templates,
  brand: m.dashboard.pageTitles.brand,
  trash: m.dashboard.pageTitles.trash,
  signin: m.cloud.signIn.title,
  signup: m.cloud.signUp.title,
  reset: m.cloud.reset.title,
  invite: m.cloud.invite.title,
  team: m.cloud.menu.teamMembers,
};
const HOME_TITLE = m.dashboard.pageTitles.home;

export function Dashboard() {
  const route = useRoute();
  const { error } = useDesigns();
  const signedIn = useCloud((s) => s.session !== null);
  const dialogsLoaded = useAccountDialogs((s) => s.loaded);

  // tab title follows the page, and the original title returns when the dashboard goes away (the editor sets its own)
  useEffect(() => {
    const original = document.title;
    return () => {
      document.title = original;
    };
  }, []);
  useEffect(() => {
    document.title = TITLES[route.name] ?? HOME_TITLE;
  }, [route.name]);

  // another screen (the editor's "Create new design") may ask for the Create dialog on arrival
  useEffect(() => {
    consumeOpenCreateRequest();
  }, []);

  // dialogs belong to the page that opened them
  const routeKey = `${route.name}/${route.id ?? ""}`;
  const lastRoute = useRef(routeKey);
  useEffect(() => {
    if (lastRoute.current === routeKey) return;
    lastRoute.current = routeKey;
    closeCreateDialog();
    closeTemplatePreview();
  }, [routeKey]);

  let page: ReactNode;
  switch (route.name) {
    case "projects":
      page = <ProjectsPage folderId={route.id} />;
      break;
    case "templates":
      page = <TemplatesPage category={route.id} />;
      break;
    case "brand":
      page = <BrandPage />;
      break;
    case "trash":
      page = <TrashPage />;
      break;
    case "signin":
    case "signup":
      page = <SignInPage key={route.name} mode={route.name} />;
      break;
    case "reset":
      page = <ResetPage code={route.id} />;
      break;
    case "invite":
      page = <InvitePage code={route.id ?? ""} />;
      break;
    case "team":
      page = route.id ? <TeamPage key={route.id} teamId={route.id} /> : <Home />;
      break;
    default:
      page = <Home />;
  }

  return (
    <>
      <Shell route={route}>
        {error ? <StorageNotice detail={error} /> : <BackupReminderNotice />}
        {signedIn ? (
          <Suspense fallback={null}>
            <TeamSwitcher />
          </Suspense>
        ) : null}
        <Suspense fallback={null}>{page}</Suspense>
      </Shell>
      <CreateDialog />
      <TemplatePreviewHost />
      <PromptHost />
      {dialogsLoaded ? (
        <Suspense fallback={null}>
          <AccountDialogs />
        </Suspense>
      ) : null}
    </>
  );
}
