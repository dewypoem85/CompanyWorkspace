export type ConnectionMode = 'google' | 'demo';

export interface SheetSummary {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
  formulaCount: number;
  blockerCount: number;
}

export interface ImportRangeRule {
  id: string;
  target: {
    spreadsheetId: string;
    sheetId: number;
    sheetTitle: string;
    cell: string;
    key: string;
    language: string;
  };
  source: {
    spreadsheetId: string;
    sheetTitle: string;
    cell: string;
    url: string;
  };
  formula: string;
  plainValue: string | number | boolean | null;
  formattedValue: string;
  status: 'ready' | 'blocked';
  error?: string;
}

export interface AnalysisResult {
  id: string;
  createdAt: string;
  mode: ConnectionMode;
  spreadsheet: {
    id: string;
    title: string;
    url: string;
    locale?: string;
    timeZone?: string;
  };
  totals: {
    formulas: number;
    ready: number;
    blocked: number;
    sourceSpreadsheets: number;
    sourceSheets: number;
  };
  sheets: SheetSummary[];
  rules: ImportRangeRule[];
}

export interface RuntimeConfig {
  mode: ConnectionMode;
  writesEnabled: boolean;
  actorId: string;
  defaultSpreadsheetId: string;
  defaultSpreadsheetUrl: string;
}

export interface SnapshotRecord {
  id: string;
  createdAt: string;
  kind?: 'migration' | 'korean-sync';
  spreadsheetId: string;
  spreadsheetTitle: string;
  analysisId: string;
  entryCount: number;
  entries: Array<{
    range: string;
    formula?: string;
    plainValue: string | number | boolean | null;
    formattedValue: string;
  }>;
}

export type CellValue = string | number | boolean | null;

export interface KoreanSyncItem {
  ruleId: string;
  key: string;
  status: 'changed' | 'unchanged';
  source: {
    spreadsheetId: string;
    sheetTitle: string;
    cell: string;
    url: string;
    value: CellValue;
  };
  target: {
    spreadsheetId: string;
    sheetTitle: string;
    cell: string;
    currentValue: CellValue;
  };
}

export interface KoreanSyncPreview {
  id: string;
  createdAt: string;
  target: {
    id: string;
    title: string;
    url: string;
  };
  language: 'Korean';
  totals: {
    tracked: number;
    changed: number;
    unchanged: number;
    sourceSpreadsheets: number;
    sourceSheets: number;
  };
  items: KoreanSyncItem[];
}

export interface KoreanSyncResult {
  id: string;
  completedAt: string;
  spreadsheetId: string;
  previewId: string;
  snapshotId?: string;
  updated: number;
  unchanged: number;
}

export interface MigrationResult {
  id: string;
  startedAt: string;
  completedAt: string;
  spreadsheetId: string;
  snapshotId: string;
  converted: number;
  remaining: number;
  ruleFile: string;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}
