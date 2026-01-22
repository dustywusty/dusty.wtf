export type StatusState = "idle" | "connecting" | "connected" | "error";

export type MessageKind = "line" | "gap";

export interface MessageLine {
  kind: "line";
  id: number;
  ts?: string;
  text: string;
  cls: string;
  lineClass?: string;
}

export interface MessageGap {
  kind: "gap";
  id: number;
}

export type Message = MessageLine | MessageGap;

export type Health = { current: number; max: number };
export type Xp = { current: number; total: number };
