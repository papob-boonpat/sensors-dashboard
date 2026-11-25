import mqtt, { type MqttClient } from 'mqtt';
import { config } from './config.js';
import { parseTelemetryPayload } from './parser.js';
import { writeReadingsToBuffer } from './timescale.js';

let client: MqttClient | null = null;

export function startMqttSubscriber(): MqttClient {
  client = mqtt.connect(config.mqttUrl, {
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    console.log(`[MQTT] Connected to ${config.mqttUrl}`);
    for (const topic of config.mqttTopics) {
      client?.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT] Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`[MQTT] Subscribed to ${topic}`);
        }
      });
    }
  });

  client.on('message', (topic, payload) => {
    try {
      const readings = parseTelemetryPayload(payload, topic);
      if (readings.length === 0) return;
      writeReadingsToBuffer(readings);
    } catch (err) {
      console.error(`[MQTT] Failed to process message on ${topic}:`, err);
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT] Client error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting to broker...');
  });

  return client;
}

export async function stopMqttSubscriber(): Promise<void> {
  if (!client) return;
  await new Promise<void>((resolve) => {
    client?.end(false, {}, () => resolve());
  });
  client = null;
}
