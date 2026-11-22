/**
 * Review and approval (docs/REVIEW.md): where a design stands in a review, and the revision of its content that a state is about.
 * Beside the check of a comment (comments.ts), this is the one check of a review record: the wire, a design that arrives whole, a
 * project file and a backup all ask it. No DOM and no Node API: the server bundles this.
 *
 * THE REVISION IS THE CONTENT. `contentRevision` is a hash of what is drawn: the width, the height and the pages, written as JSON
 * with sorted keys. Every copy of a shared design applies the same operations in the same order, so the same content gives the same
 * revision on every copy, on the server, in the team's space and after a reload; an edit gives another, and a state set before it
 * is then about an earlier version. The title, the unit, the guides, the comments, the review itself and the library's details
 * do not count: none of them changes what was looked at.
 */
import { readAuthor } from "./comments";
import type { Design, DesignReview, Page, ReviewState } from "./types";

export const REVIEW_STATES: readonly ReviewState[] = ["requested", "approved", "changes"];
/** The format of the review record this build writes and reads. */
export const REVIEW_VERSION = 1;

const REVIEW_KEYS = ["v", "state", "revision", "by", "at"];
/** A revision as `contentRevision` makes them, or as a later build may: a short name of letters, digits, `_` and `-`. */
const REVISION = /^[A-Za-z0-9_-]{1,80}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const isReviewState = (v: unknown): v is ReviewState => v === "requested" || v === "approved" || v === "changes";

/** A review record, as a fresh object of what it is made of, if it has the form it should; otherwise what is wrong with it. */
export function readReview(value: unknown): DesignReview | string {
  if (!isObject(value)) return "a review is an object";
  const extra = Object.keys(value).find((key) => !REVIEW_KEYS.includes(key));
  if (extra !== undefined) return `a field that a review does not have (${extra.slice(0, 40)})`;
  if (value.v !== REVIEW_VERSION) return "a review of a format this version does not know";
  if (!isReviewState(value.state)) return "a review is requested, approved or changes";
  if (typeof value.revision !== "string" || !REVISION.test(value.revision)) return "a review is about a revision";
  const by = readAuthor(value.by);
  if (typeof by === "string") return by;
  if (typeof value.at !== "number" || !Number.isFinite(value.at) || value.at < 0) return "a time is a number";
  return { v: REVIEW_VERSION, state: value.state, revision: value.revision, by, at: value.at };
}

/** What is wrong with the review of a design that arrives whole, if anything. None is fine. */
export function reviewProblem(value: unknown): string | null {
  if (value === undefined) return null;
  const read = readReview(value);
  return typeof read === "string" ? read : null;
}

/** The review of a file (a project file, a backup), when it is one; otherwise none. */
export function usableReview(value: unknown): DesignReview | undefined {
  const read = readReview(value);
  return typeof read === "string" ? undefined : read;
}

/* ---------------- the revision of the content ---------------- */

/** Two 53-bit hashes (cyrb53) fed piece by piece, so that a large design is never written out as one string. */
class Hasher {
  private a1 = 0xdeadbeef;
  private a2 = 0x41c6ce57;
  private b1 = 0xdeadbeef ^ 0x9e3779b9;
  private b2 = 0x41c6ce57 ^ 0x9e3779b9;

  add(text: string): void {
    let { a1, a2, b1, b2 } = this;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      a1 = Math.imul(a1 ^ ch, 2654435761);
      a2 = Math.imul(a2 ^ ch, 1597334677);
      b1 = Math.imul(b1 ^ ch, 2246822519);
      b2 = Math.imul(b2 ^ ch, 3266489917);
    }
    Object.assign(this, { a1, a2, b1, b2 });
  }

  private static finish(h1: number, h2: number): string {
    let x = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    x ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    let y = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    y ^= Math.imul(x ^ (x >>> 13), 3266489909);
    return (4294967296 * (2097151 & y) + (x >>> 0)).toString(36).padStart(11, "0");
  }

  digest(): string {
    return Hasher.finish(this.a1, this.a2) + Hasher.finish(this.b1, this.b2);
  }
}

/** Feeds a value to the hasher as JSON.stringify would write it, with the keys of every object in sorted order. */
function feed(h: Hasher, value: unknown): void {
  if (value === null || typeof value === "boolean") return h.add(String(value));
  if (typeof value === "number") return h.add(Number.isFinite(value) ? String(value) : "null");
  if (typeof value === "string") return h.add(JSON.stringify(value));
  if (Array.isArray(value)) {
    h.add("[");
    value.forEach((item, i) => {
      if (i) h.add(",");
      // (as JSON writes it: what is not a value in a list is null)
      if (item === undefined || typeof item === "function" || typeof item === "symbol") h.add("null");
      else feed(h, item);
    });
    return h.add("]");
  }
  if (typeof value !== "object") return h.add("null");
  h.add("{");
  let first = true;
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
    if (!first) h.add(",");
    first = false;
    h.add(JSON.stringify(key));
    h.add(":");
    feed(h, child);
  }
  h.add("}");
}

/** The last revision worked out for a list of pages, with the size it was worked out for: the store keeps pages that did not change. */
const known = new WeakMap<readonly Page[], { width: number; height: number; revision: string }>();

/** The revision of what a design draws: the same on every copy of the same content, another after any edit of it. */
export function contentRevision(design: Pick<Design, "width" | "height" | "pages">): string {
  const kept = known.get(design.pages);
  if (kept && kept.width === design.width && kept.height === design.height) return kept.revision;
  const h = new Hasher();
  feed(h, { width: design.width, height: design.height, pages: design.pages });
  const revision = `r1-${h.digest()}`;
  known.set(design.pages, { width: design.width, height: design.height, revision });
  return revision;
}

/** Where a design stands in a review, and whether that is about the content as it is now; null when no review was asked for. */
export function reviewOf(design: Design | null | undefined): { review: DesignReview; current: boolean } | null {
  const review = design?.review;
  if (!design || !review) return null;
  return { review, current: review.revision === contentRevision(design) };
}

/** The design without its review: for whoever does not share reviews (docs/REVIEW.md). The same design when it has none. */
export function withoutReview<T extends Design>(design: T): T {
  if (!("review" in design)) return design;
  const { review: _review, ...rest } = design;
  return rest as T;
}
