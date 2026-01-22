const DARK_INK = { r: 15, g: 17, b: 21 } as const;
const LIGHT_INK = { r: 255, g: 255, b: 255 } as const;

type Color = { r: number; g: number; b: number };

const themeTargets = new Set<HTMLElement>();
let themeObserver: MutationObserver | null = null;
let themeListenersBound = false;

const clamp = (value: number, min = 0, max = 255) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

const parseColor = (value: string | number | null | undefined): Color | null => {
  if (!value && value !== 0) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.startsWith("#")) {
    let hex = raw.slice(1);
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if ([r, g, b].every((c) => Number.isFinite(c))) return { r, g, b };
    }
    return null;
  }
  const rgb = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (rgb) {
    return {
      r: clamp(Math.round(parseFloat(rgb[1]))),
      g: clamp(Math.round(parseFloat(rgb[2]))),
      b: clamp(Math.round(parseFloat(rgb[3]))),
    };
  }
  return null;
};

const toRgbString = (color: Color | null | undefined, fallback?: Color) => {
  const base = color || fallback;
  if (!base) return "";
  return `rgb(${clamp(Math.round(base.r))}, ${clamp(Math.round(base.g))}, ${clamp(Math.round(base.b))})`;
};

const toRgbaString = (color: Color | null | undefined, alpha = 1, fallback?: Color) => {
  const base = color || fallback;
  const a = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
  if (!base) return `rgba(0, 0, 0, ${a})`;
  return `rgba(${clamp(Math.round(base.r))}, ${clamp(Math.round(base.g))}, ${clamp(Math.round(base.b))}, ${a})`;
};

const mix = (a: Color | null | undefined, b: Color | null | undefined, amount: number): Color => {
  const c1 = a || FALLBACK.background;
  const c2 = b || FALLBACK.text;
  const t = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
  return {
    r: clamp(Math.round(c1.r + (c2.r - c1.r) * t)),
    g: clamp(Math.round(c1.g + (c2.g - c1.g) * t)),
    b: clamp(Math.round(c1.b + (c2.b - c1.b) * t)),
  };
};

const relativeLuminance = (color: Color | null | undefined) => {
  const c = color || FALLBACK.text;
  const norm = [c.r, c.g, c.b].map((v) => {
    const srgb = clamp(v) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * norm[0] + 0.7152 * norm[1] + 0.0722 * norm[2];
};

const pickInk = (color: Color | null | undefined) => (relativeLuminance(color) > 0.55 ? DARK_INK : LIGHT_INK);

const contrastRatio = (a: Color | null | undefined, b: Color | null | undefined) => {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
};

const ensureReadable = (
  color: Color | null | undefined,
  background: Color | null | undefined,
  reference: Color | null | undefined,
  minRatio = 4.5
) => {
  const bg = background || FALLBACK.background;
  const base = color || reference || FALLBACK.text;
  if (contrastRatio(base, bg) >= minRatio) return base;
  const target = reference || pickInk(bg);
  const steps = [0.25, 0.5, 0.75, 1];
  for (const step of steps) {
    const candidate = mix(base, target, step);
    if (contrastRatio(candidate, bg) >= minRatio) return candidate;
  }
  return pickInk(bg);
};

const FALLBACK = {
  background: parseColor("#0b0f12")!,
  text: parseColor("#e6edf3")!,
  accent: parseColor("#29e3c7")!,
  accentInk: DARK_INK,
  error: parseColor("#ff7b72")!,
  border: parseColor("#2d3741")!,
};

function computePalette() {
  const style = getComputedStyle(document.documentElement);
  const background = parseColor(style.getPropertyValue("--background-color")) || FALLBACK.background;
  const text = parseColor(style.getPropertyValue("--font-color")) || FALLBACK.text;
  const accent =
    parseColor(style.getPropertyValue("--accent")) ||
    parseColor(style.getPropertyValue("--primary-color")) ||
    FALLBACK.accent;
  const accentInk = parseColor(style.getPropertyValue("--accent-ink")) || (accent ? pickInk(accent) : FALLBACK.accentInk);
  const error = parseColor(style.getPropertyValue("--error-color")) || FALLBACK.error;
  return { background, text, accent, accentInk, error };
}

function applyThemeVars(target: HTMLElement) {
  const { background: bg, text, accent, accentInk, error } = computePalette();
  const surface = mix(bg, text, 0.08);
  const panel = mix(bg, text, 0.14);
  const panelStrong = mix(bg, text, 0.18);
  const border = mix(bg, text, 0.22);
  const borderStrong = mix(bg, text, 0.34);
  const inputBg = mix(bg, text, 0.1);
  const textMuted = mix(text, bg, 0.5);
  const sys = mix(text, accent, 0.35);
  const inbound = mix(accent, text, 0.45);
  const gap = mix(bg, text, 0.2);
  const btnBg = mix(bg, text, 0.14);
  const btnHoverBg = mix(bg, text, 0.22);
  const btnBorder = border;
  const btnPrimaryBg = mix(bg, accent, 0.42);
  const btnPrimaryHoverBg = mix(bg, accent, 0.52);
  const btnPrimaryBorder = mix(btnPrimaryBg, accent, 0.3);
  const btnPrimaryHoverBorder = mix(btnPrimaryHoverBg, accent, 0.35);
  const focusRing = mix(accent, text, 0.3);
  const statusIdle = mix(text, bg, 0.45);
  const statusConnecting = mix(accent, text, 0.6);
  const statusConnected = mix(accent, text, 0.4);
  const shadow = mix(text, bg, 0.12);
  const scrollThumb = mix(text, bg, 0.7);
  const deathSurface = mix(bg, error, 0.18);
  const deathBorder = mix(error, text, 0.4);

  const readableDeath = ensureReadable(error, deathSurface, error, 4.5);

  const readableText = ensureReadable(text, panel, text, 4.5);
  const readableMuted = ensureReadable(textMuted, panel, readableText, 3.2);
  const readableSys = ensureReadable(sys, surface, readableText, 4.5);
  const readableInbound = ensureReadable(inbound, surface, readableText, 4.5);
  const readableError = ensureReadable(error, surface, readableText, 4.5);
  const readableStatusIdle = ensureReadable(statusIdle, surface, readableMuted, 3.5);
  const readableStatusConnecting = ensureReadable(statusConnecting, surface, readableSys, 4.5);
  const readableStatusConnected = ensureReadable(statusConnected, surface, readableSys, 4.5);
  const readableStatusError = ensureReadable(error, surface, readableError, 4.5);
  const readablePrimaryText = ensureReadable(accentInk, btnPrimaryBg, pickInk(btnPrimaryBg), 4.5);

  target.style.setProperty("--mud-bg", toRgbString(surface, FALLBACK.background));
  target.style.setProperty("--mud-panel", toRgbString(panel, FALLBACK.background));
  target.style.setProperty("--mud-panel-strong", toRgbString(panelStrong, FALLBACK.background));
  target.style.setProperty("--mud-input-bg", toRgbString(inputBg, FALLBACK.background));
  target.style.setProperty("--mud-border", toRgbString(border, FALLBACK.border));
  target.style.setProperty("--mud-border-strong", toRgbString(borderStrong, FALLBACK.border));
  target.style.setProperty("--mud-text", toRgbString(readableText, FALLBACK.text));
  target.style.setProperty("--mud-text-muted", toRgbString(readableMuted, FALLBACK.text));
  target.style.setProperty("--mud-sys", toRgbString(readableSys, FALLBACK.text));
  target.style.setProperty("--mud-in", toRgbString(readableInbound, FALLBACK.accent));
  target.style.setProperty("--mud-err", toRgbString(readableError, FALLBACK.error));
  target.style.setProperty("--mud-btn-bg", toRgbString(btnBg, FALLBACK.background));
  target.style.setProperty("--mud-btn-hover-bg", toRgbString(btnHoverBg, FALLBACK.background));
  target.style.setProperty("--mud-btn-border", toRgbString(btnBorder, FALLBACK.border));
  target.style.setProperty("--mud-btn-primary-bg", toRgbString(btnPrimaryBg, FALLBACK.accent));
  target.style.setProperty("--mud-btn-primary-hover-bg", toRgbString(btnPrimaryHoverBg, FALLBACK.accent));
  target.style.setProperty("--mud-btn-primary-border", toRgbString(btnPrimaryBorder, FALLBACK.accent));
  target.style.setProperty("--mud-btn-primary-hover-border", toRgbString(btnPrimaryHoverBorder, FALLBACK.accent));
  target.style.setProperty("--mud-btn-primary-text", toRgbString(readablePrimaryText, FALLBACK.accentInk));
  target.style.setProperty("--mud-health-bar", toRgbString(accent, FALLBACK.accent));
  target.style.setProperty("--mud-status-idle", toRgbString(readableStatusIdle, FALLBACK.text));
  target.style.setProperty("--mud-status-connecting", toRgbString(readableStatusConnecting, FALLBACK.accent));
  target.style.setProperty("--mud-status-connected", toRgbString(readableStatusConnected, FALLBACK.accent));
  target.style.setProperty("--mud-status-error", toRgbString(readableStatusError, FALLBACK.error));
  target.style.setProperty("--mud-gap-color", toRgbString(gap, FALLBACK.border));
  target.style.setProperty("--mud-shadow", toRgbaString(shadow, 0.35, FALLBACK.text));
  target.style.setProperty("--mud-scroll-thumb", toRgbaString(scrollThumb, 0.4, FALLBACK.text));
  target.style.setProperty("--mud-focus-ring", toRgbaString(focusRing, 0.35, FALLBACK.accent));
  target.style.setProperty("--mud-death-bg", toRgbaString(deathSurface, 0.4, FALLBACK.error));
  target.style.setProperty("--mud-death-border", toRgbaString(deathBorder, 0.85, FALLBACK.error));
  target.style.setProperty("--mud-death-text", toRgbString(readableDeath, FALLBACK.error));
  target.style.setProperty("--primary", toRgbString(accent, FALLBACK.accent));
}

function refreshThemeTargets() {
  for (const target of Array.from(themeTargets)) {
    if (!target || !target.isConnected) {
      themeTargets.delete(target);
      continue;
    }
    applyThemeVars(target);
  }
}

function ensureThemeWatcher() {
  const root = document.documentElement;
  if (!themeObserver) {
    themeObserver = new MutationObserver(refreshThemeTargets);
    themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme", "style"] });
  }
  if (!themeListenersBound) {
    themeListenersBound = true;
    try {
      const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
      if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", refreshThemeTargets);
      else if (mq && typeof mq.addListener === "function") mq.addListener(refreshThemeTargets);
    } catch {}
    window.addEventListener(
      "storage",
      (e) => {
        if (!e) return;
        if (e.key === "site:theme" || e.key === "site:accent" || e.key === "site:accentInk") refreshThemeTargets();
      },
      { passive: true }
    );
  }
}

export function registerThemeTarget(target: HTMLElement) {
  themeTargets.add(target);
  applyThemeVars(target);
  ensureThemeWatcher();
}

export function unregisterThemeTarget(target: HTMLElement) {
  themeTargets.delete(target);
}

export { parseColor, ensureReadable, contrastRatio, mix };
