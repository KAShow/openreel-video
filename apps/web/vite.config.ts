import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { stripFfmpegPlugin } from "./vite-plugins/strip-ffmpeg";
import { pruneFontsPlugin } from "./vite-plugins/prune-fonts";
import { swBuildManifestPlugin } from "./vite-plugins/sw-build-manifest";
import { visualizer } from "rollup-plugin-visualizer";

const isDesktop = process.env.OPENREEL_DESKTOP === "1";
// Hawsh: `ANALYZE=1 pnpm build` writes dist-stats/bundle.html, a map of what each chunk contains.
// Development only: the report sits outside dist, so it is never deployed.
const analyzePlugins =
  process.env.ANALYZE === "1"
    ? [
        visualizer({ filename: "dist-stats/bundle.html", template: "treemap", gzipSize: true }),
        visualizer({ filename: "dist-stats/bundle.json", template: "raw-data", gzipSize: true }),
      ]
    : [];

function desktopHtmlPlugin() {
  return {
    name: "openreel-desktop-html",
    transformIndexHtml(html: string) {
      if (!isDesktop) return html;
      let out = html
        .replace(/href="\/favicon\.svg"/g, 'href="./favicon.svg"')
        .replace(/href="\/manifest\.json"/g, 'href="./manifest.json"')
        .replace(/href="\/icons\/icon-192\.png"/g, 'href="./icons/icon-192.png"');
      out = out.replace(
        /<link rel="preconnect"[^>]*>\s*/g,
        "",
      );
      out = out.replace(
        /<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g,
        '<link href="./fonts/google-fonts.css" rel="stylesheet" />',
      );
      return out;
    },
  };
}

export default defineConfig({
  base: isDesktop ? "./" : "/",
  plugins: [react(), desktopHtmlPlugin(), stripFfmpegPlugin(isDesktop), pruneFontsPlugin(isDesktop), ...(isDesktop ? [] : [swBuildManifestPlugin()]), ...analyzePlugins],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "@": path.resolve(__dirname, "./src"),
      "@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
      "@openreel/agent": path.resolve(__dirname, "../../packages/agent/src"),
      "@openreel/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core", "@ffmpeg/core-mt"],
  },
  build: {
    target: "esnext",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react";
          if (id.includes("node_modules/zustand")) return "zustand";
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@radix-ui")) return "radix";
        },
      },
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
