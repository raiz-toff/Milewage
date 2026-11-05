-- Trend rollup so old raw events can expire (16 section 7.1). device_id 0 = the server or all devices.
CREATE TABLE diag_daily (
  day       TEXT    NOT NULL,
  device_id INTEGER NOT NULL DEFAULT 0,
  metric    TEXT    NOT NULL,
  n         INTEGER NOT NULL,
  sum       REAL    NOT NULL,
  max       REAL    NOT NULL,
  PRIMARY KEY (day, device_id, metric)
);
