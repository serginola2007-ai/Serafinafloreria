-- ── Producto: unidad de medida y costo promedio ponderado (guaraníes enteros por unidad) ──
ALTER TABLE products
  ADD COLUMN unit text NOT NULL DEFAULT 'unidad' CHECK (length(btrim(unit)) BETWEEN 1 AND 20),
  ADD COLUMN avg_cost_pyg bigint NOT NULL DEFAULT 0 CHECK (avg_cost_pyg >= 0);

-- ── Configuración reutilizable ──
CREATE TABLE payment_methods (
  id          smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  name        text NOT NULL,
  affects_cash boolean NOT NULL DEFAULT false,   -- el efectivo mueve la caja física
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);
INSERT INTO payment_methods(code, name, affects_cash, sort_order) VALUES
  ('efectivo', 'Efectivo', true, 1), ('transferencia', 'Transferencia', false, 2), ('tarjeta', 'Tarjeta', false, 3), ('qr', 'QR', false, 4), ('otro', 'Otro', false, 5);

CREATE TABLE number_sequences (
  key        text PRIMARY KEY,
  last_value bigint NOT NULL DEFAULT 0
);

CREATE TABLE stock_locations (
  id     smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code   text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),
  name   text NOT NULL,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO stock_locations(code, name) VALUES ('principal', 'Local principal');

CREATE TABLE waste_reasons (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       text NOT NULL UNIQUE CHECK (code ~ '^[a-z_]+$'),
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
INSERT INTO waste_reasons(code, name, sort_order) VALUES
  ('flor_marchita', 'Flor marchita', 1), ('producto_danado', 'Producto dañado', 2), ('vencimiento', 'Vencimiento', 3),
  ('error_produccion', 'Error de producción', 4), ('uso_interno', 'Uso interno', 5), ('evento', 'Evento', 6), ('rotura', 'Rotura', 7), ('otro', 'Otro', 8);

-- ── Proveedores ──
CREATE TABLE suppliers (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name               text NOT NULL CHECK (length(btrim(name)) > 0),
  tax_id             text,                       -- RUC tal cual lo informa el proveedor (sin validar reglas fiscales no confirmadas)
  phone              text, email text, address text, contact_name text, notes text,
  payment_terms_days integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  active             boolean NOT NULL DEFAULT true,
  archived_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX suppliers_tax_id_uidx ON suppliers(tax_id) WHERE tax_id IS NOT NULL AND archived_at IS NULL;
CREATE TRIGGER suppliers_updated BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE supplier_products (
  supplier_id    bigint NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  supplier_sku   text,
  last_price_pyg bigint CHECK (last_price_pyg IS NULL OR last_price_pyg >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier_id, product_id)
);
CREATE TABLE supplier_price_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  product_id  bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  price_pyg   bigint NOT NULL CHECK (price_pyg >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  source      text NOT NULL DEFAULT 'compra',
  reference_id bigint
);
CREATE INDEX supplier_price_hist_idx ON supplier_price_history(supplier_id, product_id, recorded_at DESC);

-- ── Compras ──
CREATE TABLE purchase_orders (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number      text NOT NULL UNIQUE,
  supplier_id bigint NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status      text NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador','enviada','parcial','recibida','cancelada')),
  expected_at date,
  notes       text,
  created_by  bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz,
  closed_at   timestamptz
);
CREATE INDEX purchase_orders_status_idx ON purchase_orders(status, created_at DESC);
CREATE INDEX purchase_orders_supplier_idx ON purchase_orders(supplier_id);
CREATE TRIGGER purchase_orders_updated BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_order_items (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  po_id         bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id    bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_ordered   numeric(14,3) NOT NULL CHECK (qty_ordered > 0),
  unit_cost_pyg bigint NOT NULL CHECK (unit_cost_pyg >= 0),
  qty_received  numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0 AND qty_received <= qty_ordered),
  UNIQUE (po_id, product_id)
);

CREATE TABLE purchase_receipts (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number              text NOT NULL UNIQUE,
  po_id               bigint NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id         bigint NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  supplier_invoice_no text,
  invoice_date        date,
  received_by         bigint REFERENCES users(id) ON DELETE RESTRICT,
  received_at         timestamptz NOT NULL DEFAULT now(),
  total_pyg           bigint NOT NULL CHECK (total_pyg >= 0),
  note                text
);
CREATE INDEX purchase_receipts_po_idx ON purchase_receipts(po_id);
CREATE TABLE purchase_receipt_items (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  receipt_id    bigint NOT NULL REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  po_item_id    bigint NOT NULL REFERENCES purchase_order_items(id) ON DELETE RESTRICT,
  product_id    bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty           numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost_pyg bigint NOT NULL CHECK (unit_cost_pyg >= 0),
  expires_at    date
);
CREATE INDEX purchase_receipt_items_idx ON purchase_receipt_items(receipt_id);

-- ── Inventario ──
CREATE TABLE inventory_levels (
  product_id  bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id smallint NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  on_hand     numeric(14,3) NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  reserved    numeric(14,3) NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  min_stock   numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  max_stock   numeric(14,3) CHECK (max_stock IS NULL OR max_stock >= min_stock),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, location_id),
  CHECK (reserved <= on_hand)                      -- nunca se reserva más de lo que hay (evita sobreventa)
);

CREATE TABLE inventory_lots (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id    bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id   smallint NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  supplier_id   bigint REFERENCES suppliers(id) ON DELETE RESTRICT,
  receipt_id    bigint REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  purchased_at  date,
  received_at   timestamptz NOT NULL DEFAULT now(),
  expires_at    date,                              -- vencimiento / fecha estimada de deterioro
  qty_initial   numeric(14,3) NOT NULL CHECK (qty_initial > 0),
  qty_remaining numeric(14,3) NOT NULL CHECK (qty_remaining >= 0 AND qty_remaining <= qty_initial),
  unit_cost_pyg bigint NOT NULL CHECK (unit_cost_pyg >= 0),
  note          text
);
CREATE INDEX inventory_lots_fefo_idx ON inventory_lots(product_id, location_id, expires_at NULLS LAST, received_at, id) WHERE qty_remaining > 0;

CREATE TABLE waste_records (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id smallint NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  reason_id   smallint NOT NULL REFERENCES waste_reasons(id) ON DELETE RESTRICT,
  qty         numeric(14,3) NOT NULL CHECK (qty > 0),
  cost_pyg    bigint NOT NULL CHECK (cost_pyg >= 0),
  note        text,
  user_id     bigint REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX waste_records_idx ON waste_records(occurred_at DESC);
CREATE INDEX waste_records_product_idx ON waste_records(product_id, occurred_at DESC);

CREATE TABLE inventory_movements (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id    smallint NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  lot_id         bigint REFERENCES inventory_lots(id) ON DELETE RESTRICT,
  type           text NOT NULL CHECK (type IN ('compra','venta','produccion','consumo','devolucion','merma','ajuste_positivo','ajuste_negativo','transferencia','uso_interno','evento')),
  qty            numeric(14,3) NOT NULL CHECK (qty <> 0),          -- con signo: + entra, − sale
  unit_cost_pyg  bigint NOT NULL CHECK (unit_cost_pyg >= 0),
  reason         text,
  reference_type text,
  reference_id   bigint,
  user_id        bigint REFERENCES users(id) ON DELETE RESTRICT,
  note           text,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements(product_id, occurred_at DESC, id DESC);
CREATE INDEX inventory_movements_ref_idx ON inventory_movements(reference_type, reference_id);
CREATE INDEX inventory_movements_type_idx ON inventory_movements(type, occurred_at DESC);

-- El historial de movimientos es inmutable: las correcciones son movimientos de signo contrario.
CREATE FUNCTION inventory_movements_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'inventory_movements es append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER inventory_movements_no_change BEFORE UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_movements_immutable();
CREATE TRIGGER inventory_movements_no_truncate BEFORE TRUNCATE ON inventory_movements FOR EACH STATEMENT EXECUTE FUNCTION inventory_movements_immutable();

-- ── Cuentas por pagar ──
CREATE TABLE payables (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  receipt_id  bigint NOT NULL UNIQUE REFERENCES purchase_receipts(id) ON DELETE RESTRICT,
  invoice_no  text,
  total_pyg   bigint NOT NULL CHECK (total_pyg >= 0),
  paid_pyg    bigint NOT NULL DEFAULT 0 CHECK (paid_pyg >= 0 AND paid_pyg <= total_pyg),
  due_date    date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payables_due_idx ON payables(due_date) WHERE paid_pyg < total_pyg;
CREATE INDEX payables_supplier_idx ON payables(supplier_id);
CREATE TRIGGER payables_updated BEFORE UPDATE ON payables FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE payable_payments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payable_id  bigint NOT NULL REFERENCES payables(id) ON DELETE RESTRICT,
  amount_pyg  bigint NOT NULL CHECK (amount_pyg > 0),
  method_id   smallint NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  reference   text,
  paid_at     timestamptz NOT NULL DEFAULT now(),
  user_id     bigint REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX payable_payments_idx ON payable_payments(payable_id);
CREATE FUNCTION payable_payments_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payable_payments es append-only' USING ERRCODE = 'insufficient_privilege'; END $$;
CREATE TRIGGER payable_payments_no_change BEFORE UPDATE OR DELETE ON payable_payments FOR EACH ROW EXECUTE FUNCTION payable_payments_immutable();

