import ExcelJS from 'exceljs';
import type { HistoryPoint } from './types.js';

export interface ExportMetadata {
  from: Date;
  to: Date;
  windowUsed: string;
  gatewayId?: string;
  sensorIds?: string[];
}

export async function buildExcelWorkbookBuffer(
  points: HistoryPoint[],
  meta: ExportMetadata
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Data Logger Platform';
  workbook.created = new Date();

  const summarySheet = workbook.addWorksheet('Report Info');
  summarySheet.columns = [
    { header: 'Property', key: 'prop', width: 24 },
    { header: 'Value', key: 'val', width: 48 },
  ];
  summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  summarySheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' },
  };
  summarySheet.addRows([
    { prop: 'Generated At', val: new Date().toISOString() },
    { prop: 'Range Start', val: meta.from.toISOString() },
    { prop: 'Range End', val: meta.to.toISOString() },
    { prop: 'Downsampling Window', val: meta.windowUsed },
    { prop: 'Gateway Filter', val: meta.gatewayId || 'All Gateways' },
    {
      prop: 'Sensor Filter',
      val: meta.sensorIds && meta.sensorIds.length > 0 ? meta.sensorIds.join(', ') : 'All Sensors',
    },
    { prop: 'Total Rows Exported', val: points.length },
  ]);

  const dataSheet = workbook.addWorksheet('Telemetry Data', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const columns = [
    { header: 'Timestamp (UTC)', key: 'time', width: 26 },
    { header: 'Gateway ID', key: 'gatewayId', width: 20 },
    { header: 'Sensor ID', key: 'sensorId', width: 20 },
    { header: 'Type', key: 'type', width: 16 },
    { header: 'Value', key: 'value', width: 14 },
  ];
  dataSheet.columns = columns;

  const headerRow = dataSheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F172A' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  for (const pt of points) {
    dataSheet.addRow({
      time: pt.time,
      gatewayId: pt.gatewayId,
      sensorId: pt.sensorId,
      type: pt.type,
      value: Number(pt.value.toFixed(4)),
    });
  }

  // Auto-fit columns based on cell content lengths
  dataSheet.columns.forEach((col) => {
    let maxLen = typeof col.header === 'string' ? col.header.length : 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(Math.max(maxLen + 3, 12), 45);
  });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
