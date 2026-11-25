import { describe, expect, it } from "vitest";
import { canTransition, nextPhase } from "@/domain/phases";
import { computeGroupStats, roundForDisplay } from "@/domain/calc";

describe("phases", () => {
  it("permite apenas avanço de uma fase", () => {
    expect(canTransition("HIPOTESES", "MEDICOES")).toBe(true);
    expect(canTransition("MEDICOES", "REVELADO")).toBe(true);
    expect(canTransition("HIPOTESES", "REVELADO")).toBe(false);
    expect(canTransition("MEDICOES", "HIPOTESES")).toBe(false);
    expect(canTransition("REVELADO", "MEDICOES")).toBe(false);
  });

  it("não há fase seguinte de REVELADO", () => {
    expect(nextPhase("REVELADO")).toBeNull();
    expect(nextPhase("MEDICOES")).toBe("REVELADO");
  });
});

describe("caso fixo da seção 6 (dados fictícios)", () => {
  const stats = computeGroupStats({ times: [14.1, 14.2, 14.3] }, { times: [20.0, 20.1, 20.2] });

  it("calcula média, período e amplitude para 50 cm", () => {
    const s50 = stats.lengths[0];
    expect(roundForDisplay(s50.media)).toBeCloseTo(14.2, 6);
    expect(roundForDisplay(s50.periodo)).toBe(1.42);
    expect(roundForDisplay(s50.amplitude)).toBe(0.2);
  });

  it("calcula média, período e amplitude para 100 cm", () => {
    const s100 = stats.lengths[1];
    expect(roundForDisplay(s100.media)).toBe(20.1);
    expect(roundForDisplay(s100.periodo)).toBe(2.01);
    expect(roundForDisplay(s100.amplitude)).toBe(0.2);
  });

  it("razão exibida é 1,42, arredondada só na apresentação", () => {
    expect(stats.razao).not.toBeNull();
    expect(roundForDisplay(stats.razao as number)).toBe(1.42);
  });
});

describe("limiar de amplitude (heurística da interface)", () => {
  it("exatamente 10% não emite aviso", () => {
    const stats = computeGroupStats({ times: [19, 20, 21] }, { times: [19, 20, 21] });
    for (const l of stats.lengths) {
      expect(l.amplitude).toBeCloseTo(0.1 * l.media, 9);
      expect(l.amplitudeAlerta).toBe(false);
    }
  });

  it("acima de 10% emite aviso", () => {
    const stats = computeGroupStats({ times: [18.9, 20, 21.1] }, { times: [18.9, 20, 21.1] });
    for (const l of stats.lengths) {
      expect(l.amplitudeAlerta).toBe(true);
    }
  });

  it("pouco abaixo de 10% não emite aviso", () => {
    const stats = computeGroupStats({ times: [19.01, 20, 20.99] }, { times: [19.01, 20, 20.99] });
    for (const l of stats.lengths) {
      expect(l.amplitudeAlerta).toBe(false);
    }
  });

  it("exige exatamente três tempos por comprimento", () => {
    expect(() => computeGroupStats({ times: [14, 15] }, { times: [20, 21, 22] })).toThrow();
  });
});
