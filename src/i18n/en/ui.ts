/** The UI kit's own words: default labels, close buttons and screen-reader text (src/ui). */
export const ui = {
  colorPicker: {
    saturationBrightness: "Saturation and brightness",
    saturationBrightnessValue: (saturation: number, brightness: number) => `Saturation ${saturation}%, brightness ${brightness}%`,
    pickFromScreen: "Pick colour from screen",
    hue: "Hue",
    opacity: "Opacity",
    current: "Current colour",
    hex: "Hex colour",
  },
  confirm: {
    /** the question of a confirm without a title, when the browser's own dialog is used */
    areYouSure: "Are you sure?",
    confirm: "Confirm",
  },
  contextMenu: {
    label: "Context menu",
  },
  numberField: {
    /** what the stepper buttons change when the field has no name */
    value: "value",
    decrease: (name: string) => `Decrease ${name}`,
    increase: (name: string) => `Increase ${name}`,
  },
  searchField: {
    clear: "Clear search",
  },
  select: {
    placeholder: "Select",
  },
  toast: {
    region: "Notifications",
    dismiss: "Dismiss notification",
  },
};
