export const PHASES = ["HIPOTESES", "MEDICOES", "REVELADO"] as const;

export type Phase = (typeof PHASES)[number];

export type RoomPhase = "HIPOTESES" | "MEDICOES" | "REVELADO";

export function canTransition(from: Phase, to: Phase): boolean {
  const i = PHASES.indexOf(from);
  const j = PHASES.indexOf(to);
  return j === i + 1;
}

export function nextPhase(current: Phase): Phase | null {
  const i = PHASES.indexOf(current);
  return i < PHASES.length - 1 ? PHASES[i + 1] : null;
}
