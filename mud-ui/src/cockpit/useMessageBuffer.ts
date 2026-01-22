import { useCallback, useEffect, useRef, useState } from "react";
import { detectLineEffects } from "./effects";
import type { Message } from "./types";

type UseMessageBufferOptions = {
  maxLines: number;
};

export function useMessageBuffer(options: UseMessageBufferOptions) {
  const { maxLines } = options;
  const [messages, setMessages] = useState<Message[]>([]);

  const grpBufRef = useRef<string[]>([]);
  const grpClsRef = useRef<string | null>(null);
  const grpStampRef = useRef<string | null>(null);
  const grpTimerRef = useRef<number | null>(null);
  const msgIdRef = useRef(0);

  const now = () => new Date().toLocaleTimeString();

  const trimMessages = useCallback(
    (list: Message[]) => {
      if (list.length <= maxLines) return list;
      return list.slice(list.length - maxLines);
    },
    [maxLines]
  );

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
    [flushGroup, pushMessages]
  );

  const addGap = useCallback(() => {
    flushGroup();
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.kind === "gap") return prev;
      return trimMessages([...prev, { kind: "gap", id: msgIdRef.current++ }]);
    });
  }, [flushGroup, trimMessages]);

  const clearMessages = useCallback(() => {
    resetGroup();
    setMessages([]);
  }, [resetGroup]);

  useEffect(() => {
    return () => {
      flushGroup();
      if (grpTimerRef.current) window.clearTimeout(grpTimerRef.current);
    };
  }, [flushGroup]);

  return {
    messages,
    append,
    addGap,
    flushGroup,
    resetGroup,
    clearMessages,
  };
}
