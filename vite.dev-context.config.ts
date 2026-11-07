import { mergeConfig } from "vite";
import base from "./vite.config";

/** Dev-only config for the context panels harness (dev-context.html). Port 5183, own dependency cache. */
export default mergeConfig(base, {
  cacheDir: "node_modules/.vite-context",
  server: { host: "127.0.0.1", port: 5183, strictPort: true },
});
