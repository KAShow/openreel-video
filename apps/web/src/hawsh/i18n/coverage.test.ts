/**
 * Guards the Arabic UI against silent gaps. The page translator only matches whole English strings,
 * so a new or reworded label simply stays English. This scans the source for static English text
 * (JSX text and label / title / aria-label / placeholder / description / alt attributes) and fails
 * when one appears that neither the dictionary nor a pattern translates.
 *
 * Strings that are untranslated today are listed in coverage-baseline.json; the test only fails on
 * new ones. Fix a failure by adding the string to the dictionary (ar.ts), or, if it should stay
 * English (a brand, a font, a unit), to the baseline. To rewrite the baseline from the current source:
 *   UPDATE_I18N_BASELINE=1 pnpm --filter web vitest run src/hawsh/i18n/coverage
 *
 * Only single-line literals are seen; text built in code belongs in messages.ts instead.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { translateUi } from "./translate";

const SRC = resolve(__dirname, "../..");
const BASELINE = resolve(__dirname, "coverage-baseline.json");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "i18n") continue;
      sourceFiles(path, out);
    } else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) {
      out.push(path);
    }
  }
  return out;
}

const PROSE = /^[A-Z][A-Za-z0-9'’.,:;!?&()/\-–—·…%+ ]*[A-Za-z0-9.!?…)]$/;
const JSX_TEXT = />([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g;
const ATTRIBUTE = /\b(?:label|title|aria-label|placeholder|description|alt)="([^"{}\n]+)"/g;

function staticStrings(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const pattern of [JSX_TEXT, ATTRIBUTE]) {
      for (const match of text.matchAll(pattern)) {
        const value = match[1].trim();
        if (value.length > 1 && PROSE.test(value) && !found.has(value)) {
          found.set(value, relative(SRC, file).replace(/\\/g, "/"));
        }
      }
    }
  }
  return found;
}

describe("Arabic UI coverage", () => {
  const missing = [...staticStrings()].filter(([value]) => translateUi(value) === null);

  if (process.env.UPDATE_I18N_BASELINE) {
    it("rewrites the baseline", () => {
      const list = missing.map(([value]) => value).sort((a, b) => a.localeCompare(b));
      writeFileSync(BASELINE, `${JSON.stringify(list, null, 2)}\n`);
      expect(list.length).toBeGreaterThanOrEqual(0);
    });
    return;
  }

  it("finds no new static English string without a translation", () => {
    const known = new Set<string>(JSON.parse(readFileSync(BASELINE, "utf8")) as string[]);
    const fresh = missing
      .filter(([value]) => !known.has(value))
      .map(([value, file]) => `${file}: ${value}`);
    expect(fresh, "add these to ar.ts (or to coverage-baseline.json if they should stay English)").toEqual([]);
  });
});
