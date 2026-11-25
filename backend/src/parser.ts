import type { NormalizedReading } from './types.js';

/**
 * Parse a timestamp strictly from the gateway payload (`ts`).
 * Supports Unix epoch milliseconds (number), Unix epoch seconds (number < 1e12),
 * or ISO-8601 strings. Never falls back to server ingestion time.
 */
export function parsePayloadTimestamp(rawTs: unknown): Date {
  if (typeof rawTs === 'number' && Number.isFinite(rawTs)) {
    const ms = rawTs < 1e12 ? rawTs * 1000 : rawTs;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }

  if (typeof rawTs === 'string' && rawTs.trim() !== '') {
    const numeric = Number(rawTs);
    if (Number.isFinite(numeric)) {
      const ms = numeric < 1e12 ? numeric * 1000 : numeric;
      const date = new Date(ms);
      if (!Number.isNaN(date.getTime())) {
        return date;
      }
    }
    const isoDate = new Date(rawTs);
    if (!Number.isNaN(isoDate.getTime())) {
      return isoDate;
    }
  }

  throw new Error(`Invalid or missing payload timestamp (ts): ${String(rawTs)}`);
}

function extractGatewayFromTopic(topic?: string): string | undefined {
  if (!topic) return undefined;
  const parts = topic.split('/').filter(Boolean);
  if (parts.length >= 2 && parts[0] === 'gateways') {
    return parts[1];
  }
  return undefined;
}

function normalizeSingleItem(
  item: Record<string, unknown>,
  fallbackGatewayId?: string,
  fallbackTs?: unknown
): NormalizedReading {
  const gatewayId = String(item.gateway_id ?? item.gatewayId ?? fallbackGatewayId ?? '').trim();
  const sensorId = String(item.sensor_id ?? item.sensorId ?? item.tag ?? '').trim();
  const type = String(item.type ?? 'generic').trim() || 'generic';
  const rawValue = item.value ?? item.val;
  const value = typeof rawValue === 'boolean' ? (rawValue ? 1 : 0) : Number(rawValue);
  const statusCode = item.status_code !== undefined ? Number(item.status_code) : 0;
  const timestamp = parsePayloadTimestamp(item.ts ?? item.timestamp ?? fallbackTs);

  if (!gatewayId) {
    throw new Error('Missing gateway_id in payload');
  }
  if (!sensorId) {
    throw new Error('Missing sensor_id in payload');
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for sensor ${sensorId}: ${String(rawValue)}`);
  }

  return {
    gatewayId,
    sensorId,
    type,
    value,
    statusCode: Number.isFinite(statusCode) ? statusCode : 0,
    timestamp,
  };
}

/**
 * Parse incoming MQTT JSON payload into normalized sensor readings.
 * Supports:
 * 1) Multi-sensor batch: { gateway_id, ts, sensors: [...] }
 * 2) Array of sensor objects: [ { gateway_id, sensor_id, value, ts, ... }, ... ]
 * 3) Single sensor object: { gateway_id, sensor_id, value, ts, ... }
 */
export function parseTelemetryPayload(raw: string | Buffer, topic?: string): NormalizedReading[] {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  const parsed: unknown = JSON.parse(text);
  const topicGateway = extractGatewayFromTopic(topic);

  if (Array.isArray(parsed)) {
    return parsed.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new Error('Array payload contains non-object element');
      }
      return normalizeSingleItem(entry as Record<string, unknown>, topicGateway);
    });
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Payload must be a JSON object or array');
  }

  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.sensors)) {
    const batchGateway = String(obj.gateway_id ?? obj.gatewayId ?? topicGateway ?? '').trim() || undefined;
    const batchTs = obj.ts ?? obj.timestamp;
    return obj.sensors.map((sensor) => {
      if (!sensor || typeof sensor !== 'object') {
        throw new Error('sensors[] contains non-object element');
      }
      return normalizeSingleItem(sensor as Record<string, unknown>, batchGateway, batchTs);
    });
  }

  return [normalizeSingleItem(obj, topicGateway)];
}
