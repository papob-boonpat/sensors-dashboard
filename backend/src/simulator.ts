import mqtt from 'mqtt';
import { config } from './config.js';

const SENSOR_TYPES = ['temperature', 'pressure', 'vibration', 'flow', 'current'] as const;
const GATEWAY_IDS = ['ecu-1051-01', 'ecu-1051-02'];

function buildSensors(gatewayIndex: number, countPerGateway: number) {
  const sensors = [];
  for (let i = 1; i <= countPerGateway; i++) {
    const type = SENSOR_TYPES[(i - 1) % SENSOR_TYPES.length];
    const prefix = type.slice(0, 4).toUpperCase();
    const sensorId = `${prefix}_${String(gatewayIndex * countPerGateway + i).padStart(3, '0')}`;
    const base =
      type === 'temperature'
        ? 45
        : type === 'pressure'
          ? 6.2
          : type === 'vibration'
            ? 2.4
            : type === 'flow'
              ? 120
              : 18;
    const value = Number((base + Math.sin(Date.now() / 10000 + i) * (base * 0.15) + (Math.random() - 0.5)).toFixed(2));
    const statusCode = Math.random() < 0.02 ? 2 : 0;
    sensors.push({ sensor_id: sensorId, type, value, status_code: statusCode });
  }
  return sensors;
}

const client = mqtt.connect(config.mqttUrl);

client.on('connect', () => {
  console.log(`[Simulator] Connected to ${config.mqttUrl}. Simulating 100 sensors across 2 ECU-1051 gateways.`);

  // Simulate a Store & Forward historical burst on startup (last 10 minutes at 1-minute intervals)
  const now = Date.now();
  for (let m = 10; m >= 1; m--) {
    const historicalTs = now - m * 60_000;
    GATEWAY_IDS.forEach((gatewayId, idx) => {
      const payload = {
        gateway_id: gatewayId,
        ts: historicalTs,
        sensors: buildSensors(idx, 50),
      };
      client.publish(`gateways/${gatewayId}/telemetry`, JSON.stringify(payload), { qos: 1 });
    });
  }
  console.log('[Simulator] Published 10-minute historical Store & Forward burst.');

  // Real-time telemetry every 5 seconds
  setInterval(() => {
    const ts = Date.now();
    GATEWAY_IDS.forEach((gatewayId, idx) => {
      const payload = {
        gateway_id: gatewayId,
        ts,
        sensors: buildSensors(idx, 50),
      };
      client.publish(`gateways/${gatewayId}/telemetry`, JSON.stringify(payload), { qos: 1 });
    });
  }, 5000);
});
