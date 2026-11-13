import { lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ProblemsHost } from "@/components/ProblemsHost";
import { ConfirmHost, ContextMenuHost, Spinner, ToastHost } from "@/ui";
import { useRoute } from "./router";

export { designPath, navigate, parseRoute, useRoute } from "./router";

const Editor = lazy(() => import("./editor/Editor").then((m) => ({ default: m.Editor })));
const JoinPage = lazy(() => import("./editor/live/JoinPage").then((m) => ({ default: m.JoinPage })));
const Dashboard = lazy(() => import("./dashboard/Dashboard").then((m) => ({ default: m.Dashboard })));
// Development-only routes (#/gallery renders every element type, #/sandbox is a canvas test bed). Vite replaces
// import.meta.env.DEV with `false` in production builds, so both are dropped from the bundle.
const Gallery = import.meta.env.DEV ? lazy(() => import("./dev/Gallery").then((m) => ({ default: m.Gallery }))) : null;
const Sandbox = import.meta.env.DEV ? lazy(() => import("./dev/Sandbox").then((m) => ({ default: m.Sandbox }))) : null;

function Boot() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--c-bg-subtle)" }}>
      <Spinner size={28} />
    </div>
  );
}

export function App() {
  const route = useRoute();
  let view;
  if (route.name === "sandbox" && Sandbox) view = <Sandbox />;
  else if (route.name === "gallery" && Gallery) view = <Gallery />;
  else if (route.name === "design" && route.id) view = <Editor key={route.id} designId={route.id} />;
  else if (route.name === "join" && route.id) view = <JoinPage key={route.id} token={route.id} />;
  else view = <Dashboard />;
  return (
    <>
      <ErrorBoundary resetKey={`${route.name}/${route.id ?? ""}`} designId={route.name === "design" ? (route.id ?? null) : null}>
        <Suspense fallback={<Boot />}>{view}</Suspense>
      </ErrorBoundary>
      <ToastHost />
      <ProblemsHost />
      <ConfirmHost />
      <ContextMenuHost />
    </>
  );
}
