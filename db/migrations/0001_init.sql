-- Migração inicial: modelo da seção 8.1 do PRD.
-- Invariantes: fase enumerada (irreversibilidade de transição é aplicada na camada de domínio),
-- grupos 1..4 por sala, hipótese única por grupo, medições únicas por grupo/comprimento/repetição,
-- submissão única por grupo criada junto com as seis medições (mesma transação, na aplicação),
-- credenciais/sessões armazenam apenas hash de token.

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase TEXT NOT NULL DEFAULT 'HIPOTESES'
    CHECK (phase IN ('HIPOTESES', 'MEDICOES', 'REVELADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT rooms_expires_after_created CHECK (expires_at > created_at)
);

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  numero INT NOT NULL CHECK (numero BETWEEN 1 AND 4),
  status TEXT NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'PARTICIPANTE', 'AUSENTE')),
  UNIQUE (id, room_id),
  UNIQUE (room_id, numero)
);

CREATE TABLE hypotheses (
  group_id UUID PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  opcao TEXT NOT NULL CHECK (opcao IN ('MENOR', 'IGUAL', 'MAIOR_SEM_DOBRAR', 'DOBRA')),
  justificativa TEXT CHECK (justificativa IS NULL OR char_length(justificativa) <= 200),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE measurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  comprimento_cm INT NOT NULL CHECK (comprimento_cm IN (50, 100)),
  repeticao INT NOT NULL CHECK (repeticao IN (1, 2, 3)),
  segundos NUMERIC(6, 3) NOT NULL CHECK (segundos >= 2 AND segundos <= 120),
  UNIQUE (group_id, comprimento_cm, repeticao)
);

CREATE TABLE submissions (
  group_id UUID PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE credentials (
  token_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('PROFESSOR', 'GRUPO')),
  room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  -- (group_id, room_id) referenciando (id, room_id) de groups garante que um
  -- credential de grupo aponta para um grupo da mesma sala.
  CONSTRAINT credentials_group_same_room
    FOREIGN KEY (group_id, room_id) REFERENCES groups (id, room_id) ON DELETE CASCADE,
  CONSTRAINT credentials_role_matches_group CHECK (
    (role = 'PROFESSOR' AND group_id IS NULL)
    OR (role = 'GRUPO' AND group_id IS NOT NULL)
  )
);

CREATE TABLE sessions (
  session_id_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('PROFESSOR', 'GRUPO')),
  room_id UUID NOT NULL REFERENCES rooms (id) ON DELETE CASCADE,
  group_id UUID,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT sessions_group_same_room
    FOREIGN KEY (group_id, room_id) REFERENCES groups (id, room_id) ON DELETE CASCADE,
  CONSTRAINT sessions_role_matches_group CHECK (
    (role = 'PROFESSOR' AND group_id IS NULL)
    OR (role = 'GRUPO' AND group_id IS NOT NULL)
  )
);

CREATE INDEX groups_room_idx ON groups (room_id, numero);
CREATE INDEX sessions_room_idx ON sessions (room_id, role);
