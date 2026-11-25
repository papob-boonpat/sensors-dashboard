import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttTopics: (process.env.MQTT_TOPICS || 'gateways/+/telemetry')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/telemetry',
  batchSize: Number(process.env.BATCH_SIZE || 500),
  flushIntervalMs: Number(process.env.FLUSH_INTERVAL_MS || 5000),
};
