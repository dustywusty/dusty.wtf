import { describe, expect, it } from "vitest";
import { detectLineEffects } from "../effects";

describe("detectLineEffects", () => {
  it("marks death lines and disables grouping", () => {
    const result = detectLineEffects("You have been slain by a goblin.", "outl");
    expect(result).not.toBeNull();
    expect(result?.grouped).toBe(false);
    expect(result?.cls?.split(/\s+/)).toContain("death");
    expect(result?.lineClass).toBe("line-death");
  });

  it("ignores non-outl classes", () => {
    const result = detectLineEffects("You have been slain by a goblin.", "sys");
    expect(result).toBeNull();
  });
});
