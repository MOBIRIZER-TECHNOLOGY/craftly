import type { Template } from "@/core/types";
import { BANNER_TEMPLATES } from "./banners";
import { BRUTALIST } from "./presentations-brutalist";
import { CORPORATE } from "./presentations-corporate";
import { EDITORIAL } from "./presentations-editorial";
import { NEON } from "./presentations-neon";
import { PASTEL } from "./presentations-pastel";
import { PITCH } from "./presentations-pitch";
import { RETRO } from "./presentations-retro";
import { STUDIO } from "./presentations-studio";
import { TRAVEL } from "./presentations-travel";
import { WELLNESS } from "./presentations-wellness";
import { withMotion } from "./motion";

/**
 * Ten presentation decks (one art direction each) followed by the banners and wallpapers. Every deck has the
 * motion that suits its look: how its pages arrive and how its elements enter.
 */
export const PRESENTATIONS_TEMPLATES: Template[] = [
  withMotion(PITCH, { entrance: "rise", transition: "slide", direction: "left" }),
  withMotion(STUDIO, { entrance: "fade", transition: "dissolve", transitionSeconds: 0.9 }),
  withMotion(EDITORIAL, { entrance: "cascade", transition: "wipe", direction: "left" }),
  withMotion(BRUTALIST, { entrance: "pop", transition: "push", direction: "left", transitionSeconds: 0.45 }),
  withMotion(PASTEL, { entrance: "pop", transition: "slide", direction: "up" }),
  withMotion(CORPORATE, { entrance: "fade", transition: "dissolve" }),
  withMotion(TRAVEL, { entrance: "rise", transition: "dissolve", transitionSeconds: 1 }),
  withMotion(RETRO, { entrance: "pan", transition: "wipe", direction: "right" }),
  withMotion(NEON, { entrance: "wipe", transition: "zoom" }),
  withMotion(WELLNESS, { entrance: "fade", transition: "dissolve", transitionSeconds: 1, pageSeconds: 6 }),
  ...BANNER_TEMPLATES,
];
