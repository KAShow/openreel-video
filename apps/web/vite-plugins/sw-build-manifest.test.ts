import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD_ID_PLACEHOLDER, buildIdFor, stampServiceWorker } from "./sw-build-manifest";

describe("service worker build stamp", () => {
  it("changes the id when the build's files change, and only then", () => {
    const a = buildIdFor(["assets/index-1.js", "assets/react-1.js"]);
    expect(buildIdFor(["assets/index-1.js", "assets/react-1.js"])).toBe(a);
    expect(buildIdFor(["assets/index-2.js", "assets/react-1.js"])).not.toBe(a);
  });

  it("stamps every placeholder in sw.js", () => {
    const sw = readFileSync(join(__dirname, "../public/sw.js"), "utf8");
    expect(sw).toContain(BUILD_ID_PLACEHOLDER);
    const stamped = stampServiceWorker(sw, "abc123");
    expect(stamped).not.toContain(BUILD_ID_PLACEHOLDER);
    expect(stamped).toContain("abc123");
  });
});
