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
  const [opcao, setOpcao] = useState<string>("");
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

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
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (!opcao || enviando) return;
                const identity = loadIdentity();
                if (!identity) {
                  setErroEnvio("Sessão não encontrada. Abra novamente o link do seu grupo.");
                  return;
                }
                setEnviando(true);
                setErroEnvio(null);
                try {
                  const res = await fetch("/api/hypothesis", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      roomId: identity.roomId,
                      role: identity.role,
                      groupNumero: identity.groupNumero,
                      opcao,
                      justificativa,
                    }),
                  });
                  const body = await res.json().catch(() => ({}));
                  if (res.ok) {
                    // Confirmação imutável: limpa o formulário e recarrega o estado.
                    setOpcao("");
                    setJustificativa("");
                    await carregar();
                  } else {
                    setErroEnvio(body.error ?? "Não foi possível registrar a previsão.");
                    // Estado pode ter mudado (fase/conteúdo): atualiza a projeção
                    // sem apagar as entradas locais.
                    await carregar();
                  }
                } catch {
                  // Falha transitória: mantém as entradas para nova tentativa.
                  setErroEnvio("Falha de rede. Tente confirmar novamente.");
                } finally {
                  setEnviando(false);
                }
              }}
            >
              <fieldset>
                <legend>Sua previsão para a pergunta da sala</legend>
                <p>“Se dobrarmos o comprimento do pêndulo, o período também dobra?”</p>
                {Object.entries(HYPOTHESIS_LABELS).map(([valor, label]) => (
                  <label key={valor} style={{ display: "block" }}>
                    <input
                      type="radio"
                      name="opcao"
                      value={valor}
                      checked={opcao === valor}
                      onChange={() => setOpcao(valor)}
                      disabled={enviando}
                    />{" "}
                    {label}
                  </label>
                ))}
              </fieldset>
              <label htmlFor="justificativa">
                Justificativa (opcional, até 200 caracteres)
              </label>
              <textarea
                id="justificativa"
                maxLength={200}
                value={justificativa}
                onChange={(event) => setJustificativa(event.target.value)}
                disabled={enviando}
              />
              <p>
                <strong>Atenção:</strong> após confirmar, a previsão não pode mais
                ser alterada. Não insira dados pessoais (nomes, fotos, contatos).
              </p>
              {erroEnvio && (
                <p role="alert" className="erro">
                  {erroEnvio}
                </p>
              )}
              <button type="submit" disabled={!opcao || enviando}>
                {enviando ? "Enviando…" : "Confirmar previsão"}
              </button>
            </form>
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
