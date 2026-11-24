import type { ui as en } from "../en/ui";

export const ui: typeof en = {
  colorPicker: {
    saturationBrightness: "संतृप्ति और चमक",
    saturationBrightnessValue: (saturation: number, brightness: number) => `संतृप्ति ${saturation}%, चमक ${brightness}%`,
    pickFromScreen: "स्क्रीन से रंग चुनें",
    hue: "रंगत",
    opacity: "अपारदर्शिता",
    current: "मौजूदा रंग",
    hex: "हेक्स रंग",
    palettes: "नाम वाले पैलेट",
  },
  confirm: {
    areYouSure: "क्या आप निश्चित हैं?",
    confirm: "पुष्टि करें",
  },
  contextMenu: {
    label: "संदर्भ मेनू",
  },
  numberField: {
    value: "मान",
    decrease: (name: string) => `${name} घटाएँ`,
    increase: (name: string) => `${name} बढ़ाएँ`,
  },
  searchField: {
    clear: "खोज साफ़ करें",
  },
  select: {
    placeholder: "चुनें",
  },
  toast: {
    region: "सूचनाएँ",
    dismiss: "सूचना हटाएँ",
  },
};
