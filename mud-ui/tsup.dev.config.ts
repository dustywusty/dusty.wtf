import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["dev/main.tsx"],
  format: ["esm"],
  target: "es2020",
  sourcemap: true,
  minify: false,
  splitting: false,
  dts: false,
  clean: false,
  outDir: "dev/dist",
  noExternal: [/.*/], // bundle everything
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
  },
});