/**
 * Craftly UI kit. Import everything from "@/ui":
 *   import { Button, IconButton, Popover, MenuPopover, Modal, toast, IconUndo } from "@/ui";
 * Mount <ToastHost />, <ConfirmHost /> and <ContextMenuHost /> once near the app root, and import
 * "@/styles/tokens.css" then "@/styles/base.css" (plus the Plus Jakarta Sans font) in main.tsx.
 */

export * from "./icons";

export { Button } from "./Button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./Button";
export { IconButton } from "./IconButton";
export type { IconButtonProps, IconButtonSize } from "./IconButton";

export { Tooltip } from "./Tooltip";
export type { TooltipPlacement, TooltipProps } from "./Tooltip";
export { Popover } from "./Popover";
export type { PopoverAnchor, PopoverPlacement, PopoverProps } from "./Popover";
export { Menu, MenuList, MenuPopover } from "./Menu";
export type { MenuDividerEntry, MenuEntry, MenuItemEntry, MenuLabelEntry, MenuListProps, MenuPopoverProps } from "./Menu";
export { ContextMenuHost, closeContextMenu, openContextMenu } from "./ContextMenu";
export type { ContextMenuRequest } from "./ContextMenu";

export { Modal } from "./Modal";
export type { ModalProps, ModalSize } from "./Modal";
export { ConfirmHost, confirm } from "./Confirm";
export type { ConfirmOptions } from "./Confirm";
export { ToastHost, toast } from "./Toast";
export type { ToastKind, ToastOptions } from "./Toast";

export { Tabs } from "./Tabs";
export type { TabItem, TabsProps } from "./Tabs";
export { Segmented } from "./Segmented";
export type { SegmentedOption, SegmentedProps } from "./Segmented";

export { Slider, sliderRatioToValue, sliderValueToRatio } from "./Slider";
export type { SliderProps, SliderScale } from "./Slider";
export { NumberField } from "./NumberField";
export type { NumberFieldProps } from "./NumberField";
export { TextField } from "./TextField";
export type { TextFieldProps } from "./TextField";
export { SearchField } from "./SearchField";
export type { SearchFieldProps } from "./SearchField";
export { Switch } from "./Switch";
export type { SwitchProps } from "./Switch";
export { Checkbox } from "./Checkbox";
export type { CheckboxProps } from "./Checkbox";
export { Select } from "./Select";
export type { SelectOption, SelectProps } from "./Select";

export { ColorSwatch } from "./ColorSwatch";
export type { ColorSwatchProps } from "./ColorSwatch";
export { ColorPicker } from "./ColorPicker";
export type { ColorPickerProps } from "./ColorPicker";

export { Spinner } from "./Spinner";
export type { SpinnerProps } from "./Spinner";
export { Progress } from "./Progress";
export type { ProgressProps } from "./Progress";
export { Skeleton } from "./Skeleton";
export type { SkeletonProps } from "./Skeleton";
export { Avatar } from "./Avatar";
export type { AvatarProps } from "./Avatar";
export { Badge } from "./Badge";
export type { BadgeProps, BadgeTone } from "./Badge";
export { Kbd } from "./Kbd";
export type { KbdProps } from "./Kbd";
export { Divider } from "./Divider";
export type { DividerProps } from "./Divider";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";

export {
  focusElement,
  getTabbables,
  isKeyboardModality,
  mergeRefs,
  trapTab,
  useEscape,
  useLatest,
  useMedia,
  useMergedRefs,
  useOutsideClick,
  usePresence,
  useResizeObserver,
  useScrollLock,
} from "./hooks";
export { OVERLAY_ROOT_ID, getOverlayRoot } from "./overlay";
export { ariaShortcut, formatShortcut, isMacPlatform, shortcutKeys } from "./shortcut";
export { cx } from "./cx";
