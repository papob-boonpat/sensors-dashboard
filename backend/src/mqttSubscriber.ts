import mqtt, { type MqttClient } from 'mqtt';
import { config } from './config.js';
import { parseTelemetryPayload } from './parser.js';
import { writeReadingsToBuffer } from './timescale.js';

let client: MqttClient | null = null;

export function startMqttSubscriber(): MqttClient {
  // Static clientId + clean: false ensures Mosquitto preserves the QoS 1
  // subscription and queues messages durably while Node.js is offline.
  client = mqtt.connect(config.mqttUrl, {
    clientId: config.mqttClientId,
    clean: false,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
  });

  client.on('connect', (connack) => {
    console.log(
      `[MQTT] Connected to ${config.mqttUrl} (clientId=${config.mqttClientId}, sessionPresent=${connack.sessionPresent})`
    );
    for (const topic of config.mqttTopics) {
      client?.subscribe(topic, { qos: 1 }, (err) => {
        if (err) {
          console.error(`[MQTT] Failed to subscribe to ${topic}:`, err);
        } else {
          console.log(`[MQTT] Subscribed to ${topic} (QoS 1)`);
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
      // Log and skip/quarantine malformed payloads without crashing the consumer
      console.error(`[MQTT] Quarantine malformed payload on ${topic}:`, err);
    }
  });

  client.on('error', (err) => {
    console.error('[MQTT] Client error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting to broker with persistent session...');
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
