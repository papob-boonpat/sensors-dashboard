import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { apiRouter } from './routes/api.js';
import { initSchema, startFlushLoop, stopWriter } from './timescale.js';
import { startMqttSubscriber, stopMqttSubscriber } from './mqttSubscriber.js';

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);

async function start(): Promise<void> {
  await initSchema();
  startFlushLoop();
  startMqttSubscriber();

  const server = app.listen(config.port, () => {
    console.log(`[API] Data Logger backend listening on http://localhost:${config.port}`);
  });

  async function shutdown(signal: string): Promise<void> {
    console.log(`[System] Received ${signal}, shutting down gracefully...`);
    server.close();
    await stopMqttSubscriber();
    await stopWriter();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('[System] Startup failed:', err);
  process.exit(1);
});
