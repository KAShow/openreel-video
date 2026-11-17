/**
 * Hawsh (plan phase 5): lets the service worker forget files from earlier builds.
 *
 * Writes `asset-manifest.json` (every file this build put under `assets/`) and stamps `sw.js` with
 * an id made from that list. A new id means a changed `sw.js`, so each deploy installs and
 * activates the worker again, and on activate it deletes cached `/assets/` files that are not in
 * the manifest. Without this, every deploy left its old chunks in the phone's cache storage.
 */
import type { Plugin } from "vite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const BUILD_ID_PLACEHOLDER = "__HAWSH_BUILD_ID__";
export const ASSET_MANIFEST = "asset-manifest.json";

export function buildIdFor(files: string[]): string {
  return createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
}

export function stampServiceWorker(source: string, buildId: string): string {
  return source.split(BUILD_ID_PLACEHOLDER).join(buildId);
}

export function swBuildManifestPlugin(): Plugin {
  let outDir = "dist";
  let buildId = "";
  return {
    name: "hawsh-sw-build-manifest",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((file) => file.startsWith("assets/")).sort();
      buildId = buildIdFor(files);
      this.emitFile({ type: "asset", fileName: ASSET_MANIFEST, source: JSON.stringify({ buildId, files }) });
    },
    closeBundle() {
      const sw = join(outDir, "sw.js");
      if (!buildId || !existsSync(sw)) return;
      writeFileSync(sw, stampServiceWorker(readFileSync(sw, "utf8"), buildId));
    },
  };
}
