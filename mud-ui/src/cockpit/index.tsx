/// <reference types="react" />
import React, { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { createRoot, Root } from "react-dom/client";
import { placeOverlay, resolveInitialUrl } from "./dom.ts";
import { ensureStyles, OVERLAY_ID } from "./styles.ts";
import { registerThemeTarget, unregisterThemeTarget } from "./theme.ts";
import { useMessageBuffer } from "./useMessageBuffer.ts";
import { useMudConnection } from "./useMudConnection.ts";
const LS_KEY = "mud_ws_url";
const MOUNT_SELECTOR = ".container.animate-fade-up";

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

const MudOverlay = forwardRef<MudOverlayHandle, MudOverlayProps>(function MudOverlay(
  { initialUrl = "", deferConnect = false, container, onRequestClose },
  ref
) {
  const [url, setUrlState] = useState(initialUrl);
  const urlRef = useRef(url);

  const { messages, append, addGap, flushGroup, clearMessages } = useMessageBuffer({ maxLines: 5000 });

  const outRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  const {
    statusMode,
    statusText,
    statusVisible,
    health,
    xp,
    level,
    area,
    effects,
    isConnected,
    connect,
    disconnect,
    sendDirection,
    sendText,
    handleSlash,
  } = useMudConnection({
    urlRef,
    storageKey: LS_KEY,
    append,
    addGap,
    flushGroup,
    clearMessages,
    focusInput,
  });

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
        if (sendText(v)) {
          historyRef.current.push(v);
          historyIdxRef.current = historyRef.current.length;
          e.currentTarget.value = "";
        }
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
    [handleSlash, onRequestClose, sendText]
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
            if (isConnected) disconnect();
            else connect();
          }}
        >
          {isConnected ? "Disconnect" : "Connect"}
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
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            const v = inputRef.current?.value || "";
            if (sendText(v)) {
              historyRef.current.push(v);
              historyIdxRef.current = historyRef.current.length;
              if (inputRef.current) inputRef.current.value = "";
            }
          }}
        >
          Send
        </button>
        <button
          className="btn btn-muted"
          type="button"
          onClick={clearMessages}
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
  lastAnchor = placeOverlay(root, anchor || lastAnchor, MOUNT_SELECTOR, lastAnchor);
  registerThemeTarget(root);
  return root;
}

function spawnMudOverlay(initialUrl?: string, options?: { anchor?: Element; deferConnect?: boolean }) {
  const anchor = options?.anchor && options.anchor.nodeType === 1 ? options.anchor : lastAnchor;
  const root = ensureRoot(anchor);
  root.style.display = "";
  const baseZ = parseInt(getComputedStyle(root).zIndex || "2147483647", 10);
  root.style.zIndex = String(baseZ + 1);
  const resolvedUrl = resolveInitialUrl(initialUrl, anchor || null, LS_KEY);

  if (!controllers.has(root)) {
    const next = buildController(root, {
      initialUrl: resolvedUrl,
      deferConnect: options?.deferConnect,
      onClose: closeOverlay,
    });
    controllers.set(root, next);
  } else {
    lastAnchor = placeOverlay(root, anchor || null, MOUNT_SELECTOR, lastAnchor);
  }

  controllers.get(root)?.onReady((api) => {
    if (resolvedUrl) api.setUrl(resolvedUrl);
    if (!options?.deferConnect) api.connect();
    api.focus();
  });

  return {
    root,
    place: (nextAnchor?: Element | null) => {
      lastAnchor = placeOverlay(root, nextAnchor || lastAnchor, MOUNT_SELECTOR, lastAnchor);
    },
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
