"use client";

import { useCallback, useEffect, useState } from "react";
import {
  HYPOTHESIS_LABELS,
  PHASE_LABELS,
  STATUS_LABELS,
  loadIdentity,
} from "@/lib/identity";

type Projection = {
  role: "GRUPO";
  room: { phase: string; expiresAt: string };
  group: {
    numero: number;
    status: string;
    hypothesis: { opcao: string; justificativa: string | null } | null;
    measurementsConfirmed: boolean;
  };
  revealed: boolean;
};

export default function Grupo() {
  const [data, setData] = useState<Projection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    const identity = loadIdentity();
    if (!identity || identity.role !== "GRUPO" || identity.groupNumero === null) {
      setError("Sessão não encontrada nesta tela. Abra novamente o link do seu grupo.");
      setLoading(false);
      return;
    }
    try {
      const params = new URLSearchParams({
        roomId: identity.roomId,
        role: identity.role,
        groupNumero: String(identity.groupNumero),
      });
      const res = await fetch(`/api/room?${params}`);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Falha ao carregar a sala.");
      } else {
        setError(null);
        setData(body);
      }
    } catch {
      setError("Falha de rede. Tente atualizar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <main>
      <h1>Sala do grupo</h1>
      {data && (
        <p aria-live="polite" className="identidade">
          Papel: Grupo {data.group.numero} · Fase:{" "}
          {PHASE_LABELS[data.room.phase] ?? data.room.phase}
        </p>
      )}
      {loading && <p>Carregando…</p>}
      {error && (
        <p role="alert" className="erro">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>
            Situação do grupo:{" "}
            <strong>{STATUS_LABELS[data.group.status] ?? data.group.status}</strong>
          </p>
          <p>
            Sua previsão:{" "}
            <strong>
              {data.group.hypothesis
                ? (HYPOTHESIS_LABELS[data.group.hypothesis.opcao] ??
                  data.group.hypothesis.opcao)
                : "ainda não registrada"}
            </strong>
            {data.group.hypothesis?.justificativa && (
              <> · “{data.group.hypothesis.justificativa}”</>
            )}
          </p>
          {data.room.phase === "HIPOTESES" && !data.group.hypothesis && (
            <p>
              Aguarde a orientação do professor. O registro da previsão deste
              grupo será habilitado na tela na próxima etapa do protótipo.
            </p>
          )}
          {data.room.phase === "MEDICOES" && (
            <p>
              Fase de medições: nesta etapa do protótipo, o envio de medições
              ainda será implementado. Use o botão atualizar para acompanhar.
            </p>
          )}
          {data.revealed && !data.group.measurementsConfirmed && (
            <p>
              Sua previsão foi registrada, mas este grupo ficou{" "}
              <strong>sem medição</strong> nesta rodada.
            </p>
          )}
          <button type="button" onClick={carregar}>
            Atualizar
          </button>
          <p className="aviso">
            Não insira dados pessoais (nomes, fotos, contatos) nas respostas.
          </p>
        </>
      )}
    </main>
  );
}
