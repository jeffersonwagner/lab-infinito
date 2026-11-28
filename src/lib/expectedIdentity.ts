import { isValidUuid } from "./http";

export type ExpectedIdentity = {
  roomId: string;
  role: "PROFESSOR" | "GRUPO";
  groupNumero: number | null;
};

// PRD 8.2: a identidade esperada (não secreta) acompanha consultas e escritas;
// o servidor a compara com a sessão do cookie e responde 409 em divergência,
// sem executar nem retornar dados de outra identidade.
export function parseExpectedIdentity(raw: unknown): ExpectedIdentity | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const body = raw as Record<string, unknown>;
  const { roomId, role, groupNumero } = body;
  if (!isValidUuid(roomId) || (role !== "PROFESSOR" && role !== "GRUPO")) {
    return null;
  }
  if (role === "PROFESSOR") {
    if (groupNumero !== null && groupNumero !== undefined) {
      return null;
    }
    return { roomId, role, groupNumero: null };
  }
  if (typeof groupNumero !== "number" || !Number.isInteger(groupNumero) || groupNumero < 1 || groupNumero > 4) {
    return null;
  }
  return { roomId, role, groupNumero };
}
