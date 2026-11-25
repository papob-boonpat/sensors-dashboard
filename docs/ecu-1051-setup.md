# ECU-1051 Edge Gateway Configuration Guide

The Advantech ECU-1051 requires **no custom application code**. Configure it using Advantech EdgeLink Studio:

## 1. Sensor Tag Mapping (~100 Tags)
- Map Modbus RTU/TCP, DI, and AI channels to standardized tag names (e.g., `TEMP_01`, `PRESS_02`, `VIB_03`, `FLOW_04`, `MOTOR_RUN_01`).
- Recommended types: `temperature`, `pressure`, `vibration`, `flow`, `current`, `digital`.

## 2. MQTT Broker & Topic Setup
- **Broker Host**: K3s Node IP / LoadBalancer IP
- **Port**: `1883` (or `8883` with TLS)
- **Topic Pattern**: `gateways/<gateway_id>/telemetry` (e.g. `gateways/ecu-1051-01/telemetry`)
- **QoS**: `1` (At least once)

## 3. "DATA logger" Store & Forward
- Enable **Data Logger / Offline Storage** on the ECU-1051 SD card or internal flash.
- Enable **Store & Forward** so buffered records are automatically replayed in chronological order when the MQTT broker becomes reachable after a network outage or server reboot.

## 4. Expected JSON Payload Formats

### ECU-1051 EdgeLink Standard Payload (recommended)
```json
{
  "d": [
    { "tag": "TEMP_01", "value": 30.00 },
    { "tag": "PRESS_02", "value": 5.82 }
  ],
  "ts": "2026-11-25T16:00:20Z",
  "type": 0
}
```
*(The `gateway_id` is extracted automatically from the MQTT topic `gateways/<gateway_id>/telemetry`.)*

### Single-sensor payload (also supported)
```json
{
  "gateway_id": "ecu-1051-01",
  "sensor_id": "TEMP_01",
  "type": "temperature",
  "value": 42.6,
  "status_code": 0,
  "ts": 1732286400000
}
```

> **Timestamp Rule**: `ts` must be the gateway's local Unix timestamp (milliseconds or seconds) or ISO-8601 string. The backend strictly preserves `ts` when writing to InfluxDB so historical replays remain chronologically accurate.
