import { describe, expect, it } from "vitest";
import { contrastRatio, ensureReadable, parseColor } from "../theme";

describe("theme color helpers", () => {
  it("parses hex colors", () => {
    expect(parseColor("#0bf")).toEqual({ r: 0, g: 187, b: 255 });
    expect(parseColor("#0b0f12")).toEqual({ r: 11, g: 15, b: 18 });
  });

  it("parses rgb colors", () => {
    expect(parseColor("rgb(255, 0, 16)")).toEqual({ r: 255, g: 0, b: 16 });
  });

  it("ensures readable contrast", () => {
    const background = parseColor("#0b0f12")!;
    const base = parseColor("#0b0f12")!;
    const adjusted = ensureReadable(base, background, base, 4.5);
    expect(contrastRatio(adjusted, background)).toBeGreaterThanOrEqual(4.5);
  });
});
