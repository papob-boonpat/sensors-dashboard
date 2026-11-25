export interface NormalizedReading {
  gatewayId: string;
  sensorId: string;
  type: string;
  value: number;
  statusCode: number;
  timestamp: Date;
}

export interface LiveSensorState {
  gatewayId: string;
  sensorId: string;
  type: string;
  value: number;
  statusCode: number;
  lastTimestamp: string;
  updatedAtMs: number;
}

export interface GatewayStatus {
  gatewayId: string;
  online: boolean;
  lastSeen: string;
  lastPayloadTimestamp: string;
  sensorCount: number;
  totalMessages: number;
}

export interface HistoryPoint {
  time: string;
  gatewayId: string;
  sensorId: string;
  type: string;
  value: number;
  statusCode?: number;
}
