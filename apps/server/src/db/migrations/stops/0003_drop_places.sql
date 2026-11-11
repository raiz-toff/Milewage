-- Named places (ADR 0008) were removed. A place labelled the stops inside it each time a shift was
-- worked out, and stops.place_id holds what the last run matched. Before the table goes, each such
-- label becomes the driver's own label on that stop: the role the stop took in that run and the
-- place's name as the label's place, so recorded shifts keep their labels and their active and
-- deadhead split, also when they are worked out again. A hand label already won over a place; it
-- is kept, and only an empty place in it gets the name the stop showed. 0002 stays so databases
-- that applied it still start.
UPDATE stop_labels
   SET place = (SELECT p.name FROM stops st JOIN places p ON p.id = st.place_id
                 WHERE st.shift_id = stop_labels.shift_id AND st.stop_key = stop_labels.stop_key)
 WHERE (place IS NULL OR trim(place) = '')
   AND EXISTS (SELECT 1 FROM stops st JOIN places p ON p.id = st.place_id
                WHERE st.shift_id = stop_labels.shift_id AND st.stop_key = stop_labels.stop_key);
INSERT INTO stop_labels (user_id, shift_id, stop_key, role, place, edited_at)
SELECT st.user_id, st.shift_id, st.stop_key, st.role, p.name, coalesce(s.calculated_at, p.updated_at)
  FROM stops st
  JOIN places p ON p.id = st.place_id
  JOIN shifts s ON s.id = st.shift_id
 WHERE st.role IN ('pickup', 'dropoff', 'other')
   AND NOT EXISTS (SELECT 1 FROM stop_labels l
                    WHERE l.shift_id = st.shift_id AND l.stop_key = st.stop_key);
ALTER TABLE stops DROP COLUMN place_id;
DROP TABLE places;
