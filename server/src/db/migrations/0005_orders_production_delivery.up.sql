-- ── Pedidos ──
CREATE TABLE orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  number           text NOT NULL UNIQUE,
  customer_id      bigint REFERENCES customers(id) ON DELETE RESTRICT,
  recipient_id     bigint REFERENCES recipients(id) ON DELETE RESTRICT,
  channel          text NOT NULL DEFAULT 'mostrador' CHECK (channel IN ('mostrador','web','whatsapp','instagram','telefono','evento','mayorista')),
  status           text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('consulta','cotizacion','pendiente','confirmado','pendiente_pago','pagado','en_preparacion','listo','en_reparto','entregado','cancelado','reprogramado','no_entregado')),
  delivery_type    text NOT NULL DEFAULT 'delivery' CHECK (delivery_type IN ('delivery','retiro')),
  requested_date   date,
  time_slot        text,
  -- datos de entrega al momento del pedido (el destinatario y su dirección se guardan aparte del cliente)
  ship_name        text, ship_phone text, ship_address text, ship_zone text, ship_reference text,
  card_message     text, notes text,
  subtotal_pyg     bigint NOT NULL CHECK (subtotal_pyg >= 0),
  discount_pyg     bigint NOT NULL DEFAULT 0 CHECK (discount_pyg >= 0),
  delivery_fee_pyg bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_pyg >= 0),
  total_pyg        bigint NOT NULL CHECK (total_pyg >= 0),
  credit_due_date  date,
  attribution_source text, attribution_medium text, attribution_campaign text,   -- de dónde llegó el pedido (para "qué canal vende más")
  sale_id          bigint UNIQUE REFERENCES sales(id) ON DELETE RESTRICT,
  cancel_reason    text, cancelled_at timestamptz, cancelled_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_by       bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_pyg <= subtotal_pyg),
  CHECK (total_pyg = subtotal_pyg - discount_pyg + delivery_fee_pyg)
);
CREATE INDEX orders_status_idx ON orders(status, requested_date);
CREATE INDEX orders_customer_idx ON orders(customer_id);
CREATE INDEX orders_created_idx ON orders(created_at DESC);
CREATE INDEX orders_date_idx ON orders(requested_date) WHERE status NOT IN ('cancelado','entregado');
CREATE TRIGGER orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE order_items (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       bigint NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  variant_id     bigint NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  product_id     bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  description    text NOT NULL,
  qty            integer NOT NULL CHECK (qty > 0),
  unit_price_pyg bigint NOT NULL CHECK (unit_price_pyg >= 0),
  discount_pyg   bigint NOT NULL DEFAULT 0 CHECK (discount_pyg >= 0),
  line_total_pyg bigint NOT NULL CHECK (line_total_pyg >= 0),
  CHECK (line_total_pyg = qty * unit_price_pyg - discount_pyg)
);
CREATE INDEX order_items_order_idx ON order_items(order_id);

CREATE TABLE order_status_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status text, to_status text NOT NULL,
  user_id     bigint REFERENCES users(id) ON DELETE RESTRICT,
  note        text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_idx ON order_status_history(order_id, id);

-- Reserva de stock por pedido (físico − reservado = disponible)
CREATE TABLE stock_reservations (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  product_id  bigint NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  location_id smallint NOT NULL REFERENCES stock_locations(id) ON DELETE RESTRICT,
  qty         numeric(14,3) NOT NULL CHECK (qty >= 0),           -- cantidad AÚN reservada
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed','released')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  closed_at   timestamptz,
  UNIQUE (order_id, product_id),
  CHECK ((status = 'active') = (closed_at IS NULL))
);
CREATE INDEX stock_reservations_product_idx ON stock_reservations(product_id) WHERE status = 'active';

-- ── Producción ──
CREATE TABLE production_orders (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id       bigint NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  order_item_id  bigint NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
  variant_id     bigint NOT NULL REFERENCES product_variants(id) ON DELETE RESTRICT,
  description    text NOT NULL,
  qty            integer NOT NULL CHECK (qty > 0),
  status         text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','en_preparacion','control_calidad','listo','cancelado')),
  assigned_to    bigint REFERENCES users(id) ON DELETE RESTRICT,
  cost_total_pyg bigint NOT NULL DEFAULT 0 CHECK (cost_total_pyg >= 0),   -- costo real de los materiales consumidos
  cost_known     boolean NOT NULL DEFAULT false,
  notes          text,
  started_at     timestamptz, quality_at timestamptz, ready_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_orders_status_idx ON production_orders(status, order_id);
CREATE INDEX production_orders_order_idx ON production_orders(order_id);
CREATE TRIGGER production_orders_updated BEFORE UPDATE ON production_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE production_checklist (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  production_order_id bigint NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  position            smallint NOT NULL,
  code                text NOT NULL,
  step                text NOT NULL,
  done                boolean NOT NULL DEFAULT false,
  done_by             bigint REFERENCES users(id) ON DELETE RESTRICT,
  done_at             timestamptz,
  UNIQUE (production_order_id, code)
);

-- ── Delivery ──
CREATE TABLE delivery_zones (
  id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  fee_pyg    bigint NOT NULL CHECK (fee_pyg >= 0),
  active     boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE TABLE delivery_routes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  route_date date NOT NULL,
  courier_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  name       text,
  status     text NOT NULL DEFAULT 'planificada' CHECK (status IN ('planificada','en_curso','finalizada')),
  created_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_routes_date_idx ON delivery_routes(route_date DESC);
CREATE TABLE deliveries (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id        bigint NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  status          text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','asignado','listo','en_camino','entregado','no_entregado','reprogramado','cancelado')),
  courier_id      bigint REFERENCES users(id) ON DELETE RESTRICT,
  route_id        bigint REFERENCES delivery_routes(id) ON DELETE SET NULL,
  route_position  integer,
  scheduled_date  date,
  time_slot       text,
  recipient_name  text, recipient_phone text, address text, zone text, reference text,
  lat             numeric(9,6), lng numeric(9,6),                  -- reservado para integrar mapas (geocodificación)
  left_at         timestamptz, arrived_at timestamptz,
  proof_media_id  bigint REFERENCES media(id) ON DELETE RESTRICT,   -- prueba de entrega (foto privada)
  failure_reason  text, notes text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_status_idx ON deliveries(status, scheduled_date);
CREATE INDEX deliveries_courier_idx ON deliveries(courier_id, scheduled_date);
CREATE INDEX deliveries_route_idx ON deliveries(route_id, route_position);
CREATE TRIGGER deliveries_updated BEFORE UPDATE ON deliveries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Vínculo pedido ↔ venta y pagos de pedidos ──
ALTER TABLE sales ADD COLUMN order_id bigint UNIQUE REFERENCES orders(id) ON DELETE RESTRICT;

ALTER TABLE payments ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE payments ADD COLUMN order_id bigint REFERENCES orders(id) ON DELETE RESTRICT;
ALTER TABLE payments ADD CONSTRAINT payments_target_chk CHECK (sale_id IS NOT NULL OR order_id IS NOT NULL);
CREATE INDEX payments_order_idx ON payments(order_id);
ALTER TABLE sale_refunds ALTER COLUMN sale_id DROP NOT NULL;
ALTER TABLE sale_refunds ADD COLUMN order_id bigint REFERENCES orders(id) ON DELETE RESTRICT;
ALTER TABLE sale_refunds ADD CONSTRAINT sale_refunds_target_chk CHECK (sale_id IS NOT NULL OR order_id IS NOT NULL);

-- payments sigue siendo append-only. Única excepción: un cobro de pedido recibe su sale_id cuando el pedido se entrega y genera la venta.
DROP TRIGGER payments_no_change ON payments;
CREATE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.sale_id IS NULL AND NEW.sale_id IS NOT NULL
     AND NEW.id = OLD.id AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id AND NEW.method_id = OLD.method_id AND NEW.amount_pyg = OLD.amount_pyg
     AND NEW.received_at = OLD.received_at AND NEW.cash_movement_id IS NOT DISTINCT FROM OLD.cash_movement_id AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.reference IS NOT DISTINCT FROM OLD.reference THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'payments es append-only' USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER payments_no_change BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();
