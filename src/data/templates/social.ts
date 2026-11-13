import type { Template } from "@/core/types";
import { IG_TEMPLATES } from "./social-ig";
import { LOGO_TEMPLATES } from "./social-logos";
import { LOGO_TEMPLATES_2 } from "./social-logos-2";
import { SQUARE_TEMPLATES } from "./social-square";
import { STORY_TEMPLATES } from "./social-story";
import { withMotion } from "./motion";
import { WIDE_TEMPLATES } from "./social-wide";
import { YOUTUBE_TEMPLATES } from "./social-youtube";

/** 24 social media templates (Instagram, square, story, Facebook, YouTube, LinkedIn, X, Pinterest) and 8 logos. */
export const SOCIAL_TEMPLATES: Template[] = [...IG_TEMPLATES, ...SQUARE_TEMPLATES, ...STORY_TEMPLATES.map((t) => withMotion(t, { entrance: "rise", transition: "slide", direction: "up" })), ...WIDE_TEMPLATES, ...YOUTUBE_TEMPLATES, ...LOGO_TEMPLATES, ...LOGO_TEMPLATES_2];
