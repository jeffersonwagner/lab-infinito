# Checklist de deploy — Laboratório Invisível

> Protótipo Hack Brasil 2026. Execute este checklist **somente com autorização
> do Jeff**. Nenhum segredo real entra neste documento, no código ou em
> capturas de tela. Preencha as caixas conforme executa.

Decisões já combinadas: banco **Neon** (Postgres gerenciado, sem VPS) +
hospedagem **Vercel** (Next.js). Custo-alvo: zero.

---

## 0. Pré-requisitos (responsável: Jeff)

- [ ] Conta no [Neon](https://neon.tech) criada (plano gratuito).
- [ ] Conta na [Vercel](https://vercel.com) criada, com acesso ao repositório
      `jeffersonwagner/lab-infinito`.
- [ ] Default branch do GitHub mudada para `main`
      (Settings → Branches; a branch de tarefa
      `vibe/preparacao-persistencia-05b0c7` contém o código).
- [ ] Decisões pendentes confirmadas:
      - Rate limiting de borda: verificar se o plano da Vercel inclui
        Vercel Firewall/WAF; se não incluir, registrar o risco (o limite
        in-memory do app é melhor esforço, não distribuído — PRD 11).
      - Frequência do cron de limpeza (o `vercel.json` já define diária às
        03:00 UTC; o plano Hobby da Vercel permite crons diários).

## 1. Neon — banco de dados (responsável: Jeff)

- [ ] Criar projeto (ex.: `lab-invisivel`), região mais próxima dos usuários
      (ex.: `aws us-east-1`).
- [ ] Copiar a **connection string pooled** (contém `-pooler` no host) —
      usar como `DATABASE_URL`.
- [ ] **Não** commitar essa string em lugar nenhum; ela vai só nas variáveis
      de ambiente da Vercel (e, localmente, no `.env`, que o `.gitignore` já
      ignora).

## 2. Migrações (responsável: Jeff, localmente)

```bash
# no diretório do projeto, com DATABASE_URL apontando para o Neon:
npm ci
DATABASE_URL="postgresql://…pooled…" npm run migrate
```

- [ ] Saída confirma aplicação da migração `0001_init` (verificar também no
      painel do Neon: tabelas `rooms`, `groups`, `hypotheses`,
      `measurements`, `submissions`, `credentials`, `sessions`,
      `schema_migrations`).

## 3. Vercel — aplicação (responsável: Jeff)

- [ ] Importar o repositório (Framework: Next.js detectado; build
      `next build`, sem comandos extras).
- [ ] Configurar variáveis de ambiente (Production **e** Preview):

| Variável | Valor | Observações |
| --- | --- | --- |
| `DATABASE_URL` | connection string **pooled** do Neon | obrigatória |
| `NEXT_PUBLIC_APP_URL` | `https://<dominio-da-demo>` | usar o domínio final; se ficar em branco, os links derivam da requisição |
| `CLEANUP_SECRET` | string aleatória (ex.: `openssl rand -base64 32`) | habilita a rotina de limpeza; nunca compartilhar |

- [ ] Deploy e anotar a URL pública: `________________`
- [ ] Conferir que `NEXT_PUBLIC_APP_URL` corresponde ao domínio final
      (os links de sala são montados com ele).

## 4. Verificação funcional (perfis de navegador separados para cada papel)

- [ ] Abrir a landing **sem conta**: criar sala com **2 grupos**; conferir
      que professor + 2 links de grupo aparecem **uma única vez**, com aviso
      de perda, e que copiar funciona.
- [ ] Abrir o link do professor em um perfil; cada link de grupo em perfis
      distintos (PRD 8.2: não usar a mesma aba para múltiplos papéis).
- [ ] Fase HIPOTESES: cada grupo escolhe uma opção e justificativa fictícia
      (ex.: “Grupo Três — dado fictício”); conferir imutabilidade (reload não
      permite alterar) e o aviso de não inserir dados pessoais.
- [ ] Avanço: com todos responderam, o avanço não pede confirmação; criar
      outra sala com um grupo sem responder e conferir que o professor vê a
      lista de ausentes, que divergência gera nova confirmação (409) e que o
      grupo fica AUSENTE.
- [ ] Fase MEDICOES: enviar os **dados fictícios da seção 6 do PRD**
      (50 cm: 14,1 / 14,2 / 14,3; 100 cm: 20,0 / 20,1 / 20,2); conferir que
      a revelação mostra razão **1,42** e que vírgula e ponto são aceitos.
- [ ] Revelação: participante pendente aparece como **sem medição** (nunca
      zero); grupo ausente vê status e resultados dos participantes; pergunta
      de discussão visível no painel do grupo.
- [ ] Recarregar cada painel: identidade (papel/grupo) continua exibida;
      interromper a rede e voltar: entradas não enviadas são preservadas e a
      tela permite nova tentativa.
- [ ] Duas abas no mesmo perfil com links diferentes: a aba antiga recebe
      aviso de sessão divergente (409) e é orientada a reabrir o link
      correto; não consegue ler nem escrever como a outra identidade.

## 5. Verificação de segurança/operação

- [ ] `curl -sI https://<dominio>/api/room` → `Cache-Control: no-store`
      presente nas rotas sensíveis (`/api/room`, `/api/hypothesis`,
      `/api/measurements/submit`, `/api/room/advance`, `/api/cron/cleanup`).
- [ ] `curl -s https://<dominio>/api/cron/cleanup` **sem** segredo → 503 ou
      403; com segredo → `{"ok":true,"removidas":0}` (nunca com segredo real
      em comandos colados em lugares públicos).
- [ ] Cron ativo no painel da Vercel (Settings → Cron Jobs) e com execução
      registrada; se o plano não executar o cron, **relatar bloqueio ao Jeff
      e combinar alternativa** antes de declarar pronto (PRD 11).
- [ ] Logs da Vercel sem tokens, cookies, links ou justificativas.
- [ ] Sala criada na verificação funcional expira em 14 dias; acesso após
      expiração é negado mesmo sem limpeza (testado em integração; conferir
      no ar se possível com uma sala com expiração retroativa — opcional).

## 6. Dados da demo

- [ ] Somente dados **fictícios e identificados como tais** (ex.: “Grupo 1 —
      dado fictício”). Nenhum dado pessoal real de terceiros (PRD 11/15).
- [ ] Página inicial informa que é protótipo.

## 7. Material para o Douglas (submissão Hack Brasil)

- [ ] Link do repositório público: `https://github.com/jeffersonwagner/lab-infinito`
      (com commits posteriores a 04/11/2026 21h, sem histórico importado).
- [ ] Link da demo: `________________` (no ar durante toda a avaliação).
- [ ] Roteiro de vídeo (≤ 3 min, sem login para o júri):
      1. Problema (10 s): registrar previsões antes do experimento.
      2. Professor cria sala com 2 grupos e copia os links (30 s).
      3. Dois grupos (perfis separados) registram previsões diferentes (40 s).
      4. Professor avança; grupos enviam as medições fictícias da seção 6 (40 s).
      5. Revelação: comparação, razão 1,42 e discussão (40 s).
      6. Aviso de protótipo e dados fictícios (10 s).
- [ ] Descrição/frase do painel de submissão preparadas por Jeff/Douglas.

## 8. Se algo falhar

- Deploy falha no build: rodar `npm run build` local com as mesmas variáveis;
  corrigir antes de tentar de novo.
- Erro de conexão com o Neon: conferir se a string é a **pooled** e se o IP
  do serviço permite conexão (Neon aceita por padrão; SSL exigido — a string
  do Neon já inclui `sslmode=require`).
- Cron não executa: relatar ao Jeff (PRD 11 — não simular funcionamento).
- Qualquer vazamento suspeito de segredo/token: revogar/rotacionar
  imediatamente (Neon: resetar senha do banco; Vercel: regerar
  `CLEANUP_SECRET`) e reportar.
