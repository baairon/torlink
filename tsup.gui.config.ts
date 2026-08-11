import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/gui/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  // Electron supplies this module at runtime. Bundling its tiny JavaScript
  // launcher makes it look for the binary beside dist/gui instead of inside
  // node_modules/electron.
  external: ["electron"],
  outDir: "dist/gui",
  clean: false,
  sourcemap: false,
  dts: false,
  splitting: false,
  shims: false,
  minify: true,
});
