import { describe, expect, it } from 'vitest';
import { parsePayloadTimestamp, parseTelemetryPayload } from '../src/parser.js';

describe('parsePayloadTimestamp', () => {
  it('preserves historical Unix millisecond timestamps', () => {
    const historicalMs = 1700000000123;
    const parsed = parsePayloadTimestamp(historicalMs);
    expect(parsed.getTime()).toBe(historicalMs);
  });

  it('supports Unix epoch seconds', () => {
    const seconds = 1700000000;
    const parsed = parsePayloadTimestamp(seconds);
    expect(parsed.getTime()).toBe(seconds * 1000);
  });

  it('supports ISO-8601 strings', () => {
    const iso = '2026-01-15T08:30:00.000Z';
    const parsed = parsePayloadTimestamp(iso);
    expect(parsed.toISOString()).toBe(iso);
  });

  it('throws when ts is missing or invalid instead of falling back to server time', () => {
    expect(() => parsePayloadTimestamp(undefined)).toThrow();
    expect(() => parsePayloadTimestamp('not-a-date')).toThrow();
  });
});

describe('parseTelemetryPayload', () => {
  it('parses ECU-1051 multi-sensor batch payload and preserves ts', () => {
    const historicalTs = Date.now() - 3600_000;
    const raw = JSON.stringify({
      gateway_id: 'ecu-1051-01',
      ts: historicalTs,
      sensors: [
        { sensor_id: 'TEMP_001', type: 'temperature', value: 42.5, status_code: 0 },
        { sensor_id: 'PRES_002', type: 'pressure', value: 5.9, status_code: 1 },
      ],
    });

    const readings = parseTelemetryPayload(raw, 'gateways/ecu-1051-01/telemetry');
    expect(readings).toHaveLength(2);
    expect(readings[0].timestamp.getTime()).toBe(historicalTs);
    expect(readings[1].gatewayId).toBe('ecu-1051-01');
    expect(readings[1].statusCode).toBe(1);
  });

  it('parses single-sensor payload using gateway from topic if omitted', () => {
    const ts = 1732286400000;
    const raw = JSON.stringify({
      sensor_id: 'FLOW_010',
      type: 'flow',
      value: 118.4,
      ts,
    });

    const readings = parseTelemetryPayload(raw, 'gateways/ecu-1051-02/telemetry');
    expect(readings).toHaveLength(1);
    expect(readings[0].gatewayId).toBe('ecu-1051-02');
    expect(readings[0].timestamp.getTime()).toBe(ts);
  });
});
