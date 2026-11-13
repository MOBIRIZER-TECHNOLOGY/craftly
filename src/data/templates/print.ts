import type { Template } from "@/core/types";
import { CARD_TEMPLATES } from "./print-cards";
import { CERTIFICATE_TEMPLATES } from "./print-certificates";
import { CERTIFICATE_TEMPLATES_2 } from "./print-certificates-2";
import { DOCUMENT_TEMPLATES } from "./print-documents";
import { DOCUMENT_TEMPLATES_2 } from "./print-documents-2";
import { FLYER_TEMPLATES } from "./print-flyers";
import { FLYER_TEMPLATES_2 } from "./print-flyers-2";
import { INVITATION_TEMPLATES } from "./print-invitations";
import { MENU_TEMPLATES } from "./print-menus";
import { MENU_TEMPLATES_2 } from "./print-menus-2";
import { POSTER_TEMPLATES } from "./print-posters";
import { POSTER_TEMPLATES_2 } from "./print-posters-2";
import { RESUME_TEMPLATES } from "./print-resumes";
import { RESUME_TEMPLATES_2 } from "./print-resumes-2";

/** The print and document templates: posters, flyers, documents, resumes, invitations, cards, certificates, menus. */
export const PRINT_TEMPLATES: Template[] = [
  ...POSTER_TEMPLATES,
  ...POSTER_TEMPLATES_2,
  ...FLYER_TEMPLATES,
  ...FLYER_TEMPLATES_2,
  ...DOCUMENT_TEMPLATES,
  ...DOCUMENT_TEMPLATES_2,
  ...RESUME_TEMPLATES,
  ...RESUME_TEMPLATES_2,
  ...INVITATION_TEMPLATES,
  ...CARD_TEMPLATES,
  ...CERTIFICATE_TEMPLATES,
  ...CERTIFICATE_TEMPLATES_2,
  ...MENU_TEMPLATES,
  ...MENU_TEMPLATES_2,
];
