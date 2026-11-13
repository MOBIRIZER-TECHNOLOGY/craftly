import type { Template } from "@/core/types";
import { CARD_TEMPLATES } from "./print-cards";
import { CERTIFICATE_TEMPLATES } from "./print-certificates";
import { DOCUMENT_TEMPLATES } from "./print-documents";
import { FLYER_TEMPLATES } from "./print-flyers";
import { FLYER_TEMPLATES_2 } from "./print-flyers-2";
import { INVITATION_TEMPLATES } from "./print-invitations";
import { MENU_TEMPLATES } from "./print-menus";
import { MENU_TEMPLATES_2 } from "./print-menus-2";
import { POSTER_TEMPLATES } from "./print-posters";
import { POSTER_TEMPLATES_2 } from "./print-posters-2";
import { RESUME_TEMPLATES } from "./print-resumes";

/** The print and document templates: posters, flyers, documents, resumes, invitations, cards, certificates, menus. */
export const PRINT_TEMPLATES: Template[] = [
  ...POSTER_TEMPLATES,
  ...POSTER_TEMPLATES_2,
  ...FLYER_TEMPLATES,
  ...FLYER_TEMPLATES_2,
  ...DOCUMENT_TEMPLATES,
  ...RESUME_TEMPLATES,
  ...INVITATION_TEMPLATES,
  ...CARD_TEMPLATES,
  ...CERTIFICATE_TEMPLATES,
  ...MENU_TEMPLATES,
  ...MENU_TEMPLATES_2,
];
