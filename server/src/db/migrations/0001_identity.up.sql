CREATE EXTENSION IF NOT EXISTS citext;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE roles (
  id            smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code          text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  name          text NOT NULL,
  description   text,
  is_system     boolean NOT NULL DEFAULT false,
  is_superuser  boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+\.[a-z_]+$'),
  module      text NOT NULL,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id       smallint NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                citext NOT NULL UNIQUE,
  full_name            text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 120),
  password_hash        text NOT NULL,
  role_id              smallint NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  active               boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_attempts      integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until         timestamptz,
  last_login_at        timestamptz,
  created_by           bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_role_idx ON users(role_id);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Ajustes por usuario sobre los permisos de su rol (rol "Personalizado" y excepciones).
CREATE TABLE user_permissions (
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id smallint NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  effect        text NOT NULL CHECK (effect IN ('allow','deny')),
  granted_by    bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

CREATE TABLE sessions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash   bytea NOT NULL UNIQUE,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text
);
CREATE INDEX sessions_user_idx ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE audit_logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    bigint REFERENCES users(id) ON DELETE RESTRICT,
  action     text NOT NULL,
  entity     text,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  ip         text,
  user_agent text,
  request_id text
);
CREATE INDEX audit_entity_idx ON audit_logs(entity, entity_id, at DESC);
CREATE INDEX audit_user_idx ON audit_logs(user_id, at DESC);
CREATE INDEX audit_action_idx ON audit_logs(action, at DESC);

-- La auditoría es inmutable: ni UPDATE, ni DELETE, ni TRUNCATE.
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs es append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]+$'),
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint REFERENCES users(id) ON DELETE RESTRICT
);
