# Laboratório Invisível (protótipo)

Sala temporária para o experimento do pêndulo: o professor cria a sala, cada grupo
registra sua previsão (“Se dobrarmos o comprimento do pêndulo, o período também
dobra?”), mede o período para 50 cm e 100 cm, e a turma compara resultados após a
revelação.

**Este é um protótipo para o Hack Brasil 2026, em desenvolvimento.** Não é um produto
final, não teve revisão pedagógica ou científica formal e não deve ser usado com
turmas reais sem análise de segurança, privacidade (LGPD) e revisão docente.

## Stack

- Next.js (App Router) + TypeScript
- PostgreSQL (gerenciado em produção; escolha do provedor pendente de decisão do Jeff)
- Migrações SQL puros (sem ORM), aplicadas por `src/db/migrate.ts`
- Testes: Vitest (unitários) e integração com Postgres embarcado (`embedded-postgres`), apenas em devDependencies

## Requisitos

- Node.js 20+ (testado com Node 22)
- Um PostgreSQL acessível via `DATABASE_URL` (só para rodar localmente; os testes
  de integração sobem um Postgres próprio e descartável, sem interferir no seu banco)

## Configuração

1. Copie `.env.example` para `.env` e preencha `DATABASE_URL` com um banco de teste
   local (nunca commite o `.env`; o `.gitignore` já o ignora).
2. Instale as dependências: `npm install`
3. Rode as migrações: `npm run migrate`

Variáveis de ambiente:

| Nome | Formato | Uso |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://usuario:senha@host:porta/banco` | Conexão com o Postgres. Sem valor padrão; valores reais nunca ficam no repositório. Em produção (Neon), usar a connection string “pooled”. |
| `NEXT_PUBLIC_APP_URL` | `https://dominio` (opcional) | URL base pública usada na montagem dos links de sala; se ausente, deriva da requisição. |

## Comandos

```bash
npm run dev               # servidor de desenvolvimento (http://localhost:3000)
npm run build             # build de produção
npm run typecheck         # TypeScript, modo estrito
npm test                  # todos os testes
npm run test:unit         # testes unitários do domínio
npm run test:integration  # schema/persistência (Postgres embarcado, descartável)
npm run migrate           # aplica migrações pendentes em DATABASE_URL
```

## Modelo de dados

`db/migrations/0001_init.sql` cria: `rooms` (fase enumerada `HIPOTESES → MEDICOES →
REVELADO`, expiração em 14 dias), `groups` (1–4 por sala, status
`PENDENTE/PARTICIPANTE/AUSENTE`), `hypotheses` (uma por grupo, opção enumerada,
justificativa ≤ 200 caracteres), `measurements` (comprimento 50/100, repetição 1–3,
segundos entre 2 e 120, único por grupo/comprimento/repetição), `submissions` (uma
por grupo), `credentials` e `sessions` (apenas hash de token; papel coerente com a
presença/ausência de `group_id`; `group_id` pertence à mesma `room_id`, garantido por
chave estrangeira composta).

Regras de transição de fase, parsing de tempos (vírgula ou ponto, faixa 2–120 s) e
cálculos (média, período para 10 oscilações, amplitude, razão) ficam em `src/domain/`
e são testados isoladamente em `tests/unit/`.

## Status do desenvolvimento (PRD seção 13)

- [x] **Etapa 1 — Preparação:** projeto mínimo, migrações do modelo completo,
      camada de domínio, testes unitários e integração provando persistência.
- [x] **Etapa 2 — Acesso e domínio:** criação de sala com links de uso único na
      exibição (`POST /api/rooms`), troca de token do fragmento `#` por sessão
      com cookie `HttpOnly`/`Secure`/`SameSite=Lax` (`POST /api/session`,
      `GET /api/room` com matriz de acesso do PRD 4.2), tokens com 256 bits de
      entropia armazenados somente como hash (SHA-256), expiração ligada à sala
      (14 dias) e testes de isolamento entre papéis/salas.
- [x] **Etapa 3 — Previsão e controle:** confirmação de hipótese única e
      imutável (`POST /api/hypothesis`, transação com `SELECT ... FOR UPDATE`
      na sala, retry igual idempotente mesmo após mudança de fase, conteúdo
      diferente → 409) e avanço de fase somente do professor
      (`POST /api/room/advance`, recálculo de ausentes/pendentes sob bloqueio,
      confirmação da lista exata com divergência → 409, `AUSENTE` definido
      apenas na saída de `HIPOTESES`, sem pular/voltar fases).
- [ ] **Etapas 4–6:** medições e revelação, experiência, entrega da demo.

Etapa 3 implementa: formulário de previsão no painel do grupo (opções do PRD,
justificativa de até 200 caracteres, avisos de imutabilidade e de não inserir
dados pessoais) e controle de fases no painel do professor com confirmação
de ausentes/pendentes. O rate limit atual é em memória por instância (melhor
esforço, não distribuído — PRD 11); o limite real por IP será configurado na
infraestrutura (Neon/Vercel).

## Avisos

- Nenhum segredo é armazenado no repositório; tokens de links serão guardados
  somente como hash (implementação na etapa 2).
- Métricas científicas deste protótipo são heurísticas de interface
  (por exemplo, o aviso de amplitude acima de 10%); não constituem análise
  estatística nem comprovação de hipótese física.
- Referência de Física para revisão futura: [OpenStax, University Physics v1, §15.5 — Pendulums](https://openstax.org/books/university-physics-volume-1/pages/15-5-pendulums).
