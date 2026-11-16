import { useMemo, useState, type CSSProperties } from "react";
import { IconCustomSize, IconMore, IconPrint, IconSocial, IconUpload, MenuPopover, cx, type LucideIcon, type MenuEntry } from "@/ui";
import { DESIGN_TYPES, describeSize, getDesignType, type DesignType } from "@/data/designTypes";
import { m } from "@/i18n";
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
    typeShortcut("presentation", m.dashboard.shortcuts.presentation),
    { id: "social", label: m.dashboard.shortcuts.social, icon: IconSocial, color: categoryColor("social"), types: DESIGN_TYPES.filter((type) => type.category === "social") },
    { id: "print", label: m.dashboard.shortcuts.print, icon: IconPrint, color: categoryColor("print"), types: DESIGN_TYPES.filter((type) => type.category === "print") },
    typeShortcut("doc-a4", m.dashboard.shortcuts.doc),
    typeShortcut("resume", m.dashboard.shortcuts.resume),
    typeShortcut("logo", m.dashboard.shortcuts.logo),
    { id: "custom", label: m.dashboard.shared.customSize, icon: IconCustomSize, run: () => openCreateDialog({ tab: "custom" }) },
    { id: "upload", label: m.dashboard.shared.upload, icon: IconUpload, run: () => void pickImageAndCreate() },
    { id: "more", label: m.common.more, icon: IconMore, run: () => openCreateDialog() },
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
      <div className="cf-dshortcuts" role="group" aria-label={m.dashboard.shortcuts.group}>
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
