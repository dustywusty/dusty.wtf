/* assets/js/mud-overlay.js
   Minimal WebSocket terminal overlay for browser-based MUD play.
   No deps. Works with a lazy loader that calls window.spawnMudOverlay(url).
*/
(() => {
  "use strict";

  const OVERLAY_ID = "mud-ws-overlay";
  const STYLE_ID = "mud-ws-style";
  const MAX_LINES = 5000; // prune DOM to avoid bloat
  const LS_KEY = "mud_ws_url";
  const MOUNT_SELECTOR = ".container.animate-fade-up";
  
  let controller = null; // singleton overlay controller
  let lastAnchor = null;

  // ---------- theme sync ----------
  const themeTargets = new Set();
  let themeObserver = null;
  let themeListenersBound = false;

  const clamp = (value, min = 0, max = 255) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
  const parseColor = (value) => {
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
  const toRgbString = (color, fallback) => {
    const base = color || fallback;
    if (!base) return "";
    return `rgb(${clamp(Math.round(base.r))}, ${clamp(Math.round(base.g))}, ${clamp(Math.round(base.b))})`;
  };
  const toRgbaString = (color, alpha = 1, fallback) => {
    const base = color || fallback;
    const a = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1);
    if (!base) return `rgba(0, 0, 0, ${a})`;
    return `rgba(${clamp(Math.round(base.r))}, ${clamp(Math.round(base.g))}, ${clamp(Math.round(base.b))}, ${a})`;
  };
  const mix = (a, b, amount) => {
    const c1 = a || FALLBACK.background;
    const c2 = b || FALLBACK.text;
    const t = clamp(Number.isFinite(amount) ? amount : 0, 0, 1);
    return {
      r: clamp(Math.round(c1.r + (c2.r - c1.r) * t)),
      g: clamp(Math.round(c1.g + (c2.g - c1.g) * t)),
      b: clamp(Math.round(c1.b + (c2.b - c1.b) * t)),
    };
  };
  const relativeLuminance = (color) => {
    const c = color || FALLBACK.text;
    const norm = [c.r, c.g, c.b].map((v) => {
      const srgb = clamp(v) / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * norm[0] + 0.7152 * norm[1] + 0.0722 * norm[2];
  };
  const DARK_INK = { r: 15, g: 17, b: 21 };
  const LIGHT_INK = { r: 255, g: 255, b: 255 };
  const pickInk = (color) => (relativeLuminance(color) > 0.55 ? DARK_INK : LIGHT_INK);
  const contrastRatio = (a, b) => {
    const l1 = relativeLuminance(a);
    const l2 = relativeLuminance(b);
    const light = Math.max(l1, l2);
    const dark = Math.min(l1, l2);
    return (light + 0.05) / (dark + 0.05);
  };
  const ensureReadable = (color, background, reference, minRatio = 4.5) => {
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
    background: parseColor("#0b0f12"),
    text: parseColor("#e6edf3"),
    accent: parseColor("#29e3c7"),
    accentInk: DARK_INK,
    error: parseColor("#ff7b72"),
    border: parseColor("#2d3741"),
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

  function applyThemeVars(target) {
    if (!target) return;
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

    // Export primary color for health bar
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

  function registerThemeTarget(target) {
    if (!target) return;
    themeTargets.add(target);
    applyThemeVars(target);
    ensureThemeWatcher();
  }

  // ---------- utils ----------
  const now = () => new Date().toLocaleTimeString();
  const el = (tag, attrs = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "style") Object.assign(n.style, v);
      else if (k.startsWith("on") && typeof v === "function") n[k] = v;
      else n.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      n.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return n;
  };

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
#${OVERLAY_ID}{
  position:fixed;
  right:12px;
  bottom:12px;
  width:min(700px,95vw);
  height:min(60vh,70vh);
  z-index:2147483647;
  font-family:ui-monospace,Menlo,Consolas,monospace;
  background:var(--mud-panel,var(--mud-bg,#0b0f12));
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:12px;
  box-shadow:0 12px 36px var(--mud-shadow,rgba(15,17,21,.6));
  display:flex;
  flex-direction:column;
  overflow:hidden;
  resize:both;
}
#${OVERLAY_ID} .head{
  display:flex;
  gap:8px;
  align-items:center;
  padding:10px;
  background:var(--mud-panel,#0f1419);
  border-bottom:1px solid var(--mud-border,#2d3741);
}
#${OVERLAY_ID} .status-panel{
  display:flex;
  flex-direction:column;
  gap:8px;
  padding:10px;
  background:var(--mud-panel,#0f1419);
  border-bottom:1px solid var(--mud-border,#2d3741);
  font-size:13px;
  color:var(--mud-text,#e6edf3);
}
#${OVERLAY_ID} .health-container{
  display:flex;
  align-items:center;
  gap:10px;
}
#${OVERLAY_ID} .health-text{
  min-width:100px;
  font-weight:600;
}
#${OVERLAY_ID} .level-text{
  min-width:100px;
  font-weight:600;
}
#${OVERLAY_ID} .xp-bar-bg{
  flex:1;
  height:12px;
  background:var(--mud-bg,#0b0f12);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:6px;
  overflow:hidden;
  position:relative;
}
#${OVERLAY_ID} .xp-bar{
  height:100%;
  background:var(--mud-sys,#fbbf24);
  transition:width 0.3s ease;
  border-radius:4px;
}
#${OVERLAY_ID} .level-container{
  display:flex;
  align-items:center;
  gap:10px;
}
#${OVERLAY_ID} .health-bar-bg{
  flex:1;
  height:12px;
  background:var(--mud-bg,#0b0f12);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:6px;
  overflow:hidden;
  position:relative;
}
#${OVERLAY_ID} .health-bar{
  height:100%;
  background:var(--mud-health-bar,#29e3c7);
  transition:width 0.3s ease, background-color 0.3s ease;
  border-radius:4px;
}
#${OVERLAY_ID} .area-text{
  opacity:0.8;
  font-size:12px;
}
#${OVERLAY_ID} .effects-text{
  font-size:12px;
  color:var(--mud-sys,#fbbf24);
}
#${OVERLAY_ID} .status{
  padding:6px 10px;
  border:1px solid var(--mud-border,#2d3741);
  border-radius:999px;
  background:var(--mud-bg,#0b0f12);
  color:var(--mud-status-idle,#9da7b3);
  font-size:13px;
  line-height:1;
  display:inline-flex;
  align-items:center;
  gap:6px;
  transition:color .15s ease,border-color .15s ease,background-color .15s ease;
}
#${OVERLAY_ID} .status.status-connecting{color:var(--mud-status-connecting,#d29922);}
#${OVERLAY_ID} .status.status-connected{color:var(--mud-status-connected,#3fb950);}
#${OVERLAY_ID} .status.status-error{
  color:var(--mud-status-error,#ff7b72);
  border-color:var(--mud-status-error,#ff7b72);
}
#${OVERLAY_ID} .url{
  flex:1;
  background:var(--mud-input-bg,#0b0f12);
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:10px;
  padding:8px 10px;
  font-size:13px;
  line-height:1.3;
  transition:border-color .15s ease,box-shadow .15s ease;
}
#${OVERLAY_ID} .url:focus-visible{
  outline:none;
  border-color:var(--mud-border-strong,#3b4855);
  box-shadow:0 0 0 3px var(--mud-focus-ring,rgba(41,227,199,.35));
}
#${OVERLAY_ID} .btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  background:var(--mud-btn-bg,#192129);
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-btn-border,#2d3741);
  border-radius:10px;
  padding:8px 12px;
  font-size:13px;
  line-height:1.1;
  cursor:pointer;
  transition:background-color .15s ease,border-color .15s ease,color .15s ease,transform .1s ease;
}
#${OVERLAY_ID} .btn:hover{
  background:var(--mud-btn-hover-bg,#1f2a33);
  border-color:var(--mud-border-strong,#3b4855);
}
#${OVERLAY_ID} .btn:focus-visible{
  outline:none;
  border-color:var(--mud-border-strong,#3b4855);
  box-shadow:0 0 0 3px var(--mud-focus-ring,rgba(41,227,199,.35));
}
#${OVERLAY_ID} .btn:active{transform:translateY(1px);}
#${OVERLAY_ID} .btn-primary{
  background:var(--mud-btn-primary-bg,#1f4b47);
  border-color:var(--mud-btn-primary-border,#2e605a);
  color:var(--mud-btn-primary-text,#0f1115);
}
#${OVERLAY_ID} .btn-primary:hover{
  background:var(--mud-btn-primary-hover-bg,#225f58);
  border-color:var(--mud-btn-primary-hover-border,var(--mud-btn-primary-border,#2e605a));
}
#${OVERLAY_ID} .btn-muted{
  background:transparent;
  color:var(--mud-text-muted,#9da7b3);
  border-color:var(--mud-border,#2d3741);
}
#${OVERLAY_ID} .btn-muted:hover{
  background:var(--mud-panel-strong,var(--mud-panel,#0f1419));
  color:var(--mud-text,#e6edf3);
}
#${OVERLAY_ID} .btn-icon{
  width:40px;
  padding:8px 0;
  display:flex;
  align-items:center;
  justify-content:center;
}
#${OVERLAY_ID} .out{
  white-space:pre-wrap;
  line-height:1.35;
  padding:12px 14px;
  height:100%;
  overflow:auto;
  font-size:13px;
  background:var(--mud-bg,#0b0f12);
  border-bottom:1px solid var(--mud-border,#2d3741);
}
#${OVERLAY_ID} .line{
  display:grid;
  grid-template-columns:max-content 1fr;
  align-items:flex-start;
  gap:12px;
  padding:2px 0;
}
#${OVERLAY_ID} .ts{
  color:var(--mud-text-muted,#9da7b3);
  font-size:12px;
  font-variant-numeric:tabular-nums;
  min-width:var(--mud-ts-min-width,11ch);
  text-align:right;
  white-space:nowrap;
  padding-top:2px;
}
#${OVERLAY_ID} .msg{
  white-space:pre-wrap;
  word-break:break-word;
}
#${OVERLAY_ID} .line-death{
  position:relative;
  padding:6px 10px;
  margin:6px -6px;
  border-radius:10px;
  overflow:hidden;
}
#${OVERLAY_ID} .line-death::before{
  content:"";
  position:absolute;
  inset:0;
  background:var(--mud-death-bg,rgba(255,123,114,.16));
  border-left:3px solid var(--mud-death-border,rgba(255,123,114,.45));
  border-radius:10px;
  box-shadow:0 6px 20px rgba(255,123,114,.25);
  pointer-events:none;
}
#${OVERLAY_ID} .line-death > *{
  position:relative;
}
#${OVERLAY_ID} .line-death .ts{
  color:var(--mud-death-text,var(--mud-err,#ff7b72));
}
#${OVERLAY_ID} .line-death .msg{
  color:var(--mud-death-text,var(--mud-err,#ff7b72));
}
#${OVERLAY_ID} .msg.death{
  font-weight:600;
  text-shadow:0 0 12px rgba(255,123,114,.4);
}
#${OVERLAY_ID} .out::-webkit-scrollbar{width:10px;}
#${OVERLAY_ID} .out::-webkit-scrollbar-thumb{
  background:var(--mud-scroll-thumb,rgba(150,150,150,.35));
  border-radius:999px;
}
#${OVERLAY_ID} .in{
  display:grid;
  grid-template-columns:1fr auto auto;
  gap:8px;
  padding:10px;
  border-top:1px solid var(--mud-border,#2d3741);
  background:var(--mud-panel-strong,var(--mud-panel,#0f1419));
}
#${OVERLAY_ID} textarea{
  height:56px;
  resize:none;
  background:var(--mud-input-bg,#0b0f12);
  color:var(--mud-text,#e6edf3);
  border:1px solid var(--mud-border,#2d3741);
  border-radius:10px;
  padding:10px;
  font:13px/1.3 inherit;
  transition:border-color .15s ease,box-shadow .15s ease;
}
#${OVERLAY_ID} textarea:focus-visible{
  outline:none;
  border-color:var(--mud-border-strong,#3b4855);
  box-shadow:0 0 0 3px var(--mud-focus-ring,rgba(41,227,199,.35));
}
#${OVERLAY_ID} .sys{color:var(--mud-sys,#9da7b3);}
#${OVERLAY_ID} .err{color:var(--mud-err,#ff7b72);}
#${OVERLAY_ID} .inl{color:var(--mud-in,#79c0ff);}
#${OVERLAY_ID} .outl{color:var(--mud-text,#e6edf3);}
#${OVERLAY_ID} .gap{
  margin:8px 0;
  border-top:1px dashed var(--mud-gap-color,rgba(100,110,120,.4));
}
#${OVERLAY_ID}.embedded{
  position:static;
  right:auto;
  bottom:auto;
  width:100%;
  max-width:none;
  height:60vh;
  margin:16px 0 0;
  resize:vertical;
  box-shadow:none;
}`;
    const style = el("style", { id: STYLE_ID }, css);
    document.head.appendChild(style);
  }

  // ---------- overlay builder ----------
  function extractUrlFromLink(link) {
    if (!link) return "";
    const explicit = link.getAttribute("data-mud-ws") || link.getAttribute("data-mud") || "";
    if (explicit) return explicit;
    const href = link.getAttribute("href") || "";
    if (/^wss?:\/\//i.test(href)) return href;
    const path = link.getAttribute("data-mud-path");
    if (path) {
      const base = location.protocol === "https:" ? "wss://" : "ws://";
      return `${base}${location.host}${path}`;
    }
    return "";
  }

  function placeOverlay(root, anchor) {
    const usableAnchor = anchor && anchor.nodeType === 1 && anchor.isConnected ? anchor : null;
    let inserted = false;
    if (usableAnchor) {
      const block = usableAnchor.closest(
        "[data-mud-mount],p,div,section,article,li,dd,dt,main,aside,header,footer,figure"
      );
      if (block && block.parentNode) {
        block.insertAdjacentElement("afterend", root);
        root.classList.add("embedded");
        inserted = true;
      }
    }
    if (!inserted) {
      const fallback = document.querySelector(MOUNT_SELECTOR) || document.body;
      if (root.parentNode !== fallback) {
        fallback.appendChild(root);
      }
      if (fallback === document.body) root.classList.remove("embedded");
      else root.classList.add("embedded");
    }
    lastAnchor = inserted ? usableAnchor : null;
  }

  function buildOverlay(anchor) {
    ensureStyles();

    let root = document.getElementById(OVERLAY_ID);
    if (!root) {
      root = el("div", { id: OVERLAY_ID });
    }

    placeOverlay(root, anchor);

    registerThemeTarget(root);

    root.innerHTML = ""; // clean slate
    // Header
    const statusEl = el("span", { class: "status status-idle", role: "status", "aria-live": "polite" }, "● disconnected");
    const savedUrl = localStorage.getItem(LS_KEY) || "";
    const contextualLink =
      anchor && anchor.isConnected
        ? anchor
        : document.querySelector('a[data-mud],a[data-mud-ws],a[href^="ws"],a[href^="wss"],[data-mud-mount]');
    const linkUrl = savedUrl || extractUrlFromLink(contextualLink) || "";
    const urlEl = el("input", {
      class: "url",
      type: "text",
      placeholder: "ws://host:port/path",
      value: linkUrl,
    });
    const btnConn = el("button", { class: "btn btn-primary", type: "button" }, "Connect");
    const btnClose = el(
      "button",
      { class: "btn btn-icon btn-muted", type: "button", title: "Close overlay", "aria-label": "Close overlay" },
      "✕"
    );

    const head = el("div", { class: "head" }, [statusEl, urlEl, btnConn, btnClose]);

    // Player status panel
    const healthBar = el("div", { class: "health-bar" });
    const healthBarBg = el("div", { class: "health-bar-bg" }, [healthBar]);
    const healthText = el("span", { class: "health-text" }, "HP: --/--");
    const xpBar = el("div", { class: "xp-bar" });
    const xpBarBg = el("div", { class: "xp-bar-bg" }, [xpBar]);
    const levelText = el("span", { class: "level-text" }, "Level --");
    const areaText = el("span", { class: "area-text" }, "");
    const effectsText = el("span", { class: "effects-text" }, "");
    const statusPanel = el("div", { class: "status-panel" }, [
      el("div", { class: "health-container" }, [healthText, healthBarBg]),
      el("div", { class: "level-container" }, [levelText, xpBarBg]),
      areaText,
      effectsText,
    ]);
    statusPanel.style.display = "none";

    // Output + input
    const out = el("div", { class: "out" });
    const input = el("textarea", { class: "input", placeholder: "Type… (Enter=send, Ctrl+Enter=newline, /clear, /help)" });
    const btnSend = el("button", { class: "btn btn-primary", type: "button" }, "Send");
    const btnClear = el("button", { class: "btn btn-muted", type: "button" }, "Clear");
    const inputBar = el("div", { class: "in" }, [input, btnSend, btnClear]);

    root.appendChild(head);
    root.appendChild(statusPanel);
    root.appendChild(out);
    root.appendChild(inputBar);

    // State
    let ws = null;
    let history = [];
    let idx = -1;

    // helpers
    const setStatus = (txt, state = "idle") => {
      statusEl.textContent = `● ${txt}`;
      statusEl.className = `status${state ? ` status-${state}` : ""}`;
    };
    setStatus("disconnected", "idle");
    // Coalesce fast bursts (e.g., multi-line help) into one timestamped block.
    let grpBuf = [];
    let grpCls = null;
    let grpStamp = null;
    let grpTimer = null;
    const FLUSH_MS = 80;
    const resetGroup = () => {
      grpBuf = [];
      grpCls = null;
      grpStamp = null;
      if (grpTimer) {
        clearTimeout(grpTimer);
        grpTimer = null;
      }
    };
    const pushLine = (cls, text, timestamp = now(), lineClass = "") => {
      while (out.childElementCount > MAX_LINES) out.removeChild(out.firstChild);
      const msgClass = cls ? `msg ${cls}` : "msg";
      const classes = ["line"];
      if (lineClass) classes.push(lineClass);
      else if (cls && String(cls).split(/\s+/).includes("death")) classes.push("line-death");
      const line = el("div", { class: classes.join(" ") }, [
        el("div", { class: "ts" }, timestamp),
        el("div", { class: msgClass }, text),
      ]);
      out.appendChild(line);
      out.scrollTop = out.scrollHeight;
    };
    const flushGroup = () => {
      if (!grpBuf.length) return;
      const stamp = grpStamp || now();
      grpBuf.forEach((msg, idx) => {
        pushLine(grpCls || "outl", msg, idx === 0 ? stamp : "");
      });
      resetGroup();
    };
    const deathMatchers = [
      /\bhas been slain\b/i,
      /\bhas slain you\b/i,
      /\bhas killed you\b/i,
      /\byou have been slain\b/i,
      /\byou have been killed\b/i,
      /\byou were slain\b/i,
      /\byou were killed\b/i,
      /\byou got slain\b/i,
      /\byou got killed\b/i,
      /\byou have died\b/i,
      /\byou died\b/i,
      /\byou are dead\b/i,
      /\byou are slain\b/i,
      /\byou have perished\b/i,
    ];
    const detectLineEffects = (text, cls) => {
      if (!text || !cls) return null;
      const baseCls = String(cls).trim();
      if (!baseCls.split(/\s+/).includes("outl")) return null;
      const message = String(text);
      if (!message.trim()) return null;
      if (deathMatchers.some((pattern) => pattern.test(message))) {
        const classes = baseCls ? baseCls.split(/\s+/) : [];
        if (!classes.includes("death")) classes.push("death");
        return { cls: classes.join(" "), lineClass: "line-death", grouped: false };
      }
      return null;
    };
    const append = (text, cls = "outl", grouped = true) => {
      let effectiveCls = cls;
      let lineClass = "";
      let useGrouping = grouped && cls === "outl";
      const special = cls === "outl" ? detectLineEffects(text, cls) : null;
      if (special) {
        effectiveCls = special.cls || effectiveCls;
        lineClass = special.lineClass || lineClass;
        if (special.grouped === false) useGrouping = false;
      }
      const normalizedCls = String(effectiveCls || "").trim();
      const canGroup = useGrouping && normalizedCls === "outl";
      if (canGroup) {
        if (grpCls && grpCls !== normalizedCls) flushGroup();
        grpCls = normalizedCls;
        if (!grpStamp) grpStamp = now();
        grpBuf.push(String(text));
        if (grpTimer) clearTimeout(grpTimer);
        grpTimer = setTimeout(flushGroup, FLUSH_MS);
        return;
      }
      flushGroup();
      pushLine(effectiveCls, text, undefined, lineClass);
    };
    const disconnect = () => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, "client closing");
    };

    const closeOverlay = () => {
      disconnect();
      themeTargets.delete(root);
      root.remove();
    };

    const connect = () => {
      const url = (urlEl.value || "").trim();
      if (!url) {
        append("No WebSocket URL provided.", "err");
        return;
      }
      try {
        ws?.close();
      } catch {}
      setStatus("connecting", "connecting");
      append(`Connecting to ${url} …`, "sys");
      ws = new WebSocket(url);
      localStorage.setItem(LS_KEY, url);

      ws.addEventListener("open", (ev) => {
        console.log("[mud ws] open", ev);
        flushGroup();
        setStatus("connected", "connected");
        btnConn.textContent = "Disconnect";
        append("Connected.", "sys");
        input.focus();
      });
      const updateStatus = (stateMsg) => {
        // Parse STATE|HP:450/600|LEVEL:5|XP:120/250|AREA:Town Square|EFFECTS:Guard's Blessing:500
        const parts = stateMsg.split("|");
        let hp = null, level = null, xp = null, area = null, effects = [];

        for (const part of parts) {
          if (part.startsWith("HP:")) {
            hp = part.substring(3);
          } else if (part.startsWith("LEVEL:")) {
            level = part.substring(6);
          } else if (part.startsWith("XP:")) {
            xp = part.substring(3);
          } else if (part.startsWith("AREA:")) {
            area = part.substring(5);
          } else if (part.startsWith("EFFECTS:")) {
            const effectsStr = part.substring(8);
            effects = effectsStr.split(",").filter(e => e);
          }
        }

        if (hp) {
          const [current, max] = hp.split("/").map(n => parseInt(n, 10));
          healthText.textContent = `HP: ${current}/${max}`;
          const percent = max > 0 ? (current / max) * 100 : 0;
          healthBar.style.width = `${percent}%`;

          // Use MUD theme primary color for full health, then yellow/red as it drops
          if (percent > 66) {
            healthBar.style.backgroundColor = ""; // Clear inline style to use CSS default (--mud-health-bar)
          } else if (percent > 33) {
            healthBar.style.backgroundColor = "#fbbf24"; // yellow
          } else {
            healthBar.style.backgroundColor = "#ef4444"; // red
          }
        }

        if (level) {
          levelText.textContent = `Level ${level}`;
        }

        if (xp) {
          const [current, required] = xp.split("/").map(n => parseInt(n, 10));
          const percent = required > 0 ? (current / required) * 100 : 0;
          xpBar.style.width = `${percent}%`;
        }

        if (area) {
          areaText.textContent = `📍 ${area}`;
        }

        if (effects.length > 0) {
          const effectsList = effects.map(e => {
            const [name, bonus] = e.split(":");
            return `${name} (+${bonus} HP)`;
          }).join(", ");
          effectsText.textContent = `✨ ${effectsList}`;
        } else {
          effectsText.textContent = "";
        }

        statusPanel.style.display = "block";
      };

      ws.addEventListener("message", async (ev) => {
        console.log("[mud ws] message", ev);
        try {
          let s;
          if (typeof ev.data === "string") s = ev.data;
          else if (ev.data instanceof Blob) s = await ev.data.text();
          else if (ev.data instanceof ArrayBuffer) {
            append(`[binary ${ev.data.byteLength} bytes]`, "sys");
            return;
          } else {
            append("[unknown message type]", "sys");
            return;
          }
          if (!s) return;

          // Check if it's a STATE message
          if (s.startsWith("STATE|")) {
            updateStatus(s);
            return;
          }

          append(s, "outl");
        } catch (e) {
          append("Message handling error: " + (e?.message || e), "err");
        }
      });
      ws.addEventListener("error", (e) => {
        console.log("[mud ws] error", e);
        flushGroup();
        setStatus("error", "error");
        append("WebSocket error.", "err");
      });
      ws.addEventListener("close", (e) => {
        console.log("[mud ws] close", e);
        flushGroup();
        setStatus("disconnected", "idle");
        btnConn.textContent = "Connect";
        append(`Disconnected (code ${e.code}).`, "sys");
      });
    };
    const addGap = () => {
      const last = out.lastElementChild;
      if (last && last.classList && last.classList.contains("gap")) return;
      out.appendChild(el("div", { class: "gap" }));
      out.scrollTop = out.scrollHeight;
    };

    const send = () => {
      const text = input.value;
      if (!text.trim()) {
        // nothing meaningful
        input.value = "";
        return;
      }
      history.push(text);
      idx = history.length;
      flushGroup();
      addGap(); // isolate commands with a leading gap
      append(text, "inl");
      addGap(); // visual gap without a timestamp
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        append("Not connected.", "err");
        return;
      }
      ws.send(text);
      input.value = "";
    };

    const handleSlash = (v) => {
      const t = v.trim();
      if (t === "/clear") {
        resetGroup();
        out.innerHTML = "";
        return true;
      }
      if (t === "/help") {
        append("Commands: /clear, /help", "sys");
        return true;
      }
      return false;
    };

    // events
    btnConn.addEventListener("click", () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        btnConn.textContent = "Connect";
        disconnect();
      } else connect();
    });

    btnClose.addEventListener("click", closeOverlay);

    btnSend.addEventListener("click", send);
    btnClear.addEventListener("click", () => {
      resetGroup();
      out.innerHTML = "";
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const v = input.value;
        if (v.trim().startsWith("/")) {
          if (handleSlash(v)) {
            input.value = "";
            return;
          }
        }
        send();
      }
      if (e.key === "Escape") {
        closeOverlay();
      }
      if (e.key === "ArrowUp") {
        if (idx > 0) {
          idx--;
          input.value = history[idx] || "";
          e.preventDefault();
        }
      } else if (e.key === "ArrowDown") {
        if (idx < history.length - 1) {
          idx++;
          input.value = history[idx] || "";
        } else {
          idx = history.length;
          input.value = "";
        }
        e.preventDefault();
      }
    });

    window.addEventListener("beforeunload", () => {
      try {
        ws?.close();
      } catch {}
    });

    // controller API for external callers
    return {
      root,
      connect,
      disconnect,
      setUrl: (u) => {
        urlEl.value = u || "";
      },
      focus: () => input.focus(),
      place: (nextAnchor) => placeOverlay(root, nextAnchor || lastAnchor),
    };
  }

  // ---------- public API ----------
  function spawn(initialUrl, options) {
    const anchor = options && options.anchor && options.anchor.nodeType === 1 ? options.anchor : lastAnchor;
    const deferConnect = !!(options && options.deferConnect);
    // build or reuse
    if (!controller || !document.body.contains(controller.root)) {
      controller = buildOverlay(anchor);
    } else {
      controller.root.style.display = "";
      controller.place(anchor);
    }

    // bring to front
    const baseZ = parseInt(getComputedStyle(controller.root).zIndex || "2147483647", 10);
    controller.root.style.zIndex = String(baseZ + 1);

    if (initialUrl) controller.setUrl(initialUrl);
    if (!deferConnect) {
      controller.connect();
    }
    controller.focus();
    return controller;
  }

  // Optional: support `document.dispatchEvent(new CustomEvent('mud:spawn', { detail: { url } }))`
  document.addEventListener(
    "mud:spawn",
    (e) => spawn(e?.detail?.url, e?.detail?.anchor ? { anchor: e.detail.anchor } : undefined),
    { passive: true }
  );

  // Expose for the lazy loader
  window.spawnMudOverlay = window.spawnMudOverlay || spawn;
})();
