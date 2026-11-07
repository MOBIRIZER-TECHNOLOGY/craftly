/**
 * The whole <Editor> for the tests of the chrome around the canvas. It lives apart from `chromeUtils.tsx` because importing the
 * editor pulls in every panel, toolbar and the canvas, which the tests of a single piece of the chrome do not need.
 */
import { render, waitFor, type RenderResult } from "@testing-library/react";
import { expect } from "vitest";
import { saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { Editor } from "@/editor/Editor";
import { ConfirmHost, ToastHost } from "@/ui";
import { chromeDesign } from "./chromeUtils";
import { flush } from "./helpers";

/** The whole editor on `design`, with the toast and confirm hosts (`mountEditor` from helpers.tsx has neither). */
export async function mountFullEditor(design: Design = chromeDesign()): Promise<RenderResult & { design: Design }> {
  await saveDesign(design);
  const view = render(
    <>
      <Editor designId={design.id} />
      <ToastHost />
      <ConfirmHost />
    </>,
  );
  await waitFor(() => expect(useEditor.getState().design?.id).toBe(design.id), { timeout: 10_000 });
  await flush();
  return Object.assign(view, { design });
}
