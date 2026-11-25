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
          <button type="button" onClick={carregar}>
            Atualizar
          </button>
        </>
      )}
    </main>
  );
}
