import type { LengthCm } from "./measurements";

export type MeasurementsForLength = {
  times: number[];
};

export type LengthStats = {
  comprimentoCm: LengthCm;
  times: number[];
  media: number;
  periodo: number;
  amplitude: number;
  amplitudeAlerta: boolean;
};

export type GroupStats = {
  lengths: [LengthStats, LengthStats];
  razao: number | null;
};

export function roundForDisplay(value: number, decimals = 2): number {
  return Number(value.toFixed(decimals));
}

function computeLengthStats(comprimentoCm: LengthCm, m: MeasurementsForLength): LengthStats {
  const times = m.times;
  if (times.length !== 3) {
    throw new Error(`Comprimento ${comprimentoCm} cm requer exatamente três tempos.`);
  }
  const media = times.reduce((a, b) => a + b, 0) / 3;
  const periodo = media / 10;
  const amplitude = Math.max(...times) - Math.min(...times);
  const limite = 0.1 * media;
  const epsilon = 1e-9;
  return {
    comprimentoCm,
    times,
    media,
    periodo,
    amplitude,
    amplitudeAlerta: amplitude > limite + epsilon,
  };
}

export function computeGroupStats(
  m50: MeasurementsForLength,
  m100: MeasurementsForLength,
): GroupStats {
  const s50 = computeLengthStats(50, m50);
  const s100 = computeLengthStats(100, m100);
  return {
    lengths: [s50, s100],
    razao: s50.periodo > 0 ? s100.periodo / s50.periodo : null,
  };
}
