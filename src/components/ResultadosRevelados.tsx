"use client";

import { HYPOTHESIS_LABELS } from "@/lib/identity";
import { roundForDisplay } from "@/domain/calc";

type Stats = {
  lengths: {
    comprimentoCm: number;
    times: number[];
    media: number;
    periodo: number;
    amplitude: number;
    amplitudeAlerta: boolean;
  }[];
  razao: number | null;
};

export type GrupoResultado = {
  numero: number;
  status: string;
  hypothesis: { opcao: string; justificativa: string | null } | null;
  measurementsConfirmed: boolean;
  tempos: { 50: number[]; 100: number[] } | null;
  stats: Stats | null;
};

// PRD 6/8: a razão é calculada com precisão integral e arredondada só na
// apresentação, para 2 casas. Participante pendente aparece como SEM_MEDICAO,
// nunca como zero (PRD 4.1/8.1).
function fmt(value: number, casas = 2): string {
  return roundForDisplay(value, casas).toFixed(casas).replace(".", ",");
}

function celulaComprimento(
  stats: Stats | null,
  indice: 0 | 1,
): string {
  if (!stats) {
    return "—";
  }
  const s = stats.lengths[indice];
  return `tempos ${s.times.map((t) => fmt(t, 1).replace(/,0$/, "")).join(" · ")} s · média ${fmt(s.media)} s · período ${fmt(s.periodo)} s · amplitude ${fmt(s.amplitude)} s`;
}

export default function ResultadosRevelados({
  grupos,
  mostrarDiscussao,
}: {
  grupos: GrupoResultado[];
  mostrarDiscussao: boolean;
}) {
  return (
    <section aria-label="Resultados comparados">
      <h2>Resultados</h2>
      <table>
        <caption>Previsões, medições e cálculos por grupo</caption>
        <thead>
          <tr>
            <th scope="col">Grupo</th>
            <th scope="col">Situação</th>
            <th scope="col">Previsão</th>
            <th scope="col">50 cm</th>
            <th scope="col">100 cm</th>
            <th scope="col">Razão (período 100 ÷ 50)</th>
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.numero}>
              <td>{g.numero}</td>
              <td>{g.status === "AUSENTE" ? "Ausente" : g.status === "PARTICIPANTE" ? "Participante" : g.status}</td>
              <td>
                {g.hypothesis
                  ? (HYPOTHESIS_LABELS[g.hypothesis.opcao] ?? g.hypothesis.opcao)
                  : "—"}
              </td>
              <td>{celulaComprimento(g.stats, 0)}</td>
              <td>{celulaComprimento(g.stats, 1)}</td>
              <td>
                {g.stats && g.stats.razao !== null ? (
                  <>
                    {fmt(g.stats.razao)}
                    {(g.stats.lengths[0].amplitudeAlerta ||
                      g.stats.lengths[1].amplitudeAlerta) && (
                      <span className="aviso">
                        {" "}
                        · Medições variaram; confira a contagem e repita se
                        possível em uma nova sala.
                      </span>
                    )}
                  </>
                ) : g.measurementsConfirmed ? (
                  "—"
                ) : (
                  "Sem medição"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {mostrarDiscussao && (
        <p>
          Para discutir: o que mudou ao dobrar o comprimento? As medidas
          sustentam a previsão do seu grupo? O que pode explicar diferenças
          entre grupos?
        </p>
      )}
    </section>
  );
}
