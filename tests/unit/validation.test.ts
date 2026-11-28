import { describe, expect, it } from "vitest";
import {
  listasIguais,
  parseGroupCount,
  parseHypothesisOption,
  parseJustificativa,
  parsePendingConfirmation,
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

describe("parsePendingConfirmation", () => {
  it("aceita lista válida de números de grupo", () => {
    expect(parsePendingConfirmation([2])).toEqual({ ok: true, value: [2] });
    expect(parsePendingConfirmation([1, 2, 4])).toEqual({ ok: true, value: [1, 2, 4] });
  });

  it("normaliza: ordena e remove duplicatas", () => {
    expect(parsePendingConfirmation([3, 1, 3])).toEqual({ ok: true, value: [1, 3] });
  });

  it("aceita lista vazia (confirmação de nenhum ausente)", () => {
    expect(parsePendingConfirmation([])).toEqual({ ok: true, value: [] });
  });

  it("ausência de confirmação é null (sem pedido de confirmação)", () => {
    expect(parsePendingConfirmation(undefined)).toEqual({ ok: true, value: null });
    expect(parsePendingConfirmation(null)).toEqual({ ok: true, value: null });
  });

  it.each([0, 5, -1, 2.5, "2", null, true])("rejeita item inválido %p", (item) => {
    expect(parsePendingConfirmation([item as number]).ok).toBe(false);
  });

  it.each(["2", 42, {}])("rejeita corpo que não é array: %p", (raw) => {
    expect(parsePendingConfirmation(raw).ok).toBe(false);
  });
});

describe("listasIguais", () => {
  it("compara listas normalizadas", () => {
    expect(listasIguais([1, 2], [1, 2])).toBe(true);
    expect(listasIguais([], [])).toBe(true);
    expect(listasIguais(null, null)).toBe(true);
    expect(listasIguais([1], [1, 2])).toBe(false);
    // O contrato compara listas já normalizadas; entrada não ordenada não é
    // considerada igual (a normalização acontece no parser).
    expect(listasIguais([2, 1], [1, 2])).toBe(false);
    expect(listasIguais(null, [])).toBe(false);
    expect(listasIguais([], null)).toBe(false);
  });
});
