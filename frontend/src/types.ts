export interface SensorMetadata {
  gatewayId: string;
  sensorId: string;
  type: string;
}

export interface HistoryPoint {
  time: string;
  gatewayId: string;
  sensorId: string;
  type: string;
  value: number;
}

export interface HistoryResponse {
  from: string;
  to: string;
  windowUsed: string;
  count: number;
  points: HistoryPoint[];
}
