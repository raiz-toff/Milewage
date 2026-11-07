-- Plan 21 owner decision Q5: the driver's own mileage rate, used only where the country has no
-- official rates. Hundredths of a cent (minor unit) per km or mile; both set or both null.
ALTER TABLE settings ADD COLUMN own_rate_hundredths INTEGER CHECK (own_rate_hundredths IS NULL OR own_rate_hundredths > 0);
ALTER TABLE settings ADD COLUMN own_rate_unit       TEXT    CHECK (own_rate_unit IS NULL OR own_rate_unit IN ('km','mi'));
