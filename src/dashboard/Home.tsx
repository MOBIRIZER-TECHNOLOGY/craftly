import { useMemo } from "react";
import { DESIGN_TYPES, POPULAR_DESIGN_TYPES } from "@/data/designTypes";
import { m } from "@/i18n";
import { createBlankAndOpen } from "./actions";
import { CategoryTile } from "./CategoryTile";
import { Carousel } from "./Carousel";
import { openCreateDialog } from "./createDialogState";
import { useDesigns, useFolders, useNow } from "./data";
import { DesignCard, DesignCardSkeleton } from "./DesignCard";
import { DesignTypeTile } from "./DesignTypeTile";
import { Hero } from "./Hero";
import { HomeSearch } from "./HomeSearch";
import { Page, Section, SeeAll } from "./Page";
import { ShortcutRow } from "./ShortcutRow";
import { TemplateCard } from "./TemplateCard";
import { templateCategories, templatesForYou } from "./templateLists";
import { WelcomePanel } from "./WelcomePanel";
import "./Home.css";

const RECENT_LIMIT = 12;
const FOR_YOU_LIMIT = 16;

/** Home: hero + search, the first-run welcome (only while the library is empty), shortcut tiles, Recent designs, Templates for you, template categories, popular sizes. */
export function Home() {
  const { active: designs, ready } = useDesigns();
  const { folders } = useFolders();
  const now = useNow();

  const recent = useMemo(() => designs.slice(0, RECENT_LIMIT), [designs]);
  const forYou = useMemo(() => templatesForYou(designs, FOR_YOU_LIMIT), [designs]);
  const categories = useMemo(templateCategories, []);
  const moreSizes = useMemo(() => DESIGN_TYPES.filter((type) => !type.popular).slice(0, 14), []);

  return (
    <div className="cf-home">
      <Hero title={m.dashboard.home.title} active="home">
        <HomeSearch />
      </Hero>

      <Page className="cf-home__page">
        <WelcomePanel />
        <ShortcutRow />

        {!ready ? (
          <Section title={m.dashboard.home.recent}>
            <Carousel label={m.dashboard.home.recent}>
              {Array.from({ length: 5 }, (_unused, index) => (
                <DesignCardSkeleton key={index} layout="carousel" />
              ))}
            </Carousel>
          </Section>
        ) : recent.length > 0 ? (
          <Section title={m.dashboard.home.recent} action={<SeeAll to="/projects" />}>
            <Carousel label={m.dashboard.home.recent}>
              {recent.map((design) => (
                <DesignCard key={design.id} design={design} folders={folders} now={now} layout="carousel" />
              ))}
            </Carousel>
          </Section>
        ) : null}

        {forYou.length > 0 ? (
          <Section title={m.dashboard.home.forYou} action={<SeeAll to="/templates" />}>
            <Carousel label={m.dashboard.home.forYou}>
              {forYou.map((template) => (
                <TemplateCard key={template.id} template={template} height={210} />
              ))}
            </Carousel>
          </Section>
        ) : null}

        {categories.length > 0 ? (
          <Section title={m.dashboard.home.browseCategories} action={<SeeAll to="/templates" />}>
            <Carousel label={m.dashboard.home.categories}>
              {categories.map((category) => (
                <CategoryTile key={category.id} category={category.id} label={category.label} count={category.count} example={category.example} />
              ))}
            </Carousel>
          </Section>
        ) : null}

        <Section title={m.dashboard.home.popular} action={<SeeAll onClick={() => openCreateDialog()} />}>
          <Carousel label={m.dashboard.home.popularTypes}>
            {POPULAR_DESIGN_TYPES.map((type) => (
              <DesignTypeTile key={type.id} type={type} size="lg" className="cf-home__tile cf-home__tile--lg" onClick={() => void createBlankAndOpen(type)} />
            ))}
          </Carousel>
        </Section>

        <Section title={m.dashboard.home.fromSize} action={<SeeAll onClick={() => openCreateDialog()} />}>
          <Carousel label={m.dashboard.home.moreSizes}>
            {moreSizes.map((type) => (
              <DesignTypeTile key={type.id} type={type} size="sm" className="cf-home__tile cf-home__tile--sm" onClick={() => void createBlankAndOpen(type)} />
            ))}
          </Carousel>
        </Section>
      </Page>
    </div>
  );
}
