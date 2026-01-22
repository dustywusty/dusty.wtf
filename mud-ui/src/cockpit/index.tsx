/// <reference types="react" />
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { createRoot, Root } from "react-dom/client";

const OVERLAY_ID = "mud-ws-overlay";
const STYLE_ID = "mud-ws-style";
const MAX_LINES = 5000;
const LS_KEY = "mud_ws_url";
const MOUNT_SELECTOR = ".container.animate-fade-up";

const DARK_INK = { r: 15, g: 17, b: 21 } as const;
const LIGHT_INK = { r: 255, g: 255, b: 255 } as const;

type StatusState = "idle" | "connecting" | "connected" | "error";
type MessageKind = "line" | "gap";

type Color = { r: number; g: number; b: number };

interface MessageLine {
  kind: "line";
  id: number;
  ts?: string;
  text: string;
  cls: string;
  lineClass?: string;
}

interface MessageGap {
  kind: "gap";
  id: number;
}

type Message = MessageLine | MessageGap;

interface MudOverlayHandle {
  connect(): void;
  disconnect(): void;
  setUrl(url: string): void;
  focus(): void;
}

interface MudOverlayProps {
  initialUrl?: string;
  deferConnect?: boolean;
  container: HTMLElement;
  onRequestClose(): void;
}

interface MudOverlayController {
  root: HTMLElement;
  place(anchor?: Element | null): void;
  connect(): void;
  disconnect(): void;
  setUrl(url: string): void;
  focus(): void;
}

type ControllerState = {
  root: HTMLElement;
  reactRoot: Root;
  onReady(cb: (api: MudOverlayHandle) => void): void;
};

const themeTargets = new Set<HTMLElement>();
let themeObserver: MutationObserver | null = null;
let themeListenersBound = false;
let controller: ControllerState | null = null;
let lastAnchor: Element | null = null;

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

const ensureReadable = (color: Color | null | undefined, background: Color | null | undefined, reference: Color | null | undefined, minRatio = 4.5) => {
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

function registerThemeTarget(target: HTMLElement) {
  themeTargets.add(target);
  applyThemeVars(target);
  ensureThemeWatcher();
}

const now = () => new Date().toLocaleTimeString();

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
  opacity:1;
}
#${OVERLAY_ID} .level-text{
  min-width:100px;
  font-weight:600;
  opacity:1;
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
  background:var(--mud-health-bar,#29e3c7);
  opacity:1;
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
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function extractUrlFromLink(link: Element | null): string {
  if (!link) return "";
  const explicit = (link.getAttribute("data-mud-ws") || link.getAttribute("data-mud") || "").trim();
  if (explicit) return explicit;
  const href = (link.getAttribute("href") || "").trim();
  if (/^wss?:\/\//i.test(href)) return href;
  const path = link.getAttribute("data-mud-path");
  if (path) {
    const base = location.protocol === "https:" ? "wss://" : "ws://";
    return `${base}${location.host}${path}`;
  }
  return "";
}

function placeOverlay(root: HTMLElement, anchor?: Element | null) {
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
    if (root.parentNode !== fallback) fallback.appendChild(root);
    if (fallback === document.body) root.classList.remove("embedded");
    else root.classList.add("embedded");
  }
  lastAnchor = inserted ? usableAnchor : anchor || lastAnchor;
}

const MudOverlay = forwardRef<MudOverlayHandle, MudOverlayProps>(function MudOverlay(
  { initialUrl = "", deferConnect = false, container, onRequestClose },
  ref
) {
  const [url, setUrlState] = useState(initialUrl);
  const urlRef = useRef(url);
  const [statusMode, setStatusMode] = useState<StatusState>("idle");
  const [statusText, setStatusText] = useState("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [health, setHealth] = useState<{ current: number; max: number } | null>(null);
  const [xp, setXp] = useState<{ current: number; total: number } | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [area, setArea] = useState("");
  const [effects, setEffects] = useState<string[]>([]);
  const [statusVisible, setStatusVisible] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const outRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);

  const grpBufRef = useRef<string[]>([]);
  const grpClsRef = useRef<string | null>(null);
  const grpStampRef = useRef<string | null>(null);
  const grpTimerRef = useRef<number | null>(null);
  const msgIdRef = useRef(0);
  const lastActionRef = useRef(0);

  const trimMessages = useCallback((list: Message[]) => {
    if (list.length <= MAX_LINES) return list;
    return list.slice(list.length - MAX_LINES);
  }, []);

  const pushMessages = useCallback(
    (entries: Message[]) => setMessages((prev) => trimMessages([...prev, ...entries])),
    [trimMessages]
  );

  const resetGroup = useCallback(() => {
    grpBufRef.current = [];
    grpClsRef.current = null;
    grpStampRef.current = null;
    if (grpTimerRef.current) {
      window.clearTimeout(grpTimerRef.current);
      grpTimerRef.current = null;
    }
  }, []);

  const flushGroup = useCallback(() => {
    const buf = grpBufRef.current;
    if (!buf.length) return;
    const stamp = grpStampRef.current || now();
    const cls = grpClsRef.current || "outl";
    const entries: Message[] = buf.map((msg, idx) => ({
      kind: "line",
      id: msgIdRef.current++,
      ts: idx === 0 ? stamp : "",
      text: msg,
      cls,
    }));
    resetGroup();
    pushMessages(entries);
  }, [pushMessages, resetGroup]);

  const deathMatchers = useRef<RegExp[]>([
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
  ]);

  const detectLineEffects = useCallback(
    (text: string, cls: string) => {
      if (!text || !cls) return null;
      const baseCls = cls.trim();
      if (!baseCls.split(/\s+/).includes("outl")) return null;
      if (!text.trim()) return null;
      if (deathMatchers.current.some((pattern) => pattern.test(text))) {
        const classes = baseCls ? baseCls.split(/\s+/) : [];
        if (!classes.includes("death")) classes.push("death");
        return { cls: classes.join(" "), lineClass: "line-death", grouped: false };
      }
      return null;
    },
    []
  );

  const append = useCallback(
    (text: string, cls = "outl", grouped = true) => {
      let effectiveCls = cls;
      let lineClass = "";
      let useGrouping = grouped && cls === "outl";
      const special = cls === "outl" ? detectLineEffects(text, cls) : null;
      if (special) {
        effectiveCls = special.cls || effectiveCls;
        lineClass = special.lineClass || lineClass;
        if (special.grouped === false) useGrouping = false;
      }
      const normalizedCls = (effectiveCls || "").trim();
      const canGroup = useGrouping && normalizedCls === "outl";
      if (canGroup) {
        if (grpClsRef.current && grpClsRef.current !== normalizedCls) flushGroup();
        grpClsRef.current = normalizedCls;
        if (!grpStampRef.current) grpStampRef.current = now();
        grpBufRef.current.push(String(text));
        if (grpTimerRef.current) window.clearTimeout(grpTimerRef.current);
        grpTimerRef.current = window.setTimeout(flushGroup, 80);
        return;
      }
      flushGroup();
      pushMessages([
        {
          kind: "line",
          id: msgIdRef.current++,
          ts: now(),
          text,
          cls: normalizedCls || "outl",
          lineClass,
        },
      ]);
    },
    [detectLineEffects, flushGroup, pushMessages]
  );

  const addGap = useCallback(() => {
    flushGroup();
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === "gap") return prev;
      return trimMessages([...prev, { kind: "gap", id: msgIdRef.current++ }]);
    });
  }, [flushGroup, trimMessages]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const setStatus = useCallback((txt: string, state: StatusState) => {
    setStatusText(txt);
    setStatusMode(state);
  }, []);

  const handleSlash = useCallback(
    (value: string) => {
      const t = value.trim();
      if (t === "/clear") {
        resetGroup();
        setMessages([]);
        return true;
      }
      if (t === "/help") {
        append("Commands: /clear, /help", "sys");
        return true;
      }
      return false;
    },
    [append, resetGroup]
  );

  const updateStatus = useCallback((stateMsg: string) => {
    const parts = stateMsg.split("|");
    let hp: string | null = null;
    let level: string | null = null;
    let xp: string | null = null;
    let areaStr: string | null = null;
    let effectsList: string[] = [];

    for (const part of parts) {
      if (part.startsWith("HP:")) hp = part.substring(3);
      else if (part.startsWith("LEVEL:")) level = part.substring(6);
      else if (part.startsWith("XP:")) xp = part.substring(3);
      else if (part.startsWith("AREA:")) areaStr = part.substring(5);
      else if (part.startsWith("EFFECTS:")) {
        const effectsStr = part.substring(8);
        effectsList = effectsStr.split(",").filter(Boolean);
      }
    }

    if (hp) {
      const [current, max] = hp.split("/").map((n) => parseInt(n, 10));
      if (Number.isFinite(current) && Number.isFinite(max)) setHealth({ current, max });
    }

    if (level) {
      const lvl = parseInt(level, 10);
      if (Number.isFinite(lvl)) setLevel(lvl);
    }

    if (xp) {
      const [current, required] = xp.split("/").map((n) => parseInt(n, 10));
      if (Number.isFinite(current) && Number.isFinite(required)) setXp({ current, total: required });
    }

    if (areaStr) setArea(areaStr);
    setEffects(effectsList);
    setStatusVisible(true);
  }, []);

  const disconnect = useCallback(() => {
    try {
      wsRef.current?.close(1000, "client closing");
    } catch {}
  }, []);

  const connect = useCallback(() => {
    const target = (urlRef.current || "").trim();
    if (!target) {
      append("No WebSocket URL provided.", "err");
      return;
    }
    try {
      wsRef.current?.close();
    } catch {}

    setStatus("connecting", "connecting");
    append(`Connecting to ${target} …`, "sys");
    const ws = new WebSocket(target);
    wsRef.current = ws;
    localStorage.setItem(LS_KEY, target);

    ws.addEventListener("open", () => {
      flushGroup();
      setStatus("connected", "connected");
      append("Connected.", "sys");
      focusInput();
    });

    ws.addEventListener("message", async (ev) => {
      try {
        let s: string | null = null;
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
        if (s.startsWith("STATE|")) {
          updateStatus(s);
          return;
        }
        append(s, "outl");
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        append(`Message handling error: ${message}`, "err");
      }
    });

    ws.addEventListener("error", () => {
      flushGroup();
      setStatus("error", "error");
      append("WebSocket error.", "err");
    });

    ws.addEventListener("close", (e) => {
      flushGroup();
      setStatus("disconnected", "idle");
      append(`Disconnected (code ${e.code}).`, "sys");
    });
  }, [append, flushGroup, focusInput, setStatus, updateStatus]);

  const sendDirection = useCallback(
    (direction: string) => {
      const nowTs = Date.now();
      const ACTION_COOLDOWN = 500;
      if (nowTs - lastActionRef.current < ACTION_COOLDOWN) return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        append("Not connected.", "err");
        return;
      }
      lastActionRef.current = nowTs;
      flushGroup();
      addGap();
      append(direction, "inl");
      addGap();
      wsRef.current.send(direction);
    },
    [addGap, append, flushGroup]
  );

  const send = useCallback(() => {
    const text = inputRef.current?.value || "";
    if (!text.trim()) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    historyRef.current.push(text);
    historyIdxRef.current = historyRef.current.length;
    flushGroup();
    addGap();
    append(text, "inl");
    addGap();
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      append("Not connected.", "err");
      return;
    }
    wsRef.current.send(text);
    if (inputRef.current) inputRef.current.value = "";
  }, [addGap, append, flushGroup]);

  useImperativeHandle(
    ref,
    () => ({
      connect,
      disconnect,
      setUrl: (u: string) => {
        setUrlState(u || "");
        urlRef.current = u || "";
      },
      focus: focusInput,
    }),
    [connect, disconnect, focusInput]
  );

  useEffect(() => {
    urlRef.current = url;
  }, [url]);

  useEffect(() => {
    registerThemeTarget(container);
    return () => {
      themeTargets.delete(container);
    };
  }, [container]);

  useEffect(() => {
    return () => {
      flushGroup();
      if (grpTimerRef.current) window.clearTimeout(grpTimerRef.current);
      try {
        wsRef.current?.close(1000, "client closing");
      } catch {}
    };
  }, [flushGroup]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || !container.contains(active)) return;
      if (active === inputRef.current) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        sendDirection("north");
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        sendDirection("south");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        sendDirection("west");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        sendDirection("east");
      } else if (e.key === "u" || e.key === "U") {
        e.preventDefault();
        sendDirection("u");
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        sendDirection("d");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [container, sendDirection]);

  useEffect(() => {
    const handleUnload = () => {
      try {
        wsRef.current?.close();
      } catch {}
    };
    window.addEventListener("beforeunload", handleUnload);
    return () => window.removeEventListener("beforeunload", handleUnload);
  }, []);

  useEffect(() => {
    if (!outRef.current) return;
    outRef.current.scrollTop = outRef.current.scrollHeight;
  }, [messages]);

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        const v = e.currentTarget.value;
        if (v.trim().startsWith("/")) {
          if (handleSlash(v)) {
            e.currentTarget.value = "";
            return;
          }
        }
        send();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onRequestClose();
      }
      if (e.key === "ArrowUp") {
        if (historyIdxRef.current > 0) {
          historyIdxRef.current -= 1;
          e.currentTarget.value = historyRef.current[historyIdxRef.current] || "";
          e.preventDefault();
        }
      } else if (e.key === "ArrowDown") {
        if (historyIdxRef.current < historyRef.current.length - 1) {
          historyIdxRef.current += 1;
          e.currentTarget.value = historyRef.current[historyIdxRef.current] || "";
        } else {
          historyIdxRef.current = historyRef.current.length;
          e.currentTarget.value = "";
        }
        e.preventDefault();
      }
    },
    [handleSlash, onRequestClose, send]
  );

  const hpPercent = health && health.max > 0 ? Math.max(0, Math.min(100, (health.current / health.max) * 100)) : 0;
  const xpPercent = xp && xp.total > 0 ? Math.max(0, Math.min(100, (xp.current / xp.total) * 100)) : 0;
  let healthColor = "";
  if (hpPercent > 66) healthColor = "";
  else if (hpPercent > 33) healthColor = "#fbbf24";
  else healthColor = "#ef4444";

  const statusClass = `status${statusMode ? ` status-${statusMode}` : ""}`;

  return (
    <>
      <div className="head">
        <span className={statusClass} role="status" aria-live="polite">
          ● {statusText}
        </span>
        <input
          className="url"
          type="text"
          placeholder="ws://host:port/path"
          value={url}
          onChange={(e) => {
            setUrlState(e.target.value);
            urlRef.current = e.target.value;
          }}
        />
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              disconnect();
              setStatus("disconnected", "idle");
            } else {
              connect();
            }
          }}
        >
          {wsRef.current && wsRef.current.readyState === WebSocket.OPEN ? "Disconnect" : "Connect"}
        </button>
        <button
          className="btn btn-icon btn-muted"
          type="button"
          title="Close overlay"
          aria-label="Close overlay"
          onClick={onRequestClose}
        >
          ✕
        </button>
      </div>
      <div className="status-panel" style={{ display: statusVisible ? "flex" : "none" }}>
        <div className="health-container">
          <span className="health-text">HP: {health ? `${health.current}/${health.max}` : "--/--"}</span>
          <div className="health-bar-bg">
            <div className="health-bar" style={{ width: `${hpPercent}%`, backgroundColor: healthColor }} />
          </div>
        </div>
        <div className="level-container">
          <span className="level-text">{level != null ? `Level ${level}` : "Level --"}</span>
          <div className="xp-bar-bg">
            <div className="xp-bar" style={{ width: `${xpPercent}%` }} />
          </div>
        </div>
        <span className="area-text">{area ? `📍 ${area}` : ""}</span>
        <span className="effects-text">
          {effects.length
            ? `✨ ${effects
                .map((e) => {
                  const [name, bonus] = e.split(":");
                  return bonus ? `${name} (+${bonus} HP)` : name;
                })
                .join(", ")}`
            : ""}
        </span>
      </div>
      <div className="out" ref={outRef}>
        {messages.map((msg) => {
          if (msg.kind === "gap") return <div key={msg.id} className="gap" />;
          const classes = ["line"];
          if (msg.lineClass) classes.push(msg.lineClass);
          else if (msg.cls.split(/\s+/).includes("death")) classes.push("line-death");
          return (
            <div key={msg.id} className={classes.join(" ")}>
              <div className="ts">{msg.ts}</div>
              <div className={`msg ${msg.cls}`}>{msg.text}</div>
            </div>
          );
        })}
      </div>
      <div className="in">
        <textarea
          ref={inputRef}
          className="input"
          placeholder="Type… (Enter=send, Ctrl+Enter=newline, /clear, /help)"
          onKeyDown={onInputKeyDown}
        />
        <button className="btn btn-primary" type="button" onClick={send}>
          Send
        </button>
        <button
          className="btn btn-muted"
          type="button"
          onClick={() => {
            resetGroup();
            setMessages([]);
          }}
        >
          Clear
        </button>
      </div>
    </>
  );
});

function buildController(root: HTMLElement, options: { initialUrl?: string; deferConnect?: boolean; onClose: () => void }) {
  const pending: Array<(api: MudOverlayHandle) => void> = [];
  let api: MudOverlayHandle | null = null;
  const reactRoot = createRoot(root);
  const setApi = (next: MudOverlayHandle | null) => {
    api = next;
    if (api) {
      while (pending.length) {
        const fn = pending.shift();
        if (fn) fn(api);
      }
    }
  };

  reactRoot.render(
    <MudOverlay
      ref={setApi}
      initialUrl={options.initialUrl}
      deferConnect={options.deferConnect}
      container={root}
      onRequestClose={options.onClose}
    />
  );

  return {
    root,
    reactRoot,
    onReady(cb: (api: MudOverlayHandle) => void) {
      if (api) cb(api);
      else pending.push(cb);
    },
  } satisfies ControllerState;
}

function closeOverlay() {
  if (!controller) return;
  try {
    controller.reactRoot.unmount();
  } catch {}
  if (controller.root.isConnected) controller.root.remove();
  themeTargets.delete(controller.root);
  controller = null;
}

function ensureRoot(anchor?: Element | null) {
  ensureStyles();
  let root = document.getElementById(OVERLAY_ID) as HTMLElement | null;
  if (!root) {
    root = document.createElement("div");
    root.id = OVERLAY_ID;
  }
  placeOverlay(root, anchor || lastAnchor);
  registerThemeTarget(root);
  return root;
}

function resolveInitialUrl(initialUrl: string | undefined, anchor: Element | null): string {
  const savedUrl = localStorage.getItem(LS_KEY) || "";
  const contextualLink = anchor && anchor.isConnected
    ? anchor
    : (document.querySelector("a[data-mud],a[data-mud-ws],a[href^=\"ws\"],a[href^=\"wss\"],[data-mud-mount]") as Element | null);
  const linkUrl = extractUrlFromLink(contextualLink);
  return initialUrl || savedUrl || linkUrl || "";
}

function spawnMudOverlay(initialUrl?: string, options?: { anchor?: Element; deferConnect?: boolean }) {
  const anchor = options?.anchor && options.anchor.nodeType === 1 ? options.anchor : lastAnchor;
  const root = ensureRoot(anchor);
  root.style.display = "";
  const baseZ = parseInt(getComputedStyle(root).zIndex || "2147483647", 10);
  root.style.zIndex = String(baseZ + 1);
  const resolvedUrl = resolveInitialUrl(initialUrl, anchor || null);

  if (!controller) {
    controller = buildController(root, {
      initialUrl: resolvedUrl,
      deferConnect: options?.deferConnect,
      onClose: closeOverlay,
    });
  } else {
    placeOverlay(root, anchor || null);
  }

  controller.onReady((api) => {
    if (resolvedUrl) api.setUrl(resolvedUrl);
    if (!options?.deferConnect) api.connect();
    api.focus();
  });

  return {
    root,
    place: (nextAnchor?: Element | null) => placeOverlay(root, nextAnchor || lastAnchor),
    connect: () => controller?.onReady((api) => api.connect()),
    disconnect: () => controller?.onReady((api) => api.disconnect()),
    setUrl: (url: string) => controller?.onReady((api) => api.setUrl(url)),
    focus: () => controller?.onReady((api) => api.focus()),
  } satisfies MudOverlayController;
}

declare global {
  interface Window {
    spawnMudOverlay?: typeof spawnMudOverlay;
  }
}

if (!window.spawnMudOverlay) {
  window.spawnMudOverlay = spawnMudOverlay;
}

document.addEventListener(
  "mud:spawn",
  (e) => spawnMudOverlay((e as CustomEvent)?.detail?.url, (e as CustomEvent)?.detail?.anchor ? { anchor: (e as CustomEvent).detail.anchor } : undefined),
  { passive: true }
);

export {};
