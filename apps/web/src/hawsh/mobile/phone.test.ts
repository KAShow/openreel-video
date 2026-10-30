import { afterEach, describe, expect, it } from "vitest";
import { mobileUiEnabled } from "./phone";

afterEach(() => localStorage.removeItem("hawsh-mobile-ui"));

describe("mobileUiEnabled", () => {
  it("is on by default", () => {
    expect(mobileUiEnabled("")).toBe(true);
  });
  it("turns off with ?m=0, stays off, and comes back with ?m=1", () => {
    expect(mobileUiEnabled("?hk=x&m=0")).toBe(false);
    expect(mobileUiEnabled("")).toBe(false);
    expect(mobileUiEnabled("?m=1")).toBe(true);
    expect(mobileUiEnabled("")).toBe(true);
  });
  it("keeps it on for browsers that opted in during testing", () => {
    localStorage.setItem("hawsh-mobile-ui", "1");
    expect(mobileUiEnabled("")).toBe(true);
  });
});
