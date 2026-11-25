"use client";

export type ExpectedIdentity = {
  roomId: string;
  role: "PROFESSOR" | "GRUPO";
  groupNumero: number | null;
};

export const IDENTITY_STORAGE_KEY = "lab-identidade";

// Identidade esperada, NÃO secreta (PRD 8.2): serve apenas para o servidor
// conferir com a sessão do cookie; nunca substitui autenticação.
export function saveIdentity(identity: ExpectedIdentity): void {
  sessionStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
}

export function loadIdentity(): ExpectedIdentity | null {
  const raw = sessionStorage.getItem(IDENTITY_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.roomId === "string" &&
      (parsed.role === "PROFESSOR" || parsed.role === "GRUPO") &&
      (parsed.groupNumero === null || typeof parsed.groupNumero === "number")
    ) {
      return parsed as ExpectedIdentity;
    }
  } catch {
    // ignora valor corrompido
  }
  return null;
}

export const PHASE_LABELS: Record<string, string> = {
  HIPOTESES: "Previsões (hipóteses)",
  MEDICOES: "Medições",
  REVELADO: "Resultados revelados",
};

export const STATUS_LABELS: Record<string, string> = {
  PENDENTE: "Aguardando hipótese",
  PARTICIPANTE: "Participante",
  AUSENTE: "Ausente",
};

export const HYPOTHESIS_LABELS: Record<string, string> = {
  MENOR: "Menor que o dobro",
  IGUAL: "Igual",
  MAIOR_SEM_DOBRAR: "Maior, mas sem dobrar",
  DOBRA: "Dobra",
};
