CREATE TABLE events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number      text NOT NULL UNIQUE,
  name        text NOT NULL,
  type        text NOT NULL DEFAULT 'otro' CHECK (type IN ('casamiento','cumpleanos','corporativo','funebre','aniversario','otro')),
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  event_date  date,
  venue       text,
  guests      integer CHECK (guests IS NULL OR guests >= 0),
  status      text NOT NULL DEFAULT 'planificado' CHECK (status IN ('planificado','confirmado','realizado','cancelado')),
  notes       text,
  created_by  bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_date_idx ON events(event_date);
CREATE TRIGGER events_updated BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quotations (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number       text NOT NULL UNIQUE,
  event_id     bigint REFERENCES events(id) ON DELETE RESTRICT,
  customer_id  bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status       text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','enviada','aceptada','rechazada','convertida')),
  valid_until  date,
  subtotal_pyg bigint NOT NULL DEFAULT 0 CHECK (subtotal_pyg >= 0),
  discount_pyg bigint NOT NULL DEFAULT 0 CHECK (discount_pyg >= 0),
  total_pyg    bigint NOT NULL DEFAULT 0 CHECK (total_pyg >= 0),
  notes        text,
  decided_at   timestamptz, decision_note text,
  order_id     bigint UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  created_by   bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quotations_customer_idx ON quotations(customer_id);
CREATE INDEX quotations_event_idx ON quotations(event_id);
CREATE TRIGGER quotations_updated BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE quotation_items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  quotation_id   bigint NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  variant_id     bigint REFERENCES product_variants(id) ON DELETE RESTRICT,   -- NULL = ítem libre (servicio, decoración, montaje)
  description    text NOT NULL,
  qty            integer NOT NULL CHECK (qty > 0),
  unit_price_pyg bigint NOT NULL CHECK (unit_price_pyg >= 0),
  discount_pyg   bigint NOT NULL DEFAULT 0 CHECK (discount_pyg >= 0),
  line_total_pyg bigint NOT NULL CHECK (line_total_pyg >= 0)
);
CREATE INDEX quotation_items_q_idx ON quotation_items(quotation_id);
