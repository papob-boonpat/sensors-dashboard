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

export async function initSchema(): Promise<void> {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS timescaledb;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS machine_status (
      time TIMESTAMPTZ NOT NULL,
      gateway_id TEXT NOT NULL,
      sensor_id TEXT NOT NULL,
      type TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      status_code INTEGER NOT NULL DEFAULT 0
    );
  `);
  await pool.query(`
    SELECT create_hypertable('machine_status', 'time', if_not_exists => TRUE);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_machine_status_gw_sensor_time
    ON machine_status (gateway_id, sensor_id, time DESC);
  `);
  await pool.query(`
    SELECT add_retention_policy('machine_status', INTERVAL '90 days', if_not_exists => TRUE);
  `);
  console.log('[TimescaleDB] Schema initialized (machine_status hypertable ready).');
}

/**
 * Queue normalized readings into the in-memory batch buffer.
 * Strictly preserves the device's original payload timestamp (`ts`).
 */
export function writeReadingsToBuffer(readings: NormalizedReading[]): void {
  pendingReadings.push(...readings);
  if (pendingReadings.length >= config.batchSize) {
    void flushReadings();
  }
}

export async function flushReadings(): Promise<void> {
  if (flushing || pendingReadings.length === 0) return;
  flushing = true;

  try {
    while (pendingReadings.length > 0) {
      const batch = pendingReadings.splice(0, Math.max(config.batchSize, 1000));
      const times = batch.map((r) => r.timestamp);
      const gateways = batch.map((r) => r.gatewayId);
      const sensors = batch.map((r) => r.sensorId);
      const types = batch.map((r) => r.type);
      const values = batch.map((r) => r.value);
      const statusCodes = batch.map((r) => r.statusCode);

      try {
        await pool.query(
          `
          INSERT INTO machine_status (time, gateway_id, sensor_id, type, value, status_code)
          SELECT * FROM unnest(
            $1::timestamptz[],
            $2::text[],
            $3::text[],
            $4::text[],
            $5::double precision[],
            $6::integer[]
          );
          `,
          [times, gateways, sensors, types, values, statusCodes]
        );
      } catch (err) {
        // Re-queue failed batch at the front so transient DB errors don't drop data
        pendingReadings.unshift(...batch);
        throw err;
      }
    }
  } catch (err) {
    console.error('[TimescaleDB] Batch flush error:', err);
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
  await flushReadings();
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
    sensor_id: string;
    type: string;
  }>(`
    SELECT DISTINCT gateway_id, sensor_id, type
    FROM machine_status
    WHERE time >= NOW() - INTERVAL '30 days'
    ORDER BY sensor_id ASC;
  `);

  const gatewaySet = new Set<string>();
  const sensors: SensorMetadata[] = [];

  for (const row of rows) {
    gatewaySet.add(row.gateway_id);
    sensors.push({
      gatewayId: row.gateway_id,
      sensorId: row.sensor_id,
      type: row.type,
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
}

export async function queryHistory(params: HistoryQueryParams): Promise<{
  windowUsed: string;
  points: HistoryPoint[];
}> {
  const windowUsed = chooseDownsampleWindow(params.from, params.to, params.window);
  const pgInterval = INTERVAL_MAP[windowUsed];

  const values: unknown[] = [params.from, params.to];
  const conditions: string[] = ['time >= $1', 'time <= $2'];

  if (params.gatewayId) {
    values.push(params.gatewayId);
    conditions.push(`gateway_id = $${values.length}`);
  }
  if (params.type) {
    values.push(params.type);
    conditions.push(`type = $${values.length}`);
  }
  if (params.sensorIds && params.sensorIds.length > 0) {
    values.push(params.sensorIds);
    conditions.push(`sensor_id = ANY($${values.length}::text[])`);
  }

  const whereClause = conditions.join(' AND ');

  let sql: string;
  if (pgInterval === 'raw') {
    sql = `
      SELECT time, gateway_id, sensor_id, type, value
      FROM machine_status
      WHERE ${whereClause}
      ORDER BY time ASC;
    `;
  } else {
    values.push(pgInterval);
    const intervalParam = `$${values.length}::interval`;
    sql = `
      SELECT
        time_bucket(${intervalParam}, time) AS time,
        gateway_id,
        sensor_id,
        type,
        AVG(value) AS value
      FROM machine_status
      WHERE ${whereClause}
      GROUP BY 1, gateway_id, sensor_id, type
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

  return { windowUsed, points };
}
