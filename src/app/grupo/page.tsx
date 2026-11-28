"use client";

import { useCallback, useEffect, useState } from "react";
import {
  HYPOTHESIS_LABELS,
  PHASE_LABELS,
  STATUS_LABELS,
  loadIdentity,
} from "@/lib/identity";
import ResultadosRevelados, { type GrupoResultado } from "@/components/ResultadosRevelados";
import { usePolling } from "@/lib/usePolling";

type Projection = {
  role: "GRUPO";
  room: { phase: string; expiresAt: string };
  group: {
    numero: number;
    status: string;
    hypothesis: { opcao: string; justificativa: string | null } | null;
    measurementsConfirmed: boolean;
    tempos: { 50: number[]; 100: number[] } | null;
    stats: GrupoResultado["stats"];
  };
  revealed: boolean;
  resultados: GrupoResultado[] | null;
};

const MATERIAIS = "Materiais: barbante, massa pequena, régua e cronômetro. Meça o comprimento até o centro da massa, use o mesmo objeto e ângulo pequeno, solte sem impulso e conte 10 oscilações.";

export default function Grupo() {
  const [data, setData] = useState<Projection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [opcao, setOpcao] = useState<string>("");
  const [justificativa, setJustificativa] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [medicoes, setMedicoes] = useState<{ 50: string[]; 100: string[] }>({
    50: ["", "", ""],
    100: ["", "", ""],
  });
  const [enviandoMedicoes, setEnviandoMedicoes] = useState(false);
  const [erroMedicoes, setErroMedicoes] = useState<string | null>(null);
  const [sessaoInvalida, setSessaoInvalida] = useState(false);

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
        // PRD 8.2: 401/409 indicam sessão expirada ou divergente (ex.: outro
        // link trocou o cookie neste perfil). Para o polling e pede reabrir.
        if (res.status === 401 || res.status === 409) {
          setSessaoInvalida(true);
        }
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

  // RF-09: polling 5 s com aba visível; pausado quando a sessão é inválida.
  usePolling(carregar, 5000, !sessaoInvalida);

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
      {sessaoInvalida && (
        <p role="alert" className="erro">
          A sessão desta aba não corresponde mais à identidade esperada (pode
          ter expirado ou outro link foi aberto neste navegador). Feche esta
          aba e reabra o link correto da sala.{" "}
          <a href="/entrar">Ir para a tela de acesso</a>
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
          {data.room.phase === "MEDICOES" && data.group.status === "AUSENTE" && (
            <p>
              Este grupo ficou <strong>ausente</strong> nesta rodada (sem
              previsão) e não envia medições. Você poderá consultar os
              resultados quando o professor revelar.
            </p>
          )}
          {data.room.phase === "MEDICOES" && data.group.status === "PARTICIPANTE" && !data.group.measurementsConfirmed && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                if (enviandoMedicoes) return;
                const identity = loadIdentity();
                if (!identity) {
                  setErroMedicoes("Sessão não encontrada. Abra novamente o link do seu grupo.");
                  return;
                }
                setEnviandoMedicoes(true);
                setErroMedicoes(null);
                try {
                  const res = await fetch("/api/measurements/submit", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      roomId: identity.roomId,
                      role: identity.role,
                      groupNumero: identity.groupNumero,
                      tempos: {
                        50: { 1: medicoes[50][0], 2: medicoes[50][1], 3: medicoes[50][2] },
                        100: { 1: medicoes[100][0], 2: medicoes[100][1], 3: medicoes[100][2] },
                      },
                    }),
                  });
                  const body = await res.json().catch(() => ({}));
                  if (res.ok) {
                    setMedicoes({ 50: ["", "", ""], 100: ["", "", ""] });
                    await carregar();
                  } else {
                    setErroMedicoes(body.error ?? "Não foi possível confirmar as medições.");
                    await carregar();
                  }
                } catch {
                  // Falha transitória: mantém as entradas para nova tentativa.
                  setErroMedicoes("Falha de rede. Tente confirmar novamente.");
                } finally {
                  setEnviandoMedicoes(false);
                }
              }}
            >
              <p>{MATERIAIS}</p>
              <fieldset>
                <legend>Tempos de 10 oscilações (segundos; pode usar vírgula ou ponto)</legend>
                {([50, 100] as const).map((comprimento) => (
                  <div key={comprimento}>
                    <strong>Pêndulo de {comprimento} cm</strong>
                    {[0, 1, 2].map((i) => (
                      <label key={i} style={{ display: "block" }}>
                        Medição {i + 1}:{" "}
                        <input
                          type="text"
                          inputMode="decimal"
                          value={medicoes[comprimento][i]}
                          onChange={(event) =>
                            setMedicoes((atual) => {
                              const novo = { ...atual, [comprimento]: [...atual[comprimento]] };
                              novo[comprimento][i] = event.target.value;
                              return novo;
                            })
                          }
                          disabled={enviandoMedicoes}
                        />
                      </label>
                    ))}
                  </div>
                ))}
              </fieldset>
              <p>
                <strong>Atenção:</strong> confira os seis tempos antes de
                confirmar — depois da confirmação o conjunto não pode mais ser
                alterado. Não insira dados pessoais.
              </p>
              {erroMedicoes && (
                <p role="alert" className="erro">
                  {erroMedicoes}
                </p>
              )}
              <button type="submit" disabled={enviandoMedicoes}>
                {enviandoMedicoes ? "Enviando…" : "Confirmar medições"}
              </button>
            </form>
          )}
          {data.room.phase === "MEDICOES" && data.group.measurementsConfirmed && (
            <p>
              Medições confirmadas (imutáveis nesta rodada). Aguarde o
              professor revelar os resultados.
            </p>
          )}
          {data.revealed && (
            <>
              {data.group.stats ? (
                <p>
                  Sua razão (período 100 ÷ 50):{" "}
                  <strong>
                    {data.group.stats.razao
                      ? data.group.stats.razao.toFixed(2).replace(".", ",")
                      : "—"}
                  </strong>
                </p>
              ) : (
                <p>
                  {data.group.status === "AUSENTE"
                    ? "Este grupo ficou ausente nesta rodada e não tem resultados próprios; confira abaixo os resultados dos participantes."
                    : "Sua previsão foi registrada, mas este grupo ficou sem medição nesta rodada."}
                </p>
              )}
              {data.resultados && (
                <ResultadosRevelados grupos={data.resultados} mostrarDiscussao />
              )}
            </>
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
