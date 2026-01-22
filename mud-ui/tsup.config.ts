import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "mud-overlay": "src/cockpit/index.tsx" },
  format: ["iife"],
  globalName: "MudOverlay",
  minify: true,
  sourcemap: true,
  target: "es2020",
  platform: "browser",
  splitting: false,
  clean: false,
  outDir: "../assets/js",
  treeshake: true,
  outExtension() {
    return { js: ".js" };
  },
  esbuildOptions(options) {
    options.define = {
      ...(options.define || {}),
      "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "production"),
    };
  },
});
