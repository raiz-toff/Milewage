-- 21 section 3.6c: who owns the vehicle. A new column with a default and a CHECK can be added in
-- place (no rebuild as in 0008); every existing vehicle becomes 'owned'.
ALTER TABLE vehicles ADD COLUMN ownership TEXT NOT NULL DEFAULT 'owned'
  CHECK (ownership IN ('owned','financed','leased','rented'));
