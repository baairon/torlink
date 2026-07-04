import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  banner: { js: "#!/usr/bin/env node" },
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
  shims: false,
  minify: true,
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "react";
  },
});
