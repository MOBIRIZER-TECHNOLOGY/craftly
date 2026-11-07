import type { Template } from "@/core/types";
import { CARD_TEMPLATES } from "./print-cards";
import { CERTIFICATE_TEMPLATES } from "./print-certificates";
import { DOCUMENT_TEMPLATES } from "./print-documents";
import { FLYER_TEMPLATES } from "./print-flyers";
import { INVITATION_TEMPLATES } from "./print-invitations";
import { MENU_TEMPLATES } from "./print-menus";
import { POSTER_TEMPLATES } from "./print-posters";
import { RESUME_TEMPLATES } from "./print-resumes";

/** 30 print and document templates: posters, flyers, documents, resumes, invitations, cards, certificates, menus. */
export const PRINT_TEMPLATES: Template[] = [...POSTER_TEMPLATES, ...FLYER_TEMPLATES, ...DOCUMENT_TEMPLATES, ...RESUME_TEMPLATES, ...INVITATION_TEMPLATES, ...CARD_TEMPLATES, ...CERTIFICATE_TEMPLATES, ...MENU_TEMPLATES];
