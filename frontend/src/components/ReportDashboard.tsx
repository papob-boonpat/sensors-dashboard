import { useCallback, useEffect, useMemo, useState } from 'react';
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

const PERIOD_OPTIONS = [
  { label: 'Period: 10s (from latest)', seconds: 10 },
  { label: 'Period: 20s (from latest)', seconds: 20 },
  { label: 'Period: 30s (from latest)', seconds: 30 },
  { label: 'Period: 1 min (from latest)', seconds: 60 },
  { label: 'Period: 5 min (from latest)', seconds: 300 },
  { label: 'Period: 15 min (from latest)', seconds: 900 },
  { label: 'Period: 1 hour (from latest)', seconds: 3600 },
  { label: 'Period: 6 hours (from latest)', seconds: 21600 },
  { label: 'Period: 24 hours (from latest)', seconds: 86400 },
  { label: 'Period: 7 days (from latest)', seconds: 604800 },
];

const REFRESH_OPTIONS = [
  { label: 'Retrieve: Manual', ms: 0 },
  { label: 'Retrieve: Every 2s', ms: 2000 },
  { label: 'Retrieve: Every 5s', ms: 5000 },
  { label: 'Retrieve: Every 10s', ms: 10000 },
  { label: 'Retrieve: Every 30s', ms: 30000 },
  { label: 'Retrieve: Every 1 min', ms: 60000 },
];

const INTERVAL_OPTIONS = [
  { label: 'Aggregation: Auto', value: 'auto' },
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

const COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#4f46e5',
  '#059669',
  '#ea580c',
  '#9333ea',
  '#0284c7',
];

export function ReportDashboard({ sensors, gateways }: Props) {
  const [periodSeconds, setPeriodSeconds] = useState(60);
  const [refreshMs, setRefreshMs] = useState(5000);
  const [interval, setIntervalValue] = useState('auto');
  const [gatewayId, setGatewayId] = useState('');
  const [selectedSensors, setSelectedSensors] = useState<string[]>([]);
  const [points, setPoints] = useState<HistoryPoint[]>([]);
  const [windowUsed, setWindowUsed] = useState('raw');
  const [rangeInfo, setRangeInfo] = useState<{ from: string; to: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleSensors = useMemo(() => {
    if (!gatewayId) return sensors;
    return sensors.filter((s) => s.gatewayId === gatewayId);
  }, [sensors, gatewayId]);

  useEffect(() => {
    if (selectedSensors.length === 0 && visibleSensors.length > 0) {
      setSelectedSensors([visibleSensors[0].sensorId]);
    }
  }, [visibleSensors, selectedSensors.length]);

  const toggleSensor = (sensorId: string) => {
    setSelectedSensors((prev) =>
      prev.includes(sensorId) ? prev.filter((id) => id !== sensorId) : [...prev, sensorId]
    );
  };

  const selectAllVisible = () => {
    setSelectedSensors(visibleSensors.map((s) => s.sensorId));
  };

  const clearSensors = () => {
    setSelectedSensors([]);
  };

  const loadHistory = useCallback(async () => {
    if (selectedSensors.length === 0 && !gatewayId) {
      setPoints([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchHistory({
        periodSeconds,
        anchor: 'latest',
        gatewayId: gatewayId || undefined,
        sensorIds: selectedSensors.length > 0 ? selectedSensors : undefined,
        window: interval === 'auto' ? undefined : interval,
      });
      setPoints(res.points);
      setWindowUsed(res.windowUsed);
      setRangeInfo({ from: res.from, to: res.to });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [periodSeconds, gatewayId, selectedSensors, interval]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const timer = window.setInterval(() => {
      void loadHistory();
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, loadHistory]);

  const { chartData, seriesKeys } = useMemo(() => {
    const byTime = new Map<string, Record<string, string | number>>();
    const keys = new Set<string>();

    for (const pt of points) {
      keys.add(pt.sensorId);
      const label = new Date(pt.time).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const existing = byTime.get(pt.time) || { time: pt.time, label };
      existing[pt.sensorId] = pt.value;
      byTime.set(pt.time, existing);
    }

    return {
      chartData: Array.from(byTime.values()),
      seriesKeys: Array.from(keys),
    };
  }, [points]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="card">
        <div className="toolbar" style={{ justifyContent: 'space-between', marginBottom: '0.9rem' }}>
          <div className="toolbar">
            <select
              className="select"
              value={periodSeconds}
              onChange={(e) => setPeriodSeconds(Number(e.target.value))}
            >
              {PERIOD_OPTIONS.map((p) => (
                <option key={p.seconds} value={p.seconds}>
                  {p.label}
                </option>
              ))}
            </select>

            <select
              className="select"
              value={refreshMs}
              onChange={(e) => setRefreshMs(Number(e.target.value))}
            >
              {REFRESH_OPTIONS.map((r) => (
                <option key={r.ms} value={r.ms}>
                  {r.label}
                </option>
              ))}
            </select>

            <select
              className="select"
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
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

            <button className="btn-secondary" onClick={() => void loadHistory()} disabled={loading}>
              {loading ? 'Loading...' : 'Fetch Now'}
            </button>
          </div>

          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
            Aggregation: <strong>{windowUsed}</strong> · {points.length} points
            {rangeInfo && (
              <>
                {' '}· {new Date(rangeInfo.from).toLocaleTimeString()} –{' '}
                {new Date(rangeInfo.to).toLocaleTimeString()}
              </>
            )}
          </span>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.82rem',
              marginBottom: '0.4rem',
            }}
          >
            <span style={{ fontWeight: 600 }}>
              Sensors ({selectedSensors.length} selected)
            </span>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={selectAllVisible}
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Select All
              </button>
              <button
                type="button"
                onClick={clearSensors}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="sensor-checklist" style={{ maxHeight: 130 }}>
            {visibleSensors.length === 0 ? (
              <span style={{ color: '#64748b' }}>No sensors registered yet.</span>
            ) : (
              visibleSensors.map((s) => (
                <label
                  key={`${s.gatewayId}:${s.sensorId}`}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={selectedSensors.includes(s.sensorId)}
                    onChange={() => toggleSensor(s.sensorId)}
                  />
                  <span>
                    {s.sensorId} <small style={{ color: '#64748b' }}>({s.gatewayId})</small>
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        {error && (
          <div style={{ color: '#b91c1c', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
            {error}
          </div>
        )}

        {selectedSensors.length === 0 && !gatewayId ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
            Select one or more sensors above to view the chart.
          </div>
        ) : chartData.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: '#64748b' }}>
            {loading ? 'Loading historical telemetry...' : 'No historical points found for the selected sensors and period.'}
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
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
