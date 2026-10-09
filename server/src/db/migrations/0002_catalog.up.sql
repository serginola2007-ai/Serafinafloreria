-- Archivos multimedia. Los de la web actual viven en el repositorio (storage='legacy'); los subidos desde el
-- panel van a object storage compatible con S3 (storage='object'). La base guarda solo la referencia.
CREATE TABLE media (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  storage       text NOT NULL CHECK (storage IN ('legacy','object')),
  storage_key   text NOT NULL,
  mime          text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes >= 0),
  sha256        char(64) NOT NULL,
  original_name text,
  alt_text      text,
  is_public     boolean NOT NULL DEFAULT true,
  created_by    bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at    timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz,
  UNIQUE (storage, storage_key)
);
CREATE INDEX media_sha_idx ON media(sha256);

CREATE TABLE product_categories (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug           text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name           text NOT NULL,
  description    text,
  cover_media_id bigint REFERENCES media(id) ON DELETE RESTRICT,
  sort_order     integer NOT NULL DEFAULT 0,
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  archived_at    timestamptz
);
CREATE TRIGGER product_categories_updated BEFORE UPDATE ON product_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Categorías fiscales configurables. Vacía a propósito: las tasas se cargan cuando el contador las confirme.
-- rate_percent NULL = "pendiente de configurar".
CREATE TABLE tax_categories (
  id           smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  rate_percent numeric(5,2) CHECK (rate_percent IS NULL OR rate_percent BETWEEN 0 AND 100),
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE products (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legacy_id    text UNIQUE,
  slug         text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  sku          text UNIQUE,
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  description  text,
  category_id  bigint REFERENCES product_categories(id) ON DELETE RESTRICT,
  kind         text NOT NULL DEFAULT 'finished'
               CHECK (kind IN ('finished','raw_flower','foliage','supply','accessory','packaging')),
  is_sellable  boolean NOT NULL DEFAULT true,
  is_stockable boolean NOT NULL DEFAULT false,
  is_composite boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  needs_review boolean NOT NULL DEFAULT false,
  review_note  text,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz,
  CHECK (needs_review = (review_note IS NOT NULL))
);
CREATE INDEX products_category_idx ON products(category_id, sort_order) WHERE archived_at IS NULL;
CREATE TRIGGER products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE product_variants (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id       bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  sku              text UNIQUE,
  label            text NOT NULL CHECK (length(btrim(label)) > 0),
  price_pyg        bigint NOT NULL CHECK (price_pyg >= 0),          -- Guaraníes enteros
  cost_override_pyg bigint CHECK (cost_override_pyg IS NULL OR cost_override_pyg >= 0),
  tax_category_id  smallint REFERENCES tax_categories(id) ON DELETE RESTRICT,
  sort_order       integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, label)
);
CREATE TRIGGER product_variants_updated BEFORE UPDATE ON product_variants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE variant_price_history (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id bigint NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  price_pyg  bigint NOT NULL CHECK (price_pyg >= 0),
  valid_from timestamptz NOT NULL DEFAULT now(),
  changed_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  reason     text
);
CREATE INDEX price_history_variant_idx ON variant_price_history(variant_id, valid_from DESC);

CREATE TABLE product_media (
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_id   bigint NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, media_id)
);
CREATE INDEX product_media_media_idx ON product_media(media_id);
