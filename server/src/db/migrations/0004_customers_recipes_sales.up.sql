-- ── Clientes, destinatarios y direcciones (cliente y destinatario son entidades independientes) ──
CREATE TABLE customers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL DEFAULT 'persona' CHECK (kind IN ('persona','empresa','mayorista')),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  tax_id      text,                       -- RUC / CI tal como lo informa el cliente
  phone       text, email text, notes text, preferences text,
  active      boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_by  bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers (lower(name));
CREATE INDEX customers_phone_idx ON customers (phone);
CREATE TRIGGER customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE customer_addresses (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  label       text, address text NOT NULL CHECK (length(btrim(address)) > 0), zone text, reference text,
  is_default  boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_addresses_idx ON customer_addresses(customer_id) WHERE archived_at IS NULL;

CREATE TABLE customer_dates (            -- fechas importantes (cumpleaños, aniversarios…) para recordar al cliente
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label       text NOT NULL, month smallint NOT NULL CHECK (month BETWEEN 1 AND 12), day smallint NOT NULL CHECK (day BETWEEN 1 AND 31), note text
);
CREATE INDEX customer_dates_idx ON customer_dates(customer_id);

CREATE TABLE recipients (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id bigint REFERENCES customers(id) ON DELETE RESTRICT,   -- quién suele enviarle flores (opcional, reutilizable)
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  phone       text, address text, zone text, reference text, notes text,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recipients_customer_idx ON recipients(customer_id);
CREATE TRIGGER recipients_updated BEFORE UPDATE ON recipients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Recetas / composición de arreglos ──
ALTER TABLE product_variants ADD COLUMN recipe_enabled boolean NOT NULL DEFAULT true;
CREATE TABLE recipe_components (
  variant_id           bigint NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  component_product_id bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty                  numeric(14,3) NOT NULL CHECK (qty > 0),
  PRIMARY KEY (variant_id, component_product_id)
);
CREATE INDEX recipe_components_product_idx ON recipe_components(component_product_id);
CREATE TABLE recipe_extra_costs (        -- mano de obra, energía u otros costos configurables por arreglo
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  variant_id bigint NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  concept    text NOT NULL CHECK (length(btrim(concept)) > 0),
  amount_pyg bigint NOT NULL CHECK (amount_pyg >= 0)
);
CREATE INDEX recipe_extra_costs_idx ON recipe_extra_costs(variant_id);

-- ── Caja ──
CREATE TABLE cash_sessions (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  opened_by          bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opened_at          timestamptz NOT NULL DEFAULT now(),
  opening_amount_pyg bigint NOT NULL CHECK (opening_amount_pyg >= 0),
  closed_by          bigint REFERENCES users(id) ON DELETE RESTRICT,
  closed_at          timestamptz,
  expected_cash_pyg  bigint,
  counted_cash_pyg   bigint CHECK (counted_cash_pyg IS NULL OR counted_cash_pyg >= 0),
  difference_pyg     bigint,
  note               text,
  CHECK ((closed_at IS NULL) = (counted_cash_pyg IS NULL))
);
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions ((true)) WHERE closed_at IS NULL;   -- una sola caja abierta a la vez

CREATE TABLE cash_movements (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id     bigint NOT NULL REFERENCES cash_sessions(id) ON DELETE RESTRICT,
  type           text NOT NULL CHECK (type IN ('apertura','venta','cobro','ingreso','egreso','retiro','devolucion','pago_proveedor','gasto')),
  amount_pyg     bigint NOT NULL CHECK (amount_pyg <> 0),     -- con signo: + entra efectivo, − sale
  concept        text,
  reference_type text, reference_id bigint,
  user_id        bigint REFERENCES users(id) ON DELETE RESTRICT,
  at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_movements_session_idx ON cash_movements(session_id, id);
CREATE FUNCTION cash_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'cash_movements es append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER cash_movements_no_change BEFORE UPDATE OR DELETE ON cash_movements FOR EACH ROW EXECUTE FUNCTION cash_movements_immutable();
CREATE TRIGGER cash_movements_no_truncate BEFORE TRUNCATE ON cash_movements FOR EACH STATEMENT EXECUTE FUNCTION cash_movements_immutable();

ALTER TABLE payable_payments ADD COLUMN cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT;

-- ── Ventas ──
CREATE TABLE sales (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  customer_id      bigint REFERENCES customers(id) ON DELETE RESTRICT,
  channel          text NOT NULL DEFAULT 'mostrador' CHECK (channel IN ('mostrador','web','whatsapp','instagram','telefono','evento','mayorista')),
  status           text NOT NULL DEFAULT 'confirmada' CHECK (status IN ('confirmada','anulada')),
  subtotal_pyg     bigint NOT NULL CHECK (subtotal_pyg >= 0),
  discount_pyg     bigint NOT NULL DEFAULT 0 CHECK (discount_pyg >= 0),
  delivery_fee_pyg bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_pyg >= 0),
  total_pyg        bigint NOT NULL CHECK (total_pyg >= 0),
  paid_pyg         bigint NOT NULL DEFAULT 0 CHECK (paid_pyg >= 0),
  credit_due_date  date,
  notes            text,
  cash_session_id  bigint REFERENCES cash_sessions(id) ON DELETE RESTRICT,
  created_by       bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  voided_by        bigint REFERENCES users(id) ON DELETE RESTRICT,
  voided_at        timestamptz,
  void_reason      text,
  CHECK (paid_pyg <= total_pyg),
  CHECK (discount_pyg <= subtotal_pyg),
  CHECK (total_pyg = subtotal_pyg - discount_pyg + delivery_fee_pyg),
  CHECK ((status = 'anulada') = (voided_at IS NOT NULL))
);
CREATE INDEX sales_created_idx ON sales(created_at DESC);
CREATE INDEX sales_customer_idx ON sales(customer_id);
CREATE INDEX sales_status_idx ON sales(status, created_at DESC);

CREATE TABLE sale_items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id        bigint NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  variant_id     bigint NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  description    text NOT NULL,                       -- nombre del producto/variante al momento de vender
  qty            integer NOT NULL CHECK (qty > 0),
  unit_price_pyg bigint NOT NULL CHECK (unit_price_pyg >= 0),   -- precio congelado
  discount_pyg   bigint NOT NULL DEFAULT 0 CHECK (discount_pyg >= 0),
  line_total_pyg bigint NOT NULL CHECK (line_total_pyg >= 0),
  cost_total_pyg bigint NOT NULL DEFAULT 0 CHECK (cost_total_pyg >= 0),   -- costo real congelado (componentes + extras)
  cost_known     boolean NOT NULL DEFAULT false,      -- false = no hay receta/costo: el margen no es confiable
  CHECK (line_total_pyg = qty * unit_price_pyg - discount_pyg)
);
CREATE INDEX sale_items_sale_idx ON sale_items(sale_id);
CREATE INDEX sale_items_product_idx ON sale_items(product_id);

CREATE TABLE payments (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id          bigint NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  method_id        smallint NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  amount_pyg       bigint NOT NULL CHECK (amount_pyg > 0),
  reference        text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  user_id          bigint REFERENCES users(id) ON DELETE RESTRICT,
  cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT
);
CREATE INDEX payments_sale_idx ON payments(sale_id);
CREATE INDEX payments_received_idx ON payments(received_at DESC);
CREATE TABLE sale_refunds (               -- devoluciones de dinero por anulación (contra-asiento de payments)
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sale_id          bigint NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  payment_id       bigint NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  method_id        smallint NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  amount_pyg       bigint NOT NULL CHECK (amount_pyg > 0),
  reason           text,
  user_id          bigint REFERENCES users(id) ON DELETE RESTRICT,
  at               timestamptz NOT NULL DEFAULT now(),
  cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT
);
CREATE INDEX sale_refunds_sale_idx ON sale_refunds(sale_id);
CREATE FUNCTION payments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% es append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER payments_no_change BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_immutable();
CREATE TRIGGER sale_refunds_no_change BEFORE UPDATE OR DELETE ON sale_refunds FOR EACH ROW EXECUTE FUNCTION payments_immutable();
