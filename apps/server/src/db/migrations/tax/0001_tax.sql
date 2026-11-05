-- 18 section 7.1: the driver's inputs for the estimate, the Tax Jar ledger, and the way each
-- vehicle is deducted in a tax year. Nothing here moves money.
CREATE TABLE tax_years (
  user_id              INTEGER NOT NULL REFERENCES users(id),
  tax_year             INTEGER NOT NULL CHECK (tax_year BETWEEN 2000 AND 2100),
  set_aside_bp         INTEGER NOT NULL DEFAULT 2500 CHECK (set_aside_bp BETWEEN 0 AND 10000),
  sales_tax_registered INTEGER NOT NULL DEFAULT 0 CHECK (sales_tax_registered IN (0,1)),
  PRIMARY KEY (user_id, tax_year)
);
CREATE TABLE tax_jar_entries (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  tax_year     INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
  entered_on   TEXT    NOT NULL,
  note         TEXT
);
CREATE INDEX idx_jar_user_year ON tax_jar_entries(user_id, tax_year);
CREATE TABLE vehicle_tax_years (
  user_id     INTEGER NOT NULL REFERENCES users(id),
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id),
  tax_year    INTEGER NOT NULL,
  method      TEXT    NOT NULL CHECK (method IN ('standard_mileage','actual_expenses')),
  rate1_milli INTEGER CHECK (rate1_milli IS NULL OR rate1_milli >= 0),
  rate2_milli INTEGER CHECK (rate2_milli IS NULL OR rate2_milli >= 0),
  threshold_m INTEGER CHECK (threshold_m IS NULL OR threshold_m >= 0),
  PRIMARY KEY (vehicle_id, tax_year)
);
