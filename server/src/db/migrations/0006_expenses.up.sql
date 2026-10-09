-- Gastos operativos. Las compras de mercadería NO son gastos: entran al inventario y llegan al resultado como costo de lo vendido.
CREATE TABLE expense_categories (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX expense_categories_name_uq ON expense_categories (lower(name));

CREATE TABLE expenses (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  category_id      integer NOT NULL REFERENCES expense_categories(id) ON DELETE RESTRICT,
  concept          text NOT NULL,
  amount_pyg       bigint NOT NULL CHECK (amount_pyg > 0),
  expense_date     date NOT NULL,
  method_id        smallint NOT NULL REFERENCES payment_methods(id) ON DELETE RESTRICT,
  supplier_id      bigint REFERENCES suppliers(id) ON DELETE RESTRICT,
  document_no      text,                         -- nº de factura/recibo del proveedor (dato informativo)
  notes            text,
  cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'registrado' CHECK (status IN ('registrado','anulado')),
  voided_at        timestamptz, voided_by bigint REFERENCES users(id) ON DELETE RESTRICT, void_reason text,
  void_cash_movement_id bigint REFERENCES cash_movements(id) ON DELETE RESTRICT,
  created_by       bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'anulado') = (voided_at IS NOT NULL))
);
CREATE INDEX expenses_date_idx ON expenses(expense_date DESC, id DESC);
CREATE INDEX expenses_category_idx ON expenses(category_id);
