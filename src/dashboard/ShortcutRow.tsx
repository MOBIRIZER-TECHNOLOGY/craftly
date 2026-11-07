import { useMemo, useState, type CSSProperties } from "react";
import { IconCustomSize, IconMore, IconPrint, IconSocial, IconUpload, MenuPopover, cx, type LucideIcon, type MenuEntry } from "@/ui";
import { DESIGN_TYPES, describeSize, getDesignType, type DesignType } from "@/data/designTypes";
import { createBlankAndOpen, pickImageAndCreate } from "./actions";
import { openCreateDialog } from "./createDialogState";
import { typeIcon } from "./designIcons";
import "./ShortcutRow.css";

interface Shortcut {
  id: string;
  label: string;
  icon: LucideIcon;
  /** tile colour; neutral "plain" tiles have none */
  color?: string;
  /** creates / opens something */
  run?: () => void;
  /** opens a submenu of design types instead */
  types?: DesignType[];
}

const categoryColor = (category: DesignType["category"]) => DESIGN_TYPES.find((type) => type.category === category)?.color;

function typeShortcut(id: string, label: string): Shortcut | null {
  const type = getDesignType(id);
  return type ? { id, label, icon: typeIcon(type), color: type.color, run: () => void createBlankAndOpen(type) } : null;
}

function buildShortcuts(): Shortcut[] {
  const list: Array<Shortcut | null> = [
    typeShortcut("presentation", "Presentation"),
    { id: "social", label: "Social media", icon: IconSocial, color: categoryColor("social"), types: DESIGN_TYPES.filter((type) => type.category === "social") },
    { id: "print", label: "Printables", icon: IconPrint, color: categoryColor("print"), types: DESIGN_TYPES.filter((type) => type.category === "print") },
    typeShortcut("doc-a4", "Doc"),
    typeShortcut("resume", "Resume"),
    typeShortcut("logo", "Logo"),
    { id: "custom", label: "Custom size", icon: IconCustomSize, run: () => openCreateDialog({ tab: "custom" }) },
    { id: "upload", label: "Upload", icon: IconUpload, run: () => void pickImageAndCreate() },
    { id: "more", label: "More", icon: IconMore, run: () => openCreateDialog() },
  ];
  return list.filter((item): item is Shortcut => item !== null);
}

/** The row of illustrated shortcut tiles under the Home search: create a blank design, open a submenu or the Create dialog. */
export function ShortcutRow() {
  const shortcuts = useMemo(buildShortcuts, []);
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const openShortcut = shortcuts.find((item) => item.id === open?.id);

  const menuItems: MenuEntry[] = (openShortcut?.types ?? []).map((type) => {
    const Icon = typeIcon(type);
    return {
      id: type.id,
      label: type.name,
      icon: <Icon aria-hidden="true" />,
      hint: describeSize(type.width, type.height, type.unit),
      onSelect: () => void createBlankAndOpen(type),
    };
  });

  return (
    <div className="cf-dshortcuts-wrap">
      <div className="cf-dshortcuts" role="group" aria-label="Start a design">
        {shortcuts.map((item) => {
          const Icon = item.icon;
          const isMenu = item.types !== undefined;
          const expanded = open?.id === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={cx("cf-dshortcut", !item.color && "cf-dshortcut--plain", expanded && "is-open")}
              style={item.color ? ({ "--cf-tile": item.color } as CSSProperties) : undefined}
              aria-haspopup={isMenu ? "menu" : undefined}
              aria-expanded={isMenu ? expanded : undefined}
              onClick={(event) => {
                if (isMenu) setOpen(expanded ? null : { id: item.id, anchor: event.currentTarget });
                else item.run?.();
              }}
            >
              <span className="cf-dshortcut__icon">
                <Icon strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="cf-dshortcut__label">{item.label}</span>
            </button>
          );
        })}
      </div>
      <MenuPopover
        open={open !== null && menuItems.length > 0}
        anchor={open?.anchor ?? null}
        onClose={() => setOpen(null)}
        items={menuItems}
        placement="bottom"
        aria-label={openShortcut?.label}
      />
    </div>
  );
}
