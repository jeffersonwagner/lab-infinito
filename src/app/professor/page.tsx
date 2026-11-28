"use client";

import { useCallback, useEffect, useState } from "react";
import {
  HYPOTHESIS_LABELS,
  PHASE_LABELS,
  STATUS_LABELS,
  loadIdentity,
} from "@/lib/identity";

type Projection = {
  role: "PROFESSOR";
  room: { phase: string; expiresAt: string };
  groups: {
    numero: number;
    status: string;
    hypothesis: { opcao: string; justificativa: string | null } | null;
    measurementsConfirmed: boolean;
  }[];
};

export default function Professor() {
  const [data, setData] = useState<Projection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [papel, setPapel] = useState("—");
  const [avancando, setAvancando] = useState(false);
  const [erroAvanco, setErroAvanco] = useState<string | null>(null);
  const [pendentes, setPendentes] = useState<number[] | null>(null);

  const carregar = useCallback(async () => {
    const identity = loadIdentity();
    if (!identity || identity.role !== "PROFESSOR") {
      setError("Sessão não encontrada nesta tela. Abra novamente o link do professor.");
      setLoading(false);
      return;
    }
    setPapel("Professor");
    try {
      const params = new URLSearchParams({
        roomId: identity.roomId,
        role: identity.role,
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
      <h1>Sala do professor</h1>
      <p aria-live="polite" className="identidade">
        Papel: {papel}
        {data ? ` · Fase: ${PHASE_LABELS[data.room.phase] ?? data.room.phase}` : ""}
      </p>
      {loading && <p>Carregando…</p>}
      {error && (
        <p role="alert" className="erro">
          {error}
        </p>
      )}
      {data && (
        <>
          <table>
            <caption>Grupos da sala</caption>
            <thead>
              <tr>
                <th scope="col">Grupo</th>
                <th scope="col">Situação</th>
                <th scope="col">Previsão</th>
                <th scope="col">Justificativa</th>
                <th scope="col">Medições</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.map((g) => (
                <tr key={g.numero}>
                  <td>{g.numero}</td>
                  <td>{STATUS_LABELS[g.status] ?? g.status}</td>
                  <td>
                    {g.hypothesis
                      ? (HYPOTHESIS_LABELS[g.hypothesis.opcao] ?? g.hypothesis.opcao)
                      : "—"}
                  </td>
                  <td>{g.hypothesis?.justificativa ?? "—"}</td>
                  <td>{g.measurementsConfirmed ? "Confirmadas" : "Não enviadas"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.room.phase !== "REVELADO" && (
            <section aria-label="Controle de fases">
              <h2>Controle de fases</h2>
              {pendentes !== null && (
                <p role="alert" className="aviso">
                  {pendentes.length > 0
                    ? `Grupos ausentes/pendentes: ${pendentes.join(", ")}. Sem hipótese, o grupo fica ausente e fora das medições da rodada.`
                    : "Nenhum grupo ausente/pendente no recálculo atual."}
                </p>
              )}
              {erroAvanco && (
                <p role="alert" className="erro">
                  {erroAvanco}
                </p>
              )}
              <button
                type="button"
                disabled={avancando}
                onClick={async () => {
                  const identity = loadIdentity();
                  if (!identity) {
                    setErroAvanco("Sessão não encontrada. Abra novamente o link do professor.");
                    return;
                  }
                  setAvancando(true);
                  setErroAvanco(null);
                  try {
                    const res = await fetch("/api/room/advance", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        roomId: identity.roomId,
                        role: identity.role,
                        groupNumero: identity.groupNumero,
                        confirmados: pendentes,
                      }),
                    });
                    const body = await res.json().catch(() => ({}));
                    if (res.ok) {
                      setPendentes(null);
                      await carregar();
                    } else if (res.status === 409 && body.requiresConfirmation) {
                      // Lista recalculada pelo servidor: atualiza e pede nova
                      // confirmação explícita.
                      setPendentes(body.pendentes ?? []);
                      setErroAvanco(body.error ?? "Confirme a lista para avançar.");
                    } else {
                      setPendentes(null);
                      setErroAvanco(body.error ?? "Não foi possível avançar a fase.");
                      await carregar();
                    }
                  } catch {
                    setErroAvanco("Falha de rede. Tente novamente.");
                  } finally {
                    setAvancando(false);
                  }
                }}
              >
                {avancando
                  ? "Avançando…"
                  : pendentes === null
                    ? data.room.phase === "HIPOTESES"
                      ? "Avançar para medições"
                      : "Revelar resultados"
                    : `Confirmar avanço${pendentes.length > 0 ? ` (ausentes/pendentes: ${pendentes.join(", ")})` : ""}`}
              </button>
            </section>
          )}
          <button type="button" onClick={carregar}>
            Atualizar
          </button>
        </>
      )}
    </main>
  );
}
