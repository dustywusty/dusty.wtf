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
  position:fixed;right:12px;bottom:12px;width:min(700px,95vw);height:min(60vh,70vh);
  z-index:2147483647;font-family:ui-monospace,Menlo,Consolas,monospace;
  background:#0b0f12;color:#e6edf3;border:1px solid #2d3741;border-radius:10px;
  box-shadow:0 10px 30px rgba(0,0,0,.5);display:flex;flex-direction:column;overflow:hidden;resize:both
}
#${OVERLAY_ID} .head{
  display:flex;gap:8px;align-items:center;padding:8px;background:#0f1419;border-bottom:1px solid #2d3741
}
#${OVERLAY_ID} .status{padding:6px 10px;border:1px solid #2d3741;border-radius:8px;background:#192129}
#${OVERLAY_ID} .url{
  flex:1;background:#0b0f12;color:#e6edf3;border:1px solid #2d3741;border-radius:8px;padding:6px 8px
}
#${OVERLAY_ID} .btn{
  background:#192129;color:#e6edf3;border:1px solid #2d3741;border-radius:8px;padding:6px 10px;cursor:pointer
}
#${OVERLAY_ID} .btn:hover{background:#1f2a33}
#${OVERLAY_ID} .out{
  white-space:pre-wrap;line-height:1.35;padding:8px 10px;height:100%;overflow:auto;font-size:13px
}
#${OVERLAY_ID} .in{
  display:grid;grid-template-columns:1fr auto auto;gap:8px;padding:8px;border-top:1px solid #2d3741;background:#0f1419
}
#${OVERLAY_ID} textarea{
  height:56px;resize:none;background:#0b0f12;color:#e6edf3;border:1px solid #2d3741;border-radius:8px;padding:8px;font:13px inherit
}
#${OVERLAY_ID} .sys{color:#9da7b3}
#${OVERLAY_ID} .err{color:#ff7b72}
#${OVERLAY_ID} .inl{color:#79c0ff}
#${OVERLAY_ID} .outl{color:#a5d6a7}
#${OVERLAY_ID}.embedded{
  position: static;           /* no fixed positioning */
  right: auto; bottom: auto;
  width: 100%;                /* fill the container width */
  max-width: none;
  height: 60vh;               /* pick a comfortable height */
  margin: 16px 0 0 0;         /* space above */
  resize: vertical;           /* only vertical resize so it stays in width */
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

    root.innerHTML = ""; // clean slate
    // Header
    const statusEl = el("span", { class: "status" }, "● disconnected");
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
    const btnConn = el("button", { class: "btn" }, "Connect");
    const btnClose = el("button", { class: "btn" }, "✕");

    const head = el("div", { class: "head" }, [statusEl, urlEl, btnConn, btnClose]);

    // Output + input
    const out = el("div", { class: "out" });
    const input = el("textarea", { class: "input", placeholder: "Type… (Enter=send, Ctrl+Enter=newline, /clear, /help)" });
    const btnSend = el("button", { class: "btn" }, "Send");
    const btnClear = el("button", { class: "btn" }, "Clear");
    const inputBar = el("div", { class: "in" }, [input, btnSend, btnClear]);

    root.appendChild(head);
    root.appendChild(out);
    root.appendChild(inputBar);

    // State
    let ws = null;
    let history = [];
    let idx = -1;

    // helpers
    const setStatus = (txt, color) => {
      statusEl.textContent = `● ${txt}`;
      statusEl.style.color = color || "#e6edf3";
    };
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

    const connect = () => {
      const url = (urlEl.value || "").trim();
      if (!url) {
        append("No WebSocket URL provided.", "err");
        return;
      }
      try {
        ws?.close();
      } catch {}
      setStatus("connecting", "#d29922");
      append(`Connecting to ${url} …`, "sys");
      ws = new WebSocket(url);
      localStorage.setItem(LS_KEY, url);

      ws.addEventListener("open", () => {
        flushGroup();
        setStatus("connected", "#3fb950");
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
          +append(s, "outl");
        } catch (e) {
          append("Message handling error: " + (e?.message || e), "err");
        }
      });
      ws.addEventListener("error", (e) => {
        flushGroup();
        setStatus("error", "#ff7b72");
        append("WebSocket error (see console).", "err");
        console.error("[MUD WS] error", e);
      });
      ws.addEventListener("close", (e) => {
        flushGroup();
        setStatus("disconnected", "#ff7b72");
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

    btnClose.addEventListener("click", () => {
      disconnect();
      root.remove();
    });

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
        disconnect();
        root.remove();
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
