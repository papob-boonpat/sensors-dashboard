import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  mqttUrl: process.env.MQTT_URL || 'mqtt://localhost:1883',
  mqttClientId: process.env.MQTT_CLIENT_ID || 'nodejs-timescale-ingestor',
  mqttTopics: (process.env.MQTT_TOPICS || 'gateways/+/telemetry')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/telemetry',
  batchSize: Number(process.env.BATCH_SIZE || 500),
  flushIntervalMs: Number(process.env.FLUSH_INTERVAL_MS || 2000),
  maxRetryDelayMs: Number(process.env.MAX_RETRY_DELAY_MS || 30000),
};
