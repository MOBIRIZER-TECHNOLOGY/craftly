import type { ReactNode } from "react";
import { m } from "@/i18n";
import { IconHome, IconTemplate, Tabs, cx } from "@/ui";
import { navigate } from "@/router";
import "./Hero.css";

interface HeroProps {
  title: string;
  /** which pill tab is selected */
  active: "home" | "templates";
  /** the search field (and its results) */
  children: ReactNode;
  /** a shorter hero for inner pages */
  compact?: boolean;
}

/** The pale teal-to-lavender header with the big gradient heading, the Home | Templates pills and a search field. */
export function Hero({ title, active, children, compact = false }: HeroProps) {
  return (
    <section className={cx("cf-hero", compact && "cf-hero--compact")}>
      <div className="cf-hero__inner">
        <h1 className="cf-hero__title">{title}</h1>
        <Tabs
          variant="pill"
          className="cf-hero__tabs"
          aria-label={m.dashboard.home.browse}
          value={active}
          onChange={(id) => navigate(id === "home" ? "/" : "/templates")}
          tabs={[
            { id: "home", label: m.dashboard.shell.nav.home, icon: <IconHome aria-hidden="true" /> },
            { id: "templates", label: m.dashboard.shell.nav.templates, icon: <IconTemplate aria-hidden="true" /> },
          ]}
        />
        <div className="cf-hero__search">{children}</div>
      </div>
    </section>
  );
}
