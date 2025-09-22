/* assets/js/mud-overlay.js
   Minimal WebSocket terminal overlay for browser-based MUD play.
   No deps. Works with a lazy loader that calls window.spawnMudOverlay(url).
*/
(() => {
  "use strict";

  const OVERLAY_ID = "mud-ws-overlay";
  const STYLE_ID = "mud-ws-style";
  const MAX_LINES = 5000; // prune DOM to avoid bloat
  const SEND_NL = true; // newline-terminate commands
  const LS_KEY = "mud_ws_url";
  const MOUNT_SELECTOR = ".container.animate-fade-up";

  let controller = null; // singleton overlay controller

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

    target.style.setProperty("--mud-bg", toRgbString(surface, FALLBACK.background));
    target.style.setProperty("--mud-panel", toRgbString(panel, FALLBACK.background));
    target.style.setProperty("--mud-panel-strong", toRgbString(panelStrong, FALLBACK.background));
    target.style.setProperty("--mud-input-bg", toRgbString(inputBg, FALLBACK.background));
    target.style.setProperty("--mud-border", toRgbString(border, FALLBACK.border));
    target.style.setProperty("--mud-border-strong", toRgbString(borderStrong, FALLBACK.border));
    target.style.setProperty("--mud-text", toRgbString(text, FALLBACK.text));
    target.style.setProperty("--mud-text-muted", toRgbString(textMuted, FALLBACK.text));
    target.style.setProperty("--mud-sys", toRgbString(sys, FALLBACK.text));
    target.style.setProperty("--mud-in", toRgbString(inbound, FALLBACK.accent));
    target.style.setProperty("--mud-err", toRgbString(error, FALLBACK.error));
    target.style.setProperty("--mud-btn-bg", toRgbString(btnBg, FALLBACK.background));
    target.style.setProperty("--mud-btn-hover-bg", toRgbString(btnHoverBg, FALLBACK.background));
    target.style.setProperty("--mud-btn-border", toRgbString(btnBorder, FALLBACK.border));
    target.style.setProperty("--mud-btn-primary-bg", toRgbString(btnPrimaryBg, FALLBACK.accent));
    target.style.setProperty("--mud-btn-primary-hover-bg", toRgbString(btnPrimaryHoverBg, FALLBACK.accent));
    target.style.setProperty("--mud-btn-primary-border", toRgbString(btnPrimaryBorder, FALLBACK.accent));
    target.style.setProperty("--mud-btn-primary-hover-border", toRgbString(btnPrimaryHoverBorder, FALLBACK.accent));
    target.style.setProperty("--mud-btn-primary-text", toRgbString(accentInk || pickInk(btnPrimaryBg), FALLBACK.accentInk));
    target.style.setProperty("--mud-status-idle", toRgbString(statusIdle, FALLBACK.text));
    target.style.setProperty("--mud-status-connecting", toRgbString(statusConnecting, FALLBACK.accent));
    target.style.setProperty("--mud-status-connected", toRgbString(statusConnected, FALLBACK.accent));
    target.style.setProperty("--mud-status-error", toRgbString(error, FALLBACK.error));
    target.style.setProperty("--mud-gap-color", toRgbString(gap, FALLBACK.border));
    target.style.setProperty("--mud-shadow", toRgbaString(shadow, 0.35, FALLBACK.text));
    target.style.setProperty("--mud-scroll-thumb", toRgbaString(scrollThumb, 0.4, FALLBACK.text));
    target.style.setProperty("--mud-focus-ring", toRgbaString(focusRing, 0.35, FALLBACK.accent));
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
  function buildOverlay() {
    ensureStyles();

    // Find blog container (your <div class="container animate-fade-up">)
    const mount = document.querySelector(MOUNT_SELECTOR);

    let root = document.getElementById(OVERLAY_ID);
    if (!root) {
      root = el("div", { id: OVERLAY_ID });
    }

    // Move (or place) the overlay into the mount when present; fall back to body otherwise
    if (mount) {
      if (root.parentNode !== mount) mount.appendChild(root); // ends up below your header/link
      root.classList.add("embedded");
    } else {
      if (!root.parentNode) document.body.appendChild(root);
      root.classList.remove("embedded");
    }

    registerThemeTarget(root);

    root.innerHTML = ""; // clean slate
    // Header
    const statusEl = el("span", { class: "status status-idle", role: "status", "aria-live": "polite" }, "● disconnected");
    const savedUrl = localStorage.getItem(LS_KEY) || "";
    const linkUrl =
      savedUrl ||
      (mount && mount.querySelector('a[href^="ws"]')?.href) || // picks up your wss://... link
      "";
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

    // Output + input
    const out = el("div", { class: "out" });
    const input = el("textarea", { class: "input", placeholder: "Type… (Enter=send, Ctrl+Enter=newline, /clear, /help)" });
    const btnSend = el("button", { class: "btn btn-primary", type: "button" }, "Send");
    const btnClear = el("button", { class: "btn btn-muted", type: "button" }, "Clear");
    const inputBar = el("div", { class: "in" }, [input, btnSend, btnClear]);

    root.appendChild(head);
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
    let grpBuf = "";
    let grpCls = null;
    let grpTimer = null;
    const FLUSH_MS = 80;
    const flushGroup = () => {
      if (!grpBuf) return;
      while (out.childElementCount > MAX_LINES) out.removeChild(out.firstChild);
      const d = el("div", { class: grpCls || "outl" }, `[${now()}] ${grpBuf}`);
      out.appendChild(d);
      out.scrollTop = out.scrollHeight;
      grpBuf = "";
      grpCls = null;
      if (grpTimer) {
        clearTimeout(grpTimer);
        grpTimer = null;
      }
    };
    const append = (text, cls = "outl", grouped = true) => {
      // group only normal server output
      if (grouped && cls === "outl") {
        if (grpCls && grpCls !== cls) flushGroup();
        grpCls = cls;
        grpBuf += (grpBuf ? "\n" : "") + text;
        if (grpTimer) clearTimeout(grpTimer);
        grpTimer = setTimeout(flushGroup, FLUSH_MS);
        return;
      }
      // non-grouped: flush any pending group, then append standalone
      flushGroup();
      while (out.childElementCount > MAX_LINES) out.removeChild(out.firstChild);
      const d = el("div", { class: cls }, `[${now()}] ${text}`);
      out.appendChild(d);
      out.scrollTop = out.scrollHeight;
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

      ws.addEventListener("open", () => {
        flushGroup();
        setStatus("connected", "connected");
        btnConn.textContent = "Disconnect";
        append("Connected.", "sys");
        input.focus();
      });
      ws.addEventListener("message", async (ev) => {
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
          if (!s || !s.trim()) return; // drop empty/whitespace-only payloads
          append(s, "outl");
        } catch (e) {
          append("Message handling error: " + (e?.message || e), "err");
        }
      });
      ws.addEventListener("error", (e) => {
        flushGroup();
        setStatus("error", "error");
        append("WebSocket error (see console).", "err");
        console.error("[MUD WS] error", e);
      });
      ws.addEventListener("close", (e) => {
        flushGroup();
        setStatus("disconnected", "idle");
        btnConn.textContent = "Connect";
        append(`Disconnected (code ${e.code}).`, "sys");
      });
    };
    const addGap = () => {
      out.appendChild(el("div", { class: "gap" }));
      out.scrollTop = out.scrollHeight;
    };

    const send = () => {
      const raw = input.value;
      const trimmed = raw.replace(/[\r\n]+$/g, ""); // strip trailing newlines
      if (!trimmed.trim()) {
        // nothing meaningful
        input.value = "";
        return;
      }
      const text =
        SEND_NL && !trimmed.endsWith("\n") // append a \n if needed
          ? trimmed + "\n"
          : trimmed;
      history.push(trimmed);
      idx = history.length;
      append(trimmed, "inl");
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
    btnClear.addEventListener("click", () => (out.innerHTML = ""));

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
    };
  }

  // ---------- public API ----------
  function spawn(initialUrl) {
    // build or reuse
    if (!controller || !document.body.contains(controller.root)) {
      controller = buildOverlay();
    } else {
      controller.root.style.display = "";
    }

    // bring to front
    const baseZ = parseInt(getComputedStyle(controller.root).zIndex || "2147483647", 10);
    controller.root.style.zIndex = String(baseZ + 1);

    if (initialUrl) controller.setUrl(initialUrl);
    controller.connect();
    controller.focus();
    return controller;
  }

  // Optional: support `document.dispatchEvent(new CustomEvent('mud:spawn', { detail: { url } }))`
  document.addEventListener("mud:spawn", (e) => spawn(e?.detail?.url), { passive: true });

  // Expose for the lazy loader
  window.spawnMudOverlay = window.spawnMudOverlay || spawn;
})();
