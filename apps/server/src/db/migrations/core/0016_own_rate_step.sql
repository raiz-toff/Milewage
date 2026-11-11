-- ADR 0012: your mileage rate may have a second step, like a country's tiered rate: the rate up to
-- threshold_units km or miles of the rate period, then after_hundredths. Both null: one flat rate,
-- which is what every existing row stays. The route keeps the two set together.
ALTER TABLE own_mileage_rates ADD COLUMN threshold_units INTEGER CHECK (threshold_units IS NULL OR threshold_units > 0);
ALTER TABLE own_mileage_rates ADD COLUMN after_hundredths INTEGER CHECK (after_hundredths IS NULL OR after_hundredths > 0);
