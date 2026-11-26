import type { HistoryResponse, SensorMetadata } from './types';

export async function fetchMetadata(): Promise<{
  gateways: string[];
  sensors: SensorMetadata[];
}> {
  const res = await fetch('/api/metadata');
  if (!res.ok) {
    throw new Error(`Failed to fetch metadata (${res.status})`);
  }
  return res.json();
}

export async function fetchHistory(params: {
  from?: string;
  to?: string;
  periodSeconds?: number;
  anchor?: 'latest';
  gatewayId?: string;
  type?: string;
  sensorIds?: string[];
  window?: string;
}): Promise<HistoryResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.periodSeconds) qs.set('period_seconds', String(params.periodSeconds));
  if (params.anchor) qs.set('anchor', params.anchor);
  if (params.gatewayId) qs.set('gateway_id', params.gatewayId);
  if (params.type) qs.set('type', params.type);
  if (params.sensorIds && params.sensorIds.length > 0) {
    qs.set('sensor_ids', params.sensorIds.join(','));
  }
  if (params.window) qs.set('window', params.window);

  const res = await fetch(`/api/sensors/history?${qs.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch history (${res.status})`);
  }
  return res.json();
}

export async function downloadExcelReport(params: {
  from: string;
  to: string;
  gatewayId?: string;
  type?: string;
  sensorIds?: string[];
  window?: string;
}): Promise<void> {
  const qs = new URLSearchParams({
    from: params.from,
    to: params.to,
  });
  if (params.gatewayId) qs.set('gateway_id', params.gatewayId);
  if (params.type) qs.set('type', params.type);
  if (params.sensorIds && params.sensorIds.length > 0) {
    qs.set('sensor_ids', params.sensorIds.join(','));
  }
  if (params.window && params.window !== 'auto') {
    qs.set('window', params.window);
  }

  const res = await fetch(`/api/export/excel?${qs.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Export failed (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `telemetry-report-${params.from.slice(0, 10)}-to-${params.to.slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
