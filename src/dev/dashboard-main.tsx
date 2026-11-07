/**
 * Dev-only harness for the dashboard (dev-dashboard.html, served by vite.dev-dashboard.config.ts on port 5186).
 *
 * It mounts <Dashboard /> exactly like src/App.tsx does (toast / confirm / context-menu hosts included), replaces the
 * editor with a stub that shows where "#/design/<id>" would open, and seeds demo content into IndexedDB the first
 * time (designs with real thumbnails, folders, trash, uploads, a brand kit and - while the template package is
 * still empty - demo templates). `?seed=none` skips all seeding, `?templates=none` leaves the catalogue as it is.
 */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { addAssetFromFile } from "@/core/assets";
import { createDesign, createPage, createShape, createText, solid } from "@/core/factory";
import { createFolder, listDesigns, listFolders, saveDesign, setBrandKit } from "@/core/library";
import type { Design, Page, SizeUnit, Template, TemplateCategory } from "@/core/types";
import { Dashboard } from "@/dashboard/Dashboard";
import { getDesignType } from "@/data/designTypes";
import { TEMPLATES } from "@/data/templates";
import { H, R, RR, SIZES, T, template as makeTemplate, pg, type SizeKey } from "@/data/templates/dsl";
import { renderPageToCanvas } from "@/render/renderPage";
import { designPath, navigate, useRoute } from "@/router";
import { Button, ConfirmHost, ContextMenuHost, ToastHost } from "@/ui";
import { sampleDesign } from "./sampleDesign";

/* ------------------------------------------------------------------ */
/* Seeding                                                            */
/* ------------------------------------------------------------------ */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function hex(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function demoPage(width: number, height: number, hue: number, headline: string): Page {
  const m = Math.min(width, height);
  const page = createPage({
    background: {
      type: "linear",
      angle: 150,
      stops: [
        { offset: 0, color: hex(hue, 85, 94) },
        { offset: 1, color: hex((hue + 40) % 360, 85, 80) },
      ],
    },
  });
  page.elements.push(
    createShape("ellipse", { x: width * 0.58, y: height * 0.08, width: m * 0.5, height: m * 0.5, fill: solid(hex(hue, 75, 55)) }),
    createShape("rect", { x: width * 0.08, y: height * 0.64, width: width * 0.36, height: m * 0.08, radius: m * 0.04, fill: solid(hex((hue + 200) % 360, 70, 38)) }),
    createText({
      text: headline,
      x: width * 0.08,
      y: height * 0.14,
      width: width * 0.64,
      autoWidth: false,
      fontSize: Math.round(m * 0.1),
      fontWeight: 800,
      color: hex(hue, 60, 16),
      lineHeight: 1.05,
    }),
  );
  return page;
}

interface DemoDesign {
  title: string;
  typeId: string;
  hue: number;
  ago: number;
  starred?: boolean;
  folder?: string;
  trashedAgo?: number;
  headline?: string;
}

async function seedDesigns(folders: Record<string, string>): Promise<void> {
  const plan: DemoDesign[] = [
    { title: "Quarterly review", typeId: "presentation", hue: 262, ago: 4 * MIN, starred: true, headline: "Quarterly\nreview" },
    { title: "Summer sale", typeId: "instagram-post", hue: 24, ago: 2 * HOUR, headline: "Summer\nsale" },
    { title: "Team offsite flyer", typeId: "flyer", hue: 170, ago: 26 * HOUR, headline: "Team\noffsite" },
    { title: "Acme logo concepts", typeId: "logo", hue: 330, ago: 3 * DAY, starred: true, headline: "Acme" },
    { title: "Resume - Alex Morgan", typeId: "resume", hue: 210, ago: 9 * DAY, headline: "Alex\nMorgan" },
    { title: "Product launch deck", typeId: "presentation", hue: 190, ago: 14 * DAY, folder: "Client work", headline: "Product\nlaunch" },
    { title: "Launch day thumbnail", typeId: "youtube-thumbnail", hue: 0, ago: 15 * DAY, folder: "Client work", starred: true, headline: "It's live!" },
    { title: "Festival poster draft", typeId: "poster", hue: 285, ago: 40 * DAY, folder: "Personal", headline: "Night\nmarket" },
    { title: "Untitled design", typeId: "custom", hue: 50, ago: 6 * HOUR, headline: "Collage" },
    { title: "Old web banner", typeId: "banner", hue: 140, ago: 20 * DAY, trashedAgo: 3 * DAY, headline: "Old banner" },
    { title: "Scratch pad", typeId: "instagram-story", hue: 100, ago: 2 * DAY, trashedAgo: 40 * MIN, headline: "Scratch" },
  ];

  for (const [index, item] of plan.entries()) {
    const type = getDesignType(item.typeId);
    const width = type?.width ?? 1200;
    const height = type?.height ?? 900;
    const unit: SizeUnit = type?.unit ?? "px";
    const page = index === 0 ? sampleDesign().pages[0] : demoPage(width, height, item.hue, item.headline ?? item.title);
    const design: Design = createDesign({ title: item.title, typeId: item.typeId, width, height, unit, pages: [page] });
    const now = Date.now();
    design.createdAt = now - item.ago - DAY;
    design.updatedAt = now - item.ago;
    design.starred = item.starred ?? false;
    design.folderId = item.folder ? (folders[item.folder] ?? null) : null;
    design.trashedAt = item.trashedAgo ? now - item.trashedAgo : null;
    let thumbnail: string | undefined;
    try {
      thumbnail = (await renderPageToCanvas(design, design.pages[0], { width: 420 })).toDataURL("image/jpeg", 0.82);
    } catch (error) {
      console.warn("seed thumbnail failed", error);
    }
    await saveDesign(design, thumbnail);
  }
}

async function pictureFile(name: string, hue: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 420;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const gradient = ctx.createLinearGradient(0, 0, 640, 420);
  gradient.addColorStop(0, hex(hue, 85, 70));
  gradient.addColorStop(1, hex((hue + 60) % 360, 80, 45));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 640, 420);
  ctx.fillStyle = "rgba(255,255,255,.35)";
  ctx.beginPath();
  ctx.arc(470, 150, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(0, 300, 640, 120);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b as Blob), "image/png"));
  return new File([blob], `${name}.png`, { type: "image/png" });
}

async function seedAssetsAndBrand(): Promise<void> {
  await addAssetFromFile(await pictureFile("Sunset photo", 20));
  await addAssetFromFile(await pictureFile("Team lunch", 150));
  await addAssetFromFile(await pictureFile("Product shot", 260));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120"><circle cx="60" cy="60" r="52" fill="#1f2a44"/><path d="M36 78 60 30l24 48H68l-8-17-8 17z" fill="#ffd166"/></svg>`;
  const logo = await addAssetFromFile(new File([svg], "Acme mark.svg", { type: "image/svg+xml" }));
  await setBrandKit({ colors: ["#1f2a44", "#ff6b6b", "#ffd166", "#06d6a0", "#f7f7f2"], fonts: ["Playfair Display", "Inter"], logos: [logo.id] });
}

const DEMO_CATEGORIES: Array<{ category: TemplateCategory; size: SizeKey; word: string }> = [
  { category: "presentation", size: "presentation", word: "Pitch deck" },
  { category: "social", size: "instagram", word: "Sale post" },
  { category: "social", size: "story", word: "Story" },
  { category: "poster", size: "poster", word: "Event poster" },
  { category: "flyer", size: "flyer", word: "Open house" },
  { category: "resume", size: "resume", word: "Clean resume" },
  { category: "logo", size: "logo", word: "Mono logo" },
  { category: "invitation", size: "invitation", word: "Party invite" },
  { category: "card", size: "businessCard", word: "Business card" },
  { category: "banner", size: "banner", word: "Web banner" },
];

function seedTemplates(count: number): void {
  const made: Template[] = [];
  for (let i = 0; i < count; i += 1) {
    const spec = DEMO_CATEGORIES[i % DEMO_CATEGORIES.length];
    const hue = (i * 37) % 360;
    const size = SIZES[spec.size];
    const w = size.width;
    const h = size.height;
    const m = Math.min(w, h);
    const pages = Array.from({ length: i % 3 === 0 ? 3 : 1 }, (_unused, p) =>
      pg(hex((hue + p * 20) % 360, 80, 93), [
        R(0, 0, w * 0.34, h, hex((hue + p * 20) % 360, 70, 55)),
        RR(w * 0.42, h * 0.62, w * 0.3, m * 0.09, m * 0.045, hex(hue, 65, 30)),
        H(`${spec.word} ${i + 1}`, w * 0.42, h * 0.16, w * 0.52, Math.round(m * 0.09), { color: hex(hue, 55, 14) }),
        T("Edit this text to make it yours.", w * 0.42, h * 0.46, w * 0.5, Math.round(m * 0.04), { color: hex(hue, 25, 30) }),
      ]),
    );
    made.push(
      makeTemplate(
        {
          slug: `demo-${i + 1}`,
          name: `${spec.word} ${i + 1}`,
          category: spec.category,
          size: spec.size,
          tags: [spec.word.toLowerCase(), spec.category, i % 2 ? "modern" : "classic"],
          accent: hex(hue, 70, 82),
        },
        pages,
      ),
    );
  }
  TEMPLATES.push(...made);
}

async function seed(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  // ?templates=empty shows the dashboard as it looks while the catalogue has nothing in it
  if (params.get("templates") === "empty") TEMPLATES.length = 0;
  else if (params.get("templates") !== "none" && TEMPLATES.length === 0) seedTemplates(Number(params.get("count")) || 60);
  if (params.get("seed") === "none") return;
  if ((await listDesigns()).length > 0 || (await listFolders()).length > 0) return;
  const client = await createFolder("Client work");
  const personal = await createFolder("Personal");
  await seedDesigns({ "Client work": client.id, Personal: personal.id });
  await seedAssetsAndBrand();
}

/* ------------------------------------------------------------------ */
/* Root                                                               */
/* ------------------------------------------------------------------ */

function EditorStub({ id }: { id: string }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--c-workspace)" }}>
      <div style={{ padding: 32, borderRadius: 20, background: "var(--c-bg)", boxShadow: "var(--sh-pop)", maxWidth: 440, display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800 }}>The editor opens here</h1>
        <p data-testid="editor-stub">Design id: {id}</p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="primary" onClick={() => navigate("/")}>
            Back to the dashboard
          </Button>
          <Button
            onClick={() => {
              sessionStorage.setItem("craftly:open-create", "1");
              navigate("/");
            }}
          >
            File &gt; Create new design
          </Button>
        </div>
      </div>
    </div>
  );
}

function Root() {
  const route = useRoute();
  return route.name === "design" && route.id ? <EditorStub id={route.id} /> : <Dashboard />;
}

void seed()
  .catch((error) => console.error("dashboard harness: seeding failed", error))
  .finally(() => {
    // reuse the root when a hot update re-runs this module (teammates edit files while the harness is open)
    const host = document.getElementById("root") as HTMLElement & { __craftlyRoot?: ReturnType<typeof createRoot> };
    host.__craftlyRoot ??= createRoot(host);
    host.__craftlyRoot.render(
      <StrictMode>
        <Root />
        <ToastHost />
        <ConfirmHost />
        <ContextMenuHost />
      </StrictMode>,
    );
  });

// handy in the console / in tests
(window as unknown as { __designPath: typeof designPath }).__designPath = designPath;
