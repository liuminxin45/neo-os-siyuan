import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: ".",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["cjs"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: (id) =>
        id === "siyuan" ||
        id === "zod" ||
        id.startsWith("node:") ||
        ["child_process", "crypto", "fs", "http", "https", "net", "path", "stream", "process", "url"].includes(id),
      output: {
        exports: "named",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "index.css";
          }
          return "assets/[name][extname]";
        },
      },
    },
  },
});
