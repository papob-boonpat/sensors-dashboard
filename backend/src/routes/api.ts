import { Router } from 'express';
import { queryHistory, queryMetadata } from '../timescale.js';
import { buildExcelWorkbookBuffer } from '../exportService.js';

export const apiRouter = Router();

function parseDateRange(fromRaw?: unknown, toRaw?: unknown): { from: Date; to: Date } {
  const now = new Date();
  const to = toRaw ? new Date(String(toRaw)) : now;
  const from = fromRaw ? new Date(String(fromRaw)) : new Date(to.getTime() - 60 * 60 * 1000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('Invalid date range parameters (from/to)');
  }
  if (from.getTime() > to.getTime()) {
    throw new Error('"from" must be earlier than "to"');
  }
  return { from, to };
}

function parseSensorIds(raw?: unknown): string[] | undefined {
  if (!raw) return undefined;
  const list = String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
}

apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/metadata', async (_req, res) => {
  try {
    const metadata = await queryMetadata();
    res.json(metadata);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to query metadata';
    res.status(500).json({ error: message });
  }
});

apiRouter.get('/sensors/history', async (req, res) => {
  try {
    const periodSeconds = req.query.period_seconds ? Number(req.query.period_seconds) : undefined;
    const anchorLatest = req.query.anchor === 'latest' || (periodSeconds !== undefined && periodSeconds > 0);
    const { from, to } = parseDateRange(req.query.from, req.query.to);
    const gatewayId = req.query.gateway_id ? String(req.query.gateway_id) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const sensorIds = parseSensorIds(req.query.sensor_ids ?? req.query.sensor_id);
    const window = req.query.window ? String(req.query.window) : undefined;

    const result = await queryHistory({
      from,
      to,
      gatewayId,
      sensorIds,
      type,
      window,
      periodSeconds: periodSeconds && Number.isFinite(periodSeconds) ? periodSeconds : undefined,
      anchorLatest,
    });

    res.json({
      from: result.from.toISOString(),
      to: result.to.toISOString(),
      windowUsed: result.windowUsed,
      count: result.points.length,
      points: result.points,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to query history';
    res.status(400).json({ error: message });
  }
});

apiRouter.get('/export/excel', async (req, res) => {
  try {
    const { from, to } = parseDateRange(req.query.from, req.query.to);
    const gatewayId = req.query.gateway_id ? String(req.query.gateway_id) : undefined;
    const type = req.query.type ? String(req.query.type) : undefined;
    const sensorIds = parseSensorIds(req.query.sensor_ids);
    const window = req.query.window ? String(req.query.window) : undefined;

    const result = await queryHistory({
      from,
      to,
      gatewayId,
      sensorIds,
      type,
      window,
    });

    const buffer = await buildExcelWorkbookBuffer(result.points, {
      from,
      to,
      windowUsed: result.windowUsed,
      gatewayId,
      sensorIds,
    });

    const filename = `telemetry-report-${from.toISOString().slice(0, 10)}-to-${to
      .toISOString()
      .slice(0, 10)}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate Excel export';
    res.status(500).json({ error: message });
  }
});
