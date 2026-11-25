"use client";

import { useState } from "react";
import { LinkRow } from "@/components/LinkRow";

type CreateResponse = {
  roomId: string;
  professorLink: string;
  groupLinks: { groupNumero: number; link: string }[];
  expiresAt: string;
};

export default function Home() {
  const [groupCount, setGroupCount] = useState<number | "">("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateResponse | null>(null);

  async function createRoom(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (typeof groupCount !== "number") {
      setError("Escolha a quantidade de grupos (1 a 4).");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupCount }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Falha ao criar a sala.");
        return;
      }
      setCreated(body);
    } catch {
      setError("Falha de rede. Tente novamente.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <main>
      <h1>Laboratório Invisível (protótipo)</h1>
      <p className="aviso">
        Protótipo para Hack Brasil 2026. Não é um produto final e não coleta
        dados pessoais de alunos.
      </p>

      {!created ? (
        <section>
          <p>
            Sala temporária para o experimento do pêndulo: cada grupo registra
            sua previsão para a pergunta{" "}
            <strong>
              “Se dobrarmos o comprimento do pêndulo, o período também dobra?”
            </strong>
            , mede o período para 50 cm e 100 cm, e a turma compara resultados.
          </p>
          <form onSubmit={createRoom}>
            <label htmlFor="group-count">Quantidade de grupos (1 a 4)</label>
            <select
              id="group-count"
              value={groupCount}
              onChange={(e) =>
                setGroupCount(e.target.value === "" ? "" : Number(e.target.value))
              }
            >
              <option value="">Selecione…</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "grupo" : "grupos"}
                </option>
              ))}
            </select>
            <button type="submit" disabled={creating || groupCount === ""}>
              {creating ? "Criando sala…" : "Criar sala"}
            </button>
          </form>
          {error && (
            <p role="alert" className="erro">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section>
          <h2>Links da sala</h2>
          <p className="aviso">
            <strong>Guarde estes links agora.</strong> Eles são exibidos apenas
            nesta tela e não podem ser recuperados depois. Cada link dá acesso à
            sala: não compartilhe publicamente. A sala expira 14 dias após a
            criação.
          </p>
          <ul>
            <LinkRow label="Professor" link={created.professorLink} />
            {created.groupLinks.map((g) => (
              <LinkRow key={g.groupNumero} label={`Grupo ${g.groupNumero}`} link={g.link} />
            ))}
          </ul>
          <p>Se perder os links, crie uma nova sala (não há recuperação).</p>
        </section>
      )}
    </main>
  );
}
