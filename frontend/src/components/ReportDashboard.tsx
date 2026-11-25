import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchHistory } from '../api';
import type { HistoryPoint, SensorMetadata } from '../types';

interface Props {
  sensors: SensorMetadata[];
  gateways: string[];
}

const PRESETS = [
  { label: 'Last 1 Hour', hours: 1 },
  { label: 'Last 6 Hours', hours: 6 },
  { label: 'Last 24 Hours', hours: 24 },
  { label: 'Last 7 Days', hours: 24 * 7 },
  { label: 'Last 30 Days', hours: 24 * 30 },
];

const INTERVAL_OPTIONS = [
  { label: 'Interval: Auto', value: 'auto' },
  { label: 'Raw (No aggregation)', value: 'raw' },
  { label: '10 Seconds', value: '10s' },
  { label: '30 Seconds', value: '30s' },
  { label: '1 Minute', value: '1m' },
  { label: '5 Minutes', value: '5m' },
  { label: '15 Minutes', value: '15m' },
  { label: '1 Hour', value: '1h' },
  { label: '6 Hours', value: '6h' },
  { label: '1 Day', value: '1d' },
];

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2'];

export function ReportDashboard({ sensors, gateways }: Props) {
  const [hours, setHours] = useState(1);
  const [interval, setInterval] = useState('auto');
  const [gatewayId, setGatewayId] = useState('');
  const [selectedSensor, setSelectedSensor] = useState('');
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [windowUsed, setWindowUsed] = useState('raw');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSensor && sensors.length > 0) {
      setSelectedSensor(sensors[0].sensorId);
    }
  }, [sensors, selectedSensor]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedSensor && !gatewayId) return;
      setLoading(true);
      setError(null);
      try {
        const to = new Date();
        const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
        const res = await fetchHistory({
          from: from.toISOString(),
          to: to.toISOString(),
          gatewayId: gatewayId || undefined,
          sensorIds: selectedSensor ? [selectedSensor] : undefined,
          window: interval === 'auto' ? undefined : interval,
        });
        if (!cancelled) {
          setPoints(res.points);
          setWindowUsed(res.windowUsed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load history');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [hours, interval, gatewayId, selectedSensor]);

  const { chartData, seriesKeys } = useMemo(() => {
    const byTime = new Map<string, Record<string, string | number>>();
    const keys = new Set<string>();

    for (const pt of points) {
      keys.add(pt.sensorId);
      const label = new Date(pt.time).toLocaleTimeString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const existing = byTime.get(pt.time) || { time: pt.time, label };
      existing[pt.sensorId] = pt.value;
      byTime.set(pt.time, existing);
    }

    return {
      chartData: Array.from(byTime.values()),
      seriesKeys: Array.from(keys).slice(0, 6),
    };
  }, [points]);

  return (
    <div className="card">
      <div className="toolbar" style={{ marginBottom: '1rem', justifyContent: 'space-between' }}>
        <div className="toolbar">
          <select
            className="select"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            {PRESETS.map((p) => (
              <option key={p.hours} value={p.hours}>
                {p.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={gatewayId}
            onChange={(e) => setGatewayId(e.target.value)}
          >
            <option value="">All Gateways</option>
            {gateways.map((gw) => (
              <option key={gw} value={gw}>
                {gw}
              </option>
            ))}
          </select>

          <select
            className="select"
            value={selectedSensor}
            onChange={(e) => setSelectedSensor(e.target.value)}
          >
            <option value="">All Sensors (by Gateway)</option>
            {sensors.map((s) => (
              <option key={`${s.gatewayId}:${s.sensorId}`} value={s.sensorId}>
                {s.sensorId} ({s.type})
              </option>
            ))}
          </select>
        </div>

        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
          Active Interval: <strong>{windowUsed}</strong> · {points.length} points
        </span>
      </div>

      {error && (
        <div style={{ color: '#b91c1c', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
          Loading historical telemetry...
        </div>
      ) : chartData.length === 0 ? (
        <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
          No historical points found for the selected filter and interval.
        </div>
      ) : (
        <div style={{ width: '100%', height: 420 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              {seriesKeys.map((key, idx) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[idx % COLORS.length]}
                  dot={false}
                  strokeWidth={2}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
