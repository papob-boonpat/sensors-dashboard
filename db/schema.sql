-- =============================================================================
-- PostgreSQL + TimescaleDB Schema for Industrial IoT Data Logger
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 1. Relational Metadata Tables
CREATE TABLE IF NOT EXISTS gateways (
  gateway_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ip_address TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sensor_tags (
  tag_id TEXT PRIMARY KEY,
  gateway_id TEXT NOT NULL REFERENCES gateways(gateway_id) ON DELETE CASCADE,
  sensor_type TEXT NOT NULL DEFAULT 'generic',
  unit TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensor_tags_gateway_id
  ON sensor_tags (gateway_id);

-- 2. Time-Series Hypertable
CREATE TABLE IF NOT EXISTS sensor_data (
  recorded_at TIMESTAMPTZ NOT NULL,
  tag_id TEXT NOT NULL REFERENCES sensor_tags(tag_id) ON DELETE CASCADE,
  value DOUBLE PRECISION NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 0,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tag_id, recorded_at)
);

SELECT create_hypertable(
  'sensor_data',
  'recorded_at',
  chunk_time_interval => INTERVAL '1 day',
  if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_sensor_data_recorded_at_desc
  ON sensor_data (recorded_at DESC);

-- 3. Compression & Retention Policies
ALTER TABLE sensor_data SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tag_id',
  timescaledb.compress_orderby = 'recorded_at DESC'
);

SELECT add_compression_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('sensor_data', INTERVAL '90 days', if_not_exists => TRUE);

-- 4. Continuous Aggregate (Hourly Rollup for Dashboards & Excel Exports)
CREATE MATERIALIZED VIEW IF NOT EXISTS sensor_data_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 hour', recorded_at) AS bucket,
  tag_id,
  AVG(value) AS avg_value,
  MIN(value) AS min_value,
  MAX(value) AS max_value,
  COUNT(*) AS sample_count
FROM sensor_data
GROUP BY bucket, tag_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'sensor_data_hourly',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);
