import { describe, expect, it } from "vitest";
import { parseSegundos, parseMeasurementsPayload } from "@/domain/measurements";

describe("parseSegundos", () => {
  it.each(["2", "120", "14,1", "14.1", " 20,5 ", "2.0", "119,999"])(
    "aceita %s",
    (raw) => {
      const parsed = parseSegundos(raw);
      expect(parsed.ok).toBe(true);
    },
  );

  it.each([
    "1,99",
    "1.99",
    "120,01",
    "120.01",
    "",
    "   ",
    "abc",
    "-5",
    "1e2",
    "1E2",
    "1,234",
    "1.234.5",
    "14,1s",
    "14 s",
    "+15",
    ".5",
    "5.",
    "14,,1",
    "NaN",
    "Infinity",
  ])("rejeita %s", (raw) => {
    expect(parseSegundos(raw).ok).toBe(false);
  });

  it("normaliza vírgula para ponto", () => {
    const parsed = parseSegundos("14,1");
    expect(parsed.ok && parsed.value === 14.1).toBe(true);
  });
});

describe("parseMeasurementsPayload", () => {
  const valid = {
    50: { 1: "14,1", 2: "14,2", 3: "14,3" },
    100: { 1: "20,0", 2: "20,1", 3: "20,2" },
  };

  it("aceita o conjunto completo de seis tempos", () => {
    const parsed = parseMeasurementsPayload(valid);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value[50][1] === 14.1).toBe(true);
    expect(parsed.ok && parsed.value[100][3] === 20.2).toBe(true);
  });

  it("rejeita payload incompleto", () => {
    const incomplete = { ...valid, 100: { 1: "20,0" } };
    expect(parseMeasurementsPayload(incomplete).ok).toBe(false);
  });

  it("rejeita payload sem um comprimento", () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { "100": _omitted, ...missing } = valid;
    expect(parseMeasurementsPayload(missing).ok).toBe(false);
  });

  it("rejeita valor inválido em um campo", () => {
    const bad = { ...valid, 50: { ...valid[50], 2: "1e2" } };
    const parsed = parseMeasurementsPayload(bad);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("50 cm");
  });

  it.each([null, "texto", 42, []])("rejeita payload não-objeto %p", (raw) => {
    expect(parseMeasurementsPayload(raw).ok).toBe(false);
  });
});
