-- The maintenance module (the per-vehicle service log) was removed. Its table goes, its index with
-- it. A cost that was saved as an expense lives on the expense (the link was the log's expense_id),
-- so every expense stays as it is. This folder stays so databases that applied 0001 still start.
DROP TABLE maintenance_logs;
