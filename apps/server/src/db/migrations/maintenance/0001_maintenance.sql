-- 18 section 6: a per-vehicle service record. Fuel and washes are expenses (categories), not services.
-- A cost is one fact in one place: when expense_id is set the cost lives on the expense.
CREATE TABLE maintenance_logs (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
  kind        TEXT    NOT NULL CHECK (kind IN ('oil_change','tires','brakes','other')),
  serviced_on TEXT    NOT NULL,
  odometer_m  INTEGER CHECK (odometer_m IS NULL OR odometer_m >= 0),
  cost_cents  INTEGER CHECK (cost_cents IS NULL OR cost_cents >= 0),
  expense_id  INTEGER UNIQUE REFERENCES expenses(id) ON DELETE SET NULL,
  notes       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_maint_vehicle ON maintenance_logs(vehicle_id, serviced_on);
