export const GROUP_COUNT_MIN = 1;
export const GROUP_COUNT_MAX = 4;
export const JUSTIFICATIVA_MAX_LEN = 200;

export const HYPOTHESIS_OPTIONS = [
  "MENOR",
  "IGUAL",
  "MAIOR_SEM_DOBRAR",
  "DOBRA",
] as const;

export type HypothesisOption = (typeof HYPOTHESIS_OPTIONS)[number];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseGroupCount(raw: unknown): ParseResult<number> {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    return { ok: false, error: "Quantidade de grupos deve ser um inteiro entre 1 e 4." };
  }
  if (raw < GROUP_COUNT_MIN || raw > GROUP_COUNT_MAX) {
    return { ok: false, error: "Quantidade de grupos deve ser um inteiro entre 1 e 4." };
  }
  return { ok: true, value: raw };
}

export function parseHypothesisOption(raw: unknown): ParseResult<HypothesisOption> {
  if (typeof raw !== "string" || !HYPOTHESIS_OPTIONS.includes(raw as HypothesisOption)) {
    return {
      ok: false,
      error: `Opção inválida. Escolha uma de: ${HYPOTHESIS_OPTIONS.join(", ")}.`,
    };
  }
  return { ok: true, value: raw as HypothesisOption };
}

// PRD 9/4.3: o professor pode enviar a lista exata de ausentes/pendentes que
// confirma; o servidor revalida sob bloqueio e divergência gera 409.
// Normaliza: ordena e remove duplicatas; valores inválidos são rejeitados.
export function parsePendingConfirmation(raw: unknown): ParseResult<number[] | null> {
  if (raw === undefined || raw === null) {
    return { ok: true, value: null };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "Lista de confirmação deve ser um array de números de grupo." };
  }
  const seen = new Set<number>();
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < GROUP_COUNT_MIN || item > GROUP_COUNT_MAX) {
      return {
        ok: false,
        error: `Números de grupo devem ser inteiros entre ${GROUP_COUNT_MIN} e ${GROUP_COUNT_MAX}.`,
      };
    }
    seen.add(item);
  }
  return { ok: true, value: [...seen].sort((a, b) => a - b) };
}

export function listasIguais(a: number[] | null, b: number[] | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function parseJustificativa(raw: unknown): ParseResult<string | null> {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, value: null };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: "Justificativa deve ser texto." };
  }
  if (raw.length > JUSTIFICATIVA_MAX_LEN) {
    return {
      ok: false,
      error: `Justificativa deve ter no máximo ${JUSTIFICATIVA_MAX_LEN} caracteres.`,
    };
  }
  const trimmed = raw.trim();
  return { ok: true, value: trimmed === "" ? null : trimmed };
}
