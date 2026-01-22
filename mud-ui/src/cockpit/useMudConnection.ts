import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { parseStatusMessage } from "./status";
import type { Health, StatusState, Xp } from "./types";

type UseMudConnectionOptions = {
  urlRef: MutableRefObject<string>;
  storageKey: string;
  append: (text: string, cls?: string, grouped?: boolean) => void;
  addGap: () => void;
  flushGroup: () => void;
  clearMessages: () => void;
  focusInput: () => void;
};

export function useMudConnection(options: UseMudConnectionOptions) {
  const { urlRef, storageKey, append, addGap, flushGroup, clearMessages, focusInput } = options;

  const [statusMode, setStatusMode] = useState<StatusState>("idle");
  const [statusText, setStatusText] = useState("disconnected");
  const [health, setHealth] = useState<Health | null>(null);
  const [xp, setXp] = useState<Xp | null>(null);
  const [level, setLevel] = useState<number | null>(null);
  const [area, setArea] = useState("");
  const [effects, setEffects] = useState<string[]>([]);
  const [statusVisible, setStatusVisible] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const lastActionRef = useRef(0);

  const setStatus = useCallback((txt: string, state: StatusState) => {
    setStatusText(txt);
    setStatusMode(state);
  }, []);

  const handleSlash = useCallback(
    (value: string) => {
      const t = value.trim();
      if (t === "/clear") {
        clearMessages();
        return true;
      }
      if (t === "/help") {
        append("Commands: /clear, /help", "sys");
        return true;
      }
      return false;
    },
    [append, clearMessages]
  );

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
    setIsConnected(false);
    append(`Connecting to ${target} …`, "sys");
    const ws = new WebSocket(target);
    wsRef.current = ws;
    localStorage.setItem(storageKey, target);

    ws.addEventListener("open", () => {
      flushGroup();
      setStatus("connected", "connected");
      setIsConnected(true);
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
          const parsed = parseStatusMessage(s);
          if (parsed.health) setHealth(parsed.health);
          if (parsed.level != null) setLevel(parsed.level);
          if (parsed.xp) setXp(parsed.xp);
          if (parsed.area) setArea(parsed.area);
          setEffects(parsed.effects || []);
          setStatusVisible(true);
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
      setIsConnected(false);
      append("WebSocket error.", "err");
    });

    ws.addEventListener("close", (e) => {
      flushGroup();
      setStatus("disconnected", "idle");
      setIsConnected(false);
      append(`Disconnected (code ${e.code}).`, "sys");
    });
  }, [append, focusInput, flushGroup, setStatus, storageKey, urlRef]);

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

  const sendText = useCallback(
    (text: string) => {
      if (!text.trim()) return false;
      flushGroup();
      addGap();
      append(text, "inl");
      addGap();
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        append("Not connected.", "err");
        return false;
      }
      wsRef.current.send(text);
      return true;
    },
    [addGap, append, flushGroup]
  );

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
    return () => {
      try {
        wsRef.current?.close(1000, "client closing");
      } catch {}
    };
  }, []);

  return {
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
  };
}
