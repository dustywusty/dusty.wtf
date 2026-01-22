type LineEffect = { cls?: string; lineClass?: string; grouped?: boolean };

const deathMatchers: RegExp[] = [
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

export function detectLineEffects(text: string, cls: string): LineEffect | null {
  if (!text || !cls) return null;
  const baseCls = cls.trim();
  if (!baseCls.split(/\s+/).includes("outl")) return null;
  if (!text.trim()) return null;
  if (deathMatchers.some((pattern) => pattern.test(text))) {
    const classes = baseCls ? baseCls.split(/\s+/) : [];
    if (!classes.includes("death")) classes.push("death");
    return { cls: classes.join(" "), lineClass: "line-death", grouped: false };
  }
  return null;
}
