# Industrial Data Logger Platform

End-to-end telemetry ingestion, time-series storage, interval-based reporting, and Excel export platform designed for **Advantech ECU-1051** Edge Gateways with Store & Forward ("DATA logger") buffering.

## Architecture

1. **Edge Layer (Advantech ECU-1051 — No Custom Coding)**
   - Polls ~100 field sensors and buffers readings locally in "DATA logger" when offline.
   - Publishes real-time telemetry and historical burst replays over MQTT with device-originated Unix timestamps (`ts`).
2. **Infrastructure Layer (K3s / Docker Compose)**
   - **Mosquitto**: MQTT Broker receiving real-time & burst telemetry.
   - **PostgreSQL + TimescaleDB**: Time-series database (`machine_status` hypertable).
3. **Backend Ingestion & API (`backend/`)**
   - Node.js + TypeScript + Express + `pg` + `mqtt` + `exceljs`.
   - **Strict Timestamp Preservation**: Always uses `payload.ts` from the gateway, never server ingestion time.
   - **Burst Handling**: In-memory batching with periodic `flushReadings()` (default 5s / 500 rows) using PostgreSQL `unnest` bulk inserts.
   - **Excel Export**: Downsampled TimescaleDB `time_bucket()` queries streamed as styled `.xlsx` files.
4. **Frontend Dashboard (`frontend/`)**
   - React + Vite + TypeScript + Recharts.
   - Interval-selectable report dashboard and filtered Excel export UI.

## Quick Start (Local Development)

### 1. Start Mosquitto, MQTT UI, & TimescaleDB
```bash
docker compose up -d
```
- **MQTT Broker**: `mqtt://localhost:1883` (WebSocket: `ws://localhost:9001`)
- **MQTT Web UI (MQTTX)**: `http://localhost:8080` (connect using `ws://localhost:9001`)
- **TimescaleDB**: `postgres://postgres:postgrespassword@localhost:5432/telemetry`
- *(Optional)* To also run `backend` and `frontend` in Docker: `docker compose --profile app up -d`

### 2. Backend
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

### 4. Simulate ECU-1051 (~100 sensors + Store & Forward burst)
```bash
cd backend
npm run simulate
```

## K3s Deployment
See [`k8s/`](k8s/) for Kubernetes manifests (`namespace`, `mosquitto`, `timescaledb`, `apps`) and [`docs/ecu-1051-setup.md`](docs/ecu-1051-setup.md) for ECU-1051 configuration details.
