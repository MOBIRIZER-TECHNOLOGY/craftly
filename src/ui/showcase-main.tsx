/** Entry of the dev-only showcase page (showcase.html). */
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@/styles/tokens.css";
import "@/styles/base.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Showcase } from "./Showcase";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Showcase />
  </StrictMode>,
);
