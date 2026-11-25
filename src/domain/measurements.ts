export const MIN_SEGUNDOS = 2;
export const MAX_SEGUNDOS = 120;
export const LENGTHS = [50, 100] as const;
export type LengthCm = (typeof LENGTHS)[number];
export const REPETITIONS = [1, 2, 3] as const;
export type Repeticao = (typeof REPETITIONS)[number];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DECIMAL_RE = /^\d+(?:[.,]\d+)?$/;

export function parseSegundos(raw: unknown): ParseResult<number> {
  if (typeof raw !== "string") {
    return { ok: false, error: "Informe o tempo em segundos, com vírgula ou ponto decimal." };
  }
  const s = raw.trim();
  if (s === "") {
    return { ok: false, error: "Tempo não pode ficar vazio." };
  }
  if (!DECIMAL_RE.test(s)) {
    return {
      ok: false,
      error:
        "Formato inválido: use apenas dígitos e um separador decimal (vírgula ou ponto), sem sinal, milhar ou expoente.",
    };
  }
  const value = Number(s.replace(",", "."));
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Valor não numérico." };
  }
  if (value < MIN_SEGUNDOS || value > MAX_SEGUNDOS) {
    return {
      ok: false,
      error: `Tempo deve estar entre ${MIN_SEGUNDOS} e ${MAX_SEGUNDOS} segundos (10 oscilações).`,
    };
  }
  return { ok: true, value };
}

export type SubmittedMeasurements = {
  [K in LengthCm]: { [R in Repeticao]: number };
};

export type MeasurementInput = {
  comprimentoCm: number;
  repeticao: number;
  segundos: string;
};

export function parseMeasurementsPayload(
  raw: unknown,
): ParseResult<SubmittedMeasurements> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "Envie exatamente seis tempos identificados por comprimento e repetição." };
  }
  const result: SubmittedMeasurements = { 50: { 1: 0, 2: 0, 3: 0 }, 100: { 1: 0, 2: 0, 3: 0 } };
  for (const length of LENGTHS) {
    const block = (raw as Record<string, unknown>)[String(length)];
    if (typeof block !== "object" || block === null || Array.isArray(block)) {
      return { ok: false, error: `Faltam tempos para o comprimento de ${length} cm.` };
    }
    for (const rep of REPETITIONS) {
      const parsed = parseSegundos((block as Record<string, unknown>)[String(rep)]);
      if (!parsed.ok) {
        return { ok: false, error: `${length} cm, medição ${rep}: ${parsed.error}` };
      }
      result[length][rep] = parsed.value;
    }
  }
  return { ok: true, value: result };
}
