import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { downloadExcelReport } from '../api';
import type { SensorMetadata } from '../types';

interface Props {
  sensors: SensorMetadata[];
  gateways: string[];
  onClose: () => void;
}

function toLocalInputValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function ExportModal({ sensors, gateways, onClose }: Props) {
  const now = new Date();
  const [fromLocal, setFromLocal] = useState(toLocalInputValue(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  const [toLocal, setToLocal] = useState(toLocalInputValue(now));
  const [gatewayId, setGatewayId] = useState('');
  const [window, setWindow] = useState('auto');
  const [selectedSensors, setSelectedSensors] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSensor = (sensorId: string) => {
    setSelectedSensors((prev) =>
      prev.includes(sensorId) ? prev.filter((id) => id !== sensorId) : [...prev, sensorId]
    );
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      await downloadExcelReport({
        from: new Date(fromLocal).toISOString(),
        to: new Date(toLocal).toISOString(),
        gatewayId: gatewayId || undefined,
        sensorIds: selectedSensors.length > 0 ? selectedSensors : undefined,
        window,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Excel export failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Export Excel Report (.xlsx)</h3>
          <button className="btn-secondary" onClick={onClose} style={{ padding: '0.25rem 0.5rem' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem' }}>
            Start Date & Time
            <input
              type="datetime-local"
              className="input"
              value={fromLocal}
              onChange={(e) => setFromLocal(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem' }}>
            End Date & Time
            <input
              type="datetime-local"
              className="input"
              value={toLocal}
              onChange={(e) => setToLocal(e.target.value)}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem' }}>
            Gateway Filter
            <select className="select" value={gatewayId} onChange={(e) => setGatewayId(e.target.value)}>
              <option value="">All Gateways</option>
              {gateways.map((gw) => (
                <option key={gw} value={gw}>
                  {gw}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.82rem' }}>
            Downsampling Interval
            <select className="select" value={window} onChange={(e) => setWindow(e.target.value)}>
              <option value="auto">Auto (Recommended)</option>
              <option value="raw">Raw (No downsampling)</option>
              <option value="1m">1 Minute Average</option>
              <option value="5m">5 Minute Average</option>
              <option value="15m">15 Minute Average</option>
              <option value="1h">1 Hour Average</option>
              <option value="1d">1 Day Average</option>
            </select>
          </label>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.35rem' }}>
            <span>Sensors ({selectedSensors.length === 0 ? 'All' : `${selectedSensors.length} selected`})</span>
            {selectedSensors.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedSensors([])}
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.8rem' }}
              >
                Clear selection
              </button>
            )}
          </div>
          <div className="sensor-checklist">
            {sensors.map((s) => (
              <label key={`${s.gatewayId}:${s.sensorId}`} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <input
                  type="checkbox"
                  checked={selectedSensors.includes(s.sensorId)}
                  onChange={() => toggleSensor(s.sensorId)}
                />
                <span>{s.sensorId}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
            <Download size={16} />
            {downloading ? 'Generating .xlsx...' : 'Download Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}
