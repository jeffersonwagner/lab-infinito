import { describe, expect, it } from "vitest";
import {
  parseGroupCount,
  parseHypothesisOption,
  parseJustificativa,
} from "@/domain/validation";

describe("parseGroupCount", () => {
  it.each([1, 2, 3, 4])("aceita %i", (n) => {
    expect(parseGroupCount(n)).toEqual({ ok: true, value: n });
  });

  it.each([0, 5, -1, 2.5, NaN, Infinity, "2", null, undefined])("rejeita %p", (raw) => {
    expect(parseGroupCount(raw as number).ok).toBe(false);
  });
});

describe("parseHypothesisOption", () => {
  it.each(["MENOR", "IGUAL", "MAIOR_SEM_DOBRAR", "DOBRA"])("aceita %s", (opt) => {
    expect(parseHypothesisOption(opt)).toEqual({ ok: true, value: opt });
  });

  it.each(["menor", "DOBRA ", "MENO", "", "dobra", 1, null, undefined])("rejeita %p", (raw) => {
    expect(parseHypothesisOption(raw as string).ok).toBe(false);
  });
});

describe("parseJustificativa", () => {
  it("aceita texto de exatamente 200 caracteres", () => {
    const text = "a".repeat(200);
    expect(parseJustificativa(text)).toEqual({ ok: true, value: text });
  });

  it("rejeita texto de 201 caracteres", () => {
    expect(parseJustificativa("a".repeat(201)).ok).toBe(false);
  });

  it("aceita ausência e texto vazio como nulo", () => {
    expect(parseJustificativa(undefined)).toEqual({ ok: true, value: null });
    expect(parseJustificativa("   ")).toEqual({ ok: true, value: null });
  });

  it("tratamento de escape fica na interface (React escapa por padrão); domínio mantém texto puro", () => {
    const malicious = "<script>alert(1)</script>";
    const parsed = parseJustificativa(malicious);
    expect(parsed.ok && parsed.value === malicious).toBe(true);
  });

  it("rejeita não-texto", () => {
    expect(parseJustificativa(42).ok).toBe(false);
  });
});
