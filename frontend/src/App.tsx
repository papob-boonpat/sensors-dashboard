import { useCallback, useEffect, useState } from 'react';
import { Download, Radio, RefreshCw } from 'lucide-react';
import { fetchMetadata } from './api';
import { ReportDashboard } from './components/ReportDashboard';
import { ExportModal } from './components/ExportModal';
import type { SensorMetadata } from './types';

export function App() {
  const [sensors, setSensors] = useState<SensorMetadata[]>([]);
  const [gateways, setGateways] = useState<string[]>([]);
  const [showExport, setShowExport] = useState(false);

  const loadMetadata = useCallback(async () => {
    try {
      const data = await fetchMetadata();
      setSensors(data.sensors);
      setGateways(data.gateways);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    void loadMetadata();
  }, [loadMetadata]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <Radio size={20} color="#60a5fa" />
          <span>Industrial Data Logger</span>
        </div>

        <div className="nav-tabs">
          <button className="tab-btn" onClick={() => void loadMetadata()}>
            <RefreshCw size={15} /> Refresh Sensors
          </button>
          <button className="btn-primary" onClick={() => setShowExport(true)}>
            <Download size={16} /> Export Excel
          </button>
        </div>
      </header>

      <main className="main-content">
        <ReportDashboard sensors={sensors} gateways={gateways} />
      </main>

      {showExport && (
        <ExportModal
          sensors={sensors}
          gateways={gateways}
          onClose={() => setShowExport(false)}
        />
      )}
    </div>
  );
}

export default App;
