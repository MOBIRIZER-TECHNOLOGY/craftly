import { defineConfig, mergeConfig, transformWithEsbuild, type Plugin } from "vite";
import base from "./vite.config";

/**
 * Other packages (the template catalogue) are written while this harness is open. A half-written template file would
 * take the whole dashboard down, so a file under src/data/templates that does not compile is replaced - in this
 * dev server only - by empty lists for its exports, with a warning in the terminal.
 */
function tolerateBrokenTemplates(): Plugin {
  return {
    name: "dashboard-harness:tolerate-broken-templates",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0].replace(/\\/g, "/");
      if (!/\/src\/data\/templates\/[^/]+\.ts$/.test(file)) return null;
      try {
        await transformWithEsbuild(code, file, { loader: "ts" });
        return null;
      } catch {
        const names = [...code.matchAll(/^export\s+(?:const|let|function)\s+([A-Za-z0-9_$]+)/gm)].map((match) => match[1]);
        this.warn(`${file} does not compile; the harness serves empty lists for: ${names.join(", ") || "(no exports)"}`);
        return { code: `${names.map((name) => `export const ${name} = [];`).join("\n")}\nexport {};\n`, map: null };
      }
    },
  };
}

/** Dev server for the dashboard harness (dev-dashboard.html). Port 5186, own dependency cache. */
export default mergeConfig(
  base,
  defineConfig({
    plugins: [tolerateBrokenTemplates()],
    cacheDir: "node_modules/.vite-dashboard",
    // no hot reload: teammates edit other packages while pages are open, and a reload would restart a test run
    server: { host: "127.0.0.1", port: 5186, strictPort: true, hmr: false },
  }),
);
