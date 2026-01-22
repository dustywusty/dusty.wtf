import type { Health, Xp } from "./types";

type ParsedStatus = {
  health?: Health;
  level?: number;
  xp?: Xp;
  area?: string;
  effects: string[];
};

export function parseStatusMessage(stateMsg: string): ParsedStatus {
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

  const parsed: ParsedStatus = { effects: effectsList };

  if (hp) {
    const [current, max] = hp.split("/").map((n) => parseInt(n, 10));
    if (Number.isFinite(current) && Number.isFinite(max)) parsed.health = { current, max };
  }

  if (level) {
    const lvl = parseInt(level, 10);
    if (Number.isFinite(lvl)) parsed.level = lvl;
  }

  if (xp) {
    const [current, required] = xp.split("/").map((n) => parseInt(n, 10));
    if (Number.isFinite(current) && Number.isFinite(required)) parsed.xp = { current, total: required };
  }

  if (areaStr) parsed.area = areaStr;

  return parsed;
}
