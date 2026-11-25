import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { chooseDownsampleWindow } from '../src/timescale.js';
import { buildExcelWorkbookBuffer } from '../src/exportService.js';

describe('chooseDownsampleWindow', () => {
  it('selects raw for short ranges and progressively larger windows for long ranges', () => {
    const base = new Date('2026-11-22T00:00:00.000Z');
    expect(chooseDownsampleWindow(base, new Date(base.getTime() + 60 * 60 * 1000))).toBe('raw');
    expect(chooseDownsampleWindow(base, new Date(base.getTime() + 6 * 60 * 60 * 1000))).toBe('1m');
    expect(chooseDownsampleWindow(base, new Date(base.getTime() + 14 * 24 * 60 * 60 * 1000))).toBe('1h');
    expect(chooseDownsampleWindow(base, new Date(base.getTime() + 60 * 24 * 60 * 60 * 1000))).toBe('1d');
  });

  it('respects explicit valid window override', () => {
    const base = new Date('2026-11-22T00:00:00.000Z');
    expect(chooseDownsampleWindow(base, new Date(base.getTime() + 60 * 60 * 1000), '15m')).toBe('15m');
  });
});

describe('buildExcelWorkbookBuffer', () => {
  it('generates a readable xlsx workbook with Report Info and Telemetry Data sheets', async () => {
    const from = new Date('2026-11-22T00:00:00.000Z');
    const to = new Date('2026-11-22T06:00:00.000Z');
    const buffer = await buildExcelWorkbookBuffer(
      [
        {
          time: '2026-11-22T01:00:00.000Z',
          gatewayId: 'ecu-1051-01',
          sensorId: 'TEMP_001',
          type: 'temperature',
          value: 44.12346,
        },
      ],
      { from, to, windowUsed: '1m', gatewayId: 'ecu-1051-01', sensorIds: ['TEMP_001'] }
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    expect(wb.getWorksheet('Report Info')).toBeDefined();
    const dataSheet = wb.getWorksheet('Telemetry Data');
    expect(dataSheet).toBeDefined();
    expect(dataSheet?.getRow(2).getCell(3).value).toBe('TEMP_001');
    expect(dataSheet?.getRow(2).getCell(5).value).toBe(44.1235);
  });
});
