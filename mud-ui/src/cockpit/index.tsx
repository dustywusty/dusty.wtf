/// <reference types="react" />
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { ensureStyles, OVERLAY_ID } from "./styles";
import { registerThemeTarget, unregisterThemeTarget } from "./theme";

const MAX_LINES = 5000;
const LS_KEY = "mud_ws_url";
const MOUNT_SELECTOR = ".container.animate-fade-up";

type StatusState = "idle" | "connecting" | "connected" | "error";
type MessageKind = "line" | "gap";


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

const controllers = new WeakMap<HTMLElement, ControllerState>();
let lastAnchor: Element | null = null;

const now = () => new Date().toLocaleTimeString();

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
      unregisterThemeTarget(container);
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

function buildController(
  root: HTMLElement,
  options: { initialUrl?: string; deferConnect?: boolean; onClose: (root: HTMLElement) => void }
) {
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
      onRequestClose={() => options.onClose(root)}
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

function closeOverlay(root: HTMLElement) {
  const controller = controllers.get(root);
  if (!controller) return;
  try {
    controller.reactRoot.unmount();
  } catch {}
  if (controller.root.isConnected) controller.root.remove();
  unregisterThemeTarget(controller.root);
  controllers.delete(root);
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

  if (!controllers.has(root)) {
    const next = buildController(root, {
      initialUrl: resolvedUrl,
      deferConnect: options?.deferConnect,
      onClose: closeOverlay,
    });
    controllers.set(root, next);
  } else {
    placeOverlay(root, anchor || null);
  }

  controllers.get(root)?.onReady((api) => {
    if (resolvedUrl) api.setUrl(resolvedUrl);
    if (!options?.deferConnect) api.connect();
    api.focus();
  });

  return {
    root,
    place: (nextAnchor?: Element | null) => placeOverlay(root, nextAnchor || lastAnchor),
    connect: () => controllers.get(root)?.onReady((api) => api.connect()),
    disconnect: () => controllers.get(root)?.onReady((api) => api.disconnect()),
    setUrl: (url: string) => controllers.get(root)?.onReady((api) => api.setUrl(url)),
    focus: () => controllers.get(root)?.onReady((api) => api.focus()),
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
