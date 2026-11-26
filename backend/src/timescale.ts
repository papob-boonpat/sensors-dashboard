import { Pool } from 'pg';
import { config } from './config.js';
import type { HistoryPoint, NormalizedReading } from './types.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

const pendingReadings: NormalizedReading[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushing = false;
let consecutiveFailures = 0;
let nextRetryAtMs = 0;

export async function initSchema(): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS timescaledb;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gateways (
      gateway_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ip_address TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_tags (
      tag_id TEXT PRIMARY KEY,
      gateway_id TEXT NOT NULL REFERENCES gateways(gateway_id) ON DELETE CASCADE,
      sensor_type TEXT NOT NULL DEFAULT 'generic',
      unit TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sensor_tags_gateway_id
      ON sensor_tags (gateway_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sensor_data (
      recorded_at TIMESTAMPTZ NOT NULL,
      tag_id TEXT NOT NULL REFERENCES sensor_tags(tag_id) ON DELETE CASCADE,
      value DOUBLE PRECISION NOT NULL,
      status_code INTEGER NOT NULL DEFAULT 0,
      server_received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tag_id, recorded_at)
    );
  `);

  await pool.query(`
    SELECT create_hypertable(
      'sensor_data',
      'recorded_at',
      chunk_time_interval => INTERVAL '1 day',
      if_not_exists => TRUE
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sensor_data_recorded_at_desc
      ON sensor_data (recorded_at DESC);
  `);

  await pool.query(`
    ALTER TABLE sensor_data SET (
      timescaledb.compress,
      timescaledb.compress_segmentby = 'tag_id',
      timescaledb.compress_orderby = 'recorded_at DESC'
    );
  `);

  await pool.query(`
    SELECT add_compression_policy('sensor_data', INTERVAL '7 days', if_not_exists => TRUE);
  `);

  await pool.query(`
    SELECT add_retention_policy('sensor_data', INTERVAL '90 days', if_not_exists => TRUE);
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    SELECT add_continuous_aggregate_policy(
      'sensor_data_hourly',
      start_offset => INTERVAL '3 days',
      end_offset => INTERVAL '1 hour',
      schedule_interval => INTERVAL '1 hour',
      if_not_exists => TRUE
    );
  `);

  console.log('[TimescaleDB] Schema initialized (gateways, sensor_tags, sensor_data hypertable, continuous aggregate).');
}

/**
 * Deduplicate readings within a single batch by (sensorId, timestampMs)
 * so PostgreSQL ON CONFLICT DO UPDATE never hits a cardinality violation.
 */
export function deduplicateBatch(readings: NormalizedReading[]): NormalizedReading[] {
  const map = new Map<string, NormalizedReading>();
  for (const r of readings) {
    map.set(`${r.sensorId}::${r.timestamp.getTime()}`, r);
  }
  return Array.from(map.values());
}

/**
 * Queue normalized readings into the in-memory batch buffer.
 * Strictly preserves the device's original payload timestamp (`ts` / `recorded_at`).
 */
export function writeReadingsToBuffer(readings: NormalizedReading[]): void {
  pendingReadings.push(...readings);
  if (pendingReadings.length >= config.batchSize && Date.now() >= nextRetryAtMs) {
    void flushReadings();
  }
}

export async function flushReadings(force = false): Promise<void> {
  if (flushing || pendingReadings.length === 0) return;
  if (!force && Date.now() < nextRetryAtMs) return;

  flushing = true;

  try {
    while (pendingReadings.length > 0) {
      const rawBatch = pendingReadings.splice(0, Math.max(config.batchSize, 500));
      const batch = deduplicateBatch(rawBatch);

      const gatewayIds = Array.from(new Set(batch.map((r) => r.gatewayId)));
      const tagMap = new Map<string, { tagId: string; gatewayId: string; sensorType: string }>();
      for (const r of batch) {
        if (!tagMap.has(r.sensorId)) {
          tagMap.set(r.sensorId, {
            tagId: r.sensorId,
            gatewayId: r.gatewayId,
            sensorType: r.type,
          });
        }
      }
      const tags = Array.from(tagMap.values());

      const recordedAts = batch.map((r) => r.timestamp);
      const tagIds = batch.map((r) => r.sensorId);
      const values = batch.map((r) => r.value);
      const statusCodes = batch.map((r) => r.statusCode);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          `
          INSERT INTO gateways (gateway_id, name, status)
          SELECT id, id, 'active' FROM unnest($1::text[]) AS id
          ON CONFLICT (gateway_id) DO UPDATE SET updated_at = NOW();
          `,
          [gatewayIds]
        );

        await client.query(
          `
          INSERT INTO sensor_tags (tag_id, gateway_id, sensor_type)
          SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
          ON CONFLICT (tag_id) DO NOTHING;
          `,
          [tags.map((t) => t.tagId), tags.map((t) => t.gatewayId), tags.map((t) => t.sensorType)]
        );

        await client.query(
          `
          INSERT INTO sensor_data (recorded_at, tag_id, value, status_code)
          SELECT * FROM unnest(
            $1::timestamptz[],
            $2::text[],
            $3::double precision[],
            $4::integer[]
          )
          ON CONFLICT (tag_id, recorded_at) DO UPDATE SET
            value = EXCLUDED.value,
            status_code = EXCLUDED.status_code,
            server_received_at = NOW();
          `,
          [recordedAts, tagIds, values, statusCodes]
        );

        await client.query('COMMIT');
        consecutiveFailures = 0;
        nextRetryAtMs = 0;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        // Re-queue failed batch at the front so DB outages never drop data
        pendingReadings.unshift(...rawBatch);
        throw err;
      } finally {
        client.release();
      }
    }
  } catch (err) {
    consecutiveFailures += 1;
    const backoffMs = Math.min(1000 * 2 ** (consecutiveFailures - 1), config.maxRetryDelayMs);
    nextRetryAtMs = Date.now() + backoffMs;
    console.error(
      `[TimescaleDB] Batch flush failed (attempt #${consecutiveFailures}, retrying in ${backoffMs}ms, buffered=${pendingReadings.length}):`,
      err instanceof Error ? err.message : err
    );
  } finally {
    flushing = false;
  }
}

export function startFlushLoop(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushReadings();
  }, config.flushIntervalMs);
}

export async function stopWriter(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flushReadings(true);
  await pool.end();
}

const INTERVAL_MAP: Record<string, string> = {
  raw: 'raw',
  '10s': '10 seconds',
  '30s': '30 seconds',
  '1m': '1 minute',
  '5m': '5 minutes',
  '15m': '15 minutes',
  '1h': '1 hour',
  '6h': '6 hours',
  '1d': '1 day',
};

export function chooseDownsampleWindow(from: Date, to: Date, requested?: string): string {
  if (requested && requested in INTERVAL_MAP) {
    return requested;
  }

  const diffHours = Math.max(0, (to.getTime() - from.getTime()) / (1000 * 60 * 60));
  if (diffHours <= 2) return 'raw';
  if (diffHours <= 12) return '1m';
  if (diffHours <= 48) return '5m';
  if (diffHours <= 24 * 7) return '15m';
  if (diffHours <= 24 * 30) return '1h';
  return '1d';
}

export interface SensorMetadata {
  gatewayId: string;
  sensorId: string;
  type: string;
}

export async function queryMetadata(): Promise<{
  gateways: string[];
  sensors: SensorMetadata[];
}> {
  const { rows } = await pool.query<{
    gateway_id: string;
    tag_id: string;
    sensor_type: string;
  }>(`
    SELECT gateway_id, tag_id, sensor_type
    FROM sensor_tags
    ORDER BY tag_id ASC;
  `);

  const gatewaySet = new Set<string>();
  const sensors: SensorMetadata[] = [];

  for (const row of rows) {
    gatewaySet.add(row.gateway_id);
    sensors.push({
      gatewayId: row.gateway_id,
      sensorId: row.tag_id,
      type: row.sensor_type,
    });
  }

  return {
    gateways: Array.from(gatewaySet).sort(),
    sensors,
  };
}

export interface HistoryQueryParams {
  from: Date;
  to: Date;
  gatewayId?: string;
  sensorIds?: string[];
  type?: string;
  window?: string;
  periodSeconds?: number;
  anchorLatest?: boolean;
}

export async function queryHistory(params: HistoryQueryParams): Promise<{
  from: Date;
  to: Date;
  windowUsed: string;
  points: HistoryPoint[];
}> {
  let from = params.from;
  let to = params.to;

  if (params.anchorLatest && params.periodSeconds && params.periodSeconds > 0) {
    const anchorValues: unknown[] = [];
    const anchorConds: string[] = [];
    if (params.gatewayId) {
      anchorValues.push(params.gatewayId);
      anchorConds.push(`st.gateway_id = $${anchorValues.length}`);
    }
    if (params.type) {
      anchorValues.push(params.type);
      anchorConds.push(`st.sensor_type = $${anchorValues.length}`);
    }
    if (params.sensorIds && params.sensorIds.length > 0) {
      anchorValues.push(params.sensorIds);
      anchorConds.push(`sd.tag_id = ANY($${anchorValues.length}::text[])`);
    }
    const anchorWhere = anchorConds.length > 0 ? `WHERE ${anchorConds.join(' AND ')}` : '';
    const latestRes = await pool.query<{ latest: Date | null }>(
      `
      SELECT MAX(sd.recorded_at) AS latest
      FROM sensor_data sd
      JOIN sensor_tags st ON st.tag_id = sd.tag_id
      ${anchorWhere};
      `,
      anchorValues
    );
    to = latestRes.rows[0]?.latest ? new Date(latestRes.rows[0].latest) : new Date();
    from = new Date(to.getTime() - params.periodSeconds * 1000);
  }

  const windowUsed = chooseDownsampleWindow(from, to, params.window);
  const pgInterval = INTERVAL_MAP[windowUsed];

  const values: unknown[] = [from, to];
  const conditions: string[] = ['sd.recorded_at >= $1', 'sd.recorded_at <= $2'];

  if (params.gatewayId) {
    values.push(params.gatewayId);
    conditions.push(`st.gateway_id = $${values.length}`);
  }
  if (params.type) {
    values.push(params.type);
    conditions.push(`st.sensor_type = $${values.length}`);
  }
  if (params.sensorIds && params.sensorIds.length > 0) {
    values.push(params.sensorIds);
    conditions.push(`sd.tag_id = ANY($${values.length}::text[])`);
  }

  const whereClause = conditions.join(' AND ');

  let sql: string;
  if (pgInterval === 'raw') {
    sql = `
      SELECT
        sd.recorded_at AS time,
        st.gateway_id,
        sd.tag_id AS sensor_id,
        st.sensor_type AS type,
        sd.value
      FROM sensor_data sd
      JOIN sensor_tags st ON st.tag_id = sd.tag_id
      WHERE ${whereClause}
      ORDER BY sd.recorded_at ASC;
    `;
  } else if (windowUsed === '1h') {
    const caggConditions = conditions.map((c) => c.replace('sd.recorded_at', 'c.bucket').replace('sd.tag_id', 'c.tag_id'));
    sql = `
      SELECT
        c.bucket AS time,
        st.gateway_id,
        c.tag_id AS sensor_id,
        st.sensor_type AS type,
        c.avg_value AS value
      FROM sensor_data_hourly c
      JOIN sensor_tags st ON st.tag_id = c.tag_id
      WHERE ${caggConditions.join(' AND ')}
      ORDER BY c.bucket ASC;
    `;
  } else {
    values.push(pgInterval);
    const intervalParam = `$${values.length}::interval`;
    sql = `
      SELECT
        time_bucket(${intervalParam}, sd.recorded_at) AS time,
        st.gateway_id,
        sd.tag_id AS sensor_id,
        st.sensor_type AS type,
        AVG(sd.value) AS value
      FROM sensor_data sd
      JOIN sensor_tags st ON st.tag_id = sd.tag_id
      WHERE ${whereClause}
      GROUP BY 1, st.gateway_id, sd.tag_id, st.sensor_type
      ORDER BY 1 ASC;
    `;
  }

  const { rows } = await pool.query<{
    time: Date;
    gateway_id: string;
    sensor_id: string;
    type: string;
    value: number;
  }>(sql, values);

  const points: HistoryPoint[] = rows.map((row) => ({
    time: new Date(row.time).toISOString(),
    gatewayId: row.gateway_id,
    sensorId: row.sensor_id,
    type: row.type,
    value: Number(row.value),
  }));

  return { from, to, windowUsed, points };
}
