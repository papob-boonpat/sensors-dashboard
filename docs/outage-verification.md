# Outage & Zero-Data-Loss Verification Checklist

## Scenario 1: Broker / Network Outage (Gateway "DATA logger" Flush)
1. **Disconnect** the ECU-1051 / simulator from Mosquitto (or stop the Mosquitto pod/container) for 2–5 minutes while sensors continue updating.
2. **Verify buffering**: Confirm the ECU-1051 writes records locally to its `"DATA logger"` file.
3. **Reconnect**: Restore network / restart Mosquitto (`docker compose up -d mosquitto`).
4. **Verify TimescaleDB**:
   ```sql
   SELECT tag_id, MIN(recorded_at), MAX(recorded_at), COUNT(*)
   FROM sensor_data
   GROUP BY tag_id
   ORDER BY tag_id;
   ```
   - Confirm `recorded_at` reflects the original outage timestamps (not `server_received_at`).
   - Confirm `server_received_at > recorded_at` for replayed rows.
5. **Verify Idempotency**: Re-publish the same historical payload with the same `(tag_id, recorded_at)` and confirm `COUNT(*)` does not increase (`ON CONFLICT (tag_id, recorded_at) DO UPDATE`).

## Scenario 2: Backend Down While Mosquitto Stays Alive (Persistent QoS 1 Queue)
1. **Ensure initial session**: Start the Node.js backend once so Mosquitto registers `clientId = nodejs-timescale-ingestor` with `clean: false` and `qos: 1`.
2. **Stop Backend**: Stop the Node.js backend (`Ctrl+C` or `kubectl scale deploy data-logger-backend --replicas=0`) while leaving Mosquitto and the ECU-1051 / simulator running for 2+ minutes.
3. **Verify Mosquitto Queuing**: Gateway continues receiving `PUBACK` from Mosquitto; Mosquitto holds all QoS 1 messages on disk (`/mosquitto/data/`).
4. **Restart Backend**: Start the Node.js backend again.
5. **Verify Recovery**:
   - Backend logs show `sessionPresent=true`.
   - All messages published during the backend downtime flush into `sensor_data` in batches with original `recorded_at` timestamps and zero gaps.
