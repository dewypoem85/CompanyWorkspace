import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, spreadsheetUrl } from './config.js';
import { companyActorId, registerCompanyAuthRoutes, requireCompanyAuth } from './company-auth.js';
import { PAGE_PATHS } from '../shared/workspace-routes.js';
import { extractSpreadsheetId, quoteSheetTitle } from './a1.js';
import { demoAnalysis } from './demo.js';
import {
  analyzeGoogleSheet,
  restoreSnapshot,
  writePlainValues,
} from './google.js';
import { applyKoreanSync, createKoreanSyncPreview } from './sync.js';
import { validateSheetWriteContext } from './sheet-write-context.js';
import {
  listSnapshots,
  loadAnalysis,
  loadSnapshot,
  saveRules,
  saveSnapshot,
} from './store.js';
import type {
  AnalysisResult,
  ApiError,
  MigrationResult,
  RuntimeConfig,
  SnapshotRecord,
} from '../shared/types.js';

const app = express();
const workspaceFormMediaType = 'application/vnd.company.workspace-form+json';
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
registerCompanyAuthRoutes(app);
app.get('/.well-known/assetlinks.json', (_request, response) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), process.env.NODE_ENV === 'production' ? '../client' : '../client/public');
  response.type('application/json').set('Cache-Control', 'public, max-age=3600').sendFile(
    path.join(root, '.well-known', 'assetlinks.json'),
    { dotfiles: 'allow' },
  );
});
app.use(requireCompanyAuth);

function publicAnalysis(analysis: AnalysisResult, limit = 150): AnalysisResult {
  return { ...analysis, rules: analysis.rules.slice(0, limit) };
}

function asyncRoute(
  handler: (request: Request, response: Response) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

function workspaceSaved(response: Response, message: string, data: unknown): void {
  response.type(workspaceFormMediaType).json({protocol:'workspace-form-v1', outcome:'saved', message, data});
}

function workspaceRejected(response: Response, status: 409 | 422, message: string, data: unknown): void {
  response.status(status).type(workspaceFormMediaType).json({
    protocol:'workspace-form-v1', outcome:status === 409 ? 'conflict' : 'invalid', message, data,
  });
}

function requireSheetWriteContext(request: Request, response: Response, expectedState: string): boolean {
  const actor=companyActorId(request);
  const state=validateSheetWriteContext({actorId:actor,requestedWith:request.get('X-Requested-With'),requestedActor:request.get('X-Workspace-Actor'),requestedState:request.get('X-Workspace-Sheet-State'),expectedState});
  if (state === 'denied') {
    response.status(403).json({error:'현재 회사 계정의 시트 실행 요청인지 확인할 수 없습니다.'} satisfies ApiError);
    return false;
  }
  if (state === 'conflict') {
    workspaceRejected(response, 409, '확인한 분석 또는 미리보기 기준이 변경되었습니다. 다시 확인해 주세요.', {operation:'sheet-write', expectedState});
    return false;
  }
  return true;
}

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/config', (request, response) => {
  const runtime: RuntimeConfig = {
    mode: config.hasGoogleCredentials ? 'google' : 'demo',
    writesEnabled: config.hasGoogleCredentials && config.allowWrites,
    actorId: companyActorId(request),
    defaultSpreadsheetId: config.defaultSpreadsheetId,
    defaultSpreadsheetUrl: spreadsheetUrl(config.defaultSpreadsheetId),
  };
  response.json(runtime);
});

app.post(
  '/api/spreadsheets/analyze',
  asyncRoute(async (request, response) => {
    const input = String(request.body?.spreadsheet ?? config.defaultSpreadsheetId);
    const spreadsheetId = extractSpreadsheetId(input);
    if (!spreadsheetId) {
      response.status(400).json({ error: '올바른 Google Spreadsheet URL 또는 ID가 아닙니다.' });
      return;
    }

    if (!config.hasGoogleCredentials) {
      if (spreadsheetId !== config.defaultSpreadsheetId) {
        response.status(503).json({
          error: 'Google 인증 정보가 없어 기본 테스트 문서의 데모 분석만 사용할 수 있습니다.',
          code: 'GOOGLE_CREDENTIALS_REQUIRED',
        } satisfies ApiError);
        return;
      }
      response.json(publicAnalysis({
        ...demoAnalysis,
        createdAt: new Date().toISOString(),
      }));
      return;
    }

    const analysis = await analyzeGoogleSheet(spreadsheetId);
    response.json(publicAnalysis(analysis));
  }),
);

app.get(
  '/api/analyses/:analysisId',
  asyncRoute(async (request, response) => {
    if (request.params.analysisId === demoAnalysis.id) {
      response.json(publicAnalysis(demoAnalysis, Number(request.query.limit ?? 150)));
      return;
    }
    const analysis = await loadAnalysis(String(request.params.analysisId));
    response.json(publicAnalysis(analysis, Number(request.query.limit ?? 150)));
  }),
);

app.get(
  '/api/snapshots',
  asyncRoute(async (_request, response) => {
    const snapshots = await listSnapshots();
    response.json(
      snapshots.map(({ entries: _entries, ...snapshot }) => snapshot),
    );
  }),
);

app.post(
  '/api/migrations/apply',
  asyncRoute(async (request, response) => {
    if (!config.hasGoogleCredentials) {
      response.status(503).json({
        error: '실제 마이그레이션에는 Google 서비스 계정 설정이 필요합니다.',
        code: 'GOOGLE_CREDENTIALS_REQUIRED',
      } satisfies ApiError);
      return;
    }
    if (!config.allowWrites) {
      response.status(403).json({
        error: '서버의 시트 쓰기 기능이 비활성화되어 있습니다. ALLOW_SHEET_WRITES=true가 필요합니다.',
        code: 'SHEET_WRITES_DISABLED',
      } satisfies ApiError);
      return;
    }
    if (request.body?.confirmation !== '수식 제거') {
      workspaceRejected(response, 422, '확인 입력란에 “수식 제거”를 정확히 입력해야 합니다.', {operation:'migration'});
      return;
    }
    const expectedAnalysisId=String(request.body?.analysisId ?? '');
    if(!requireSheetWriteContext(request,response,expectedAnalysisId))return;

    const analysis = await loadAnalysis(expectedAnalysisId);
    if (analysis.mode !== 'google') {
      response.status(400).json({ error: '데모 분석에는 마이그레이션을 실행할 수 없습니다.' });
      return;
    }
    if (analysis.totals.blocked > 0) {
      workspaceRejected(response, 409, `${analysis.totals.blocked}개의 차단 항목을 먼저 해결해야 합니다.`, {operation:'migration', analysisId:analysis.id});
      return;
    }

    const fresh = await analyzeGoogleSheet(analysis.spreadsheet.id);
    if (fresh.id !== analysis.id) {
      workspaceRejected(response, 409, '미리보기 이후 Spreadsheet가 변경되었습니다. 다시 분석해 주세요.', {operation:'migration', analysisId:analysis.id});
      return;
    }

    const snapshot: SnapshotRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      kind: 'migration',
      spreadsheetId: analysis.spreadsheet.id,
      spreadsheetTitle: analysis.spreadsheet.title,
      analysisId: analysis.id,
      entryCount: analysis.rules.length,
      entries: analysis.rules.map((rule) => ({
        range: `${quoteSheetTitle(rule.target.sheetTitle)}!${rule.target.cell}`,
        formula: rule.formula,
        plainValue: rule.plainValue,
        formattedValue: rule.formattedValue,
      })),
    };

    await saveSnapshot(snapshot);
    await saveRules(analysis.spreadsheet.id, analysis.rules);

    try {
      await writePlainValues(analysis.rules);
      const verification = await analyzeGoogleSheet(analysis.spreadsheet.id);
      const result: MigrationResult = {
        id: randomUUID(),
        startedAt: snapshot.createdAt,
        completedAt: new Date().toISOString(),
        spreadsheetId: analysis.spreadsheet.id,
        snapshotId: snapshot.id,
        converted: analysis.rules.length - verification.totals.formulas,
        remaining: verification.totals.formulas,
        ruleFile: `${analysis.spreadsheet.id}.json`,
      };

      if (result.remaining !== 0) {
        throw new Error(`검증 결과 IMPORTRANGE 수식 ${result.remaining}개가 남았습니다.`);
      }

      workspaceSaved(response, '수식 마이그레이션을 완료했습니다.', {operation:'migration', analysisId:analysis.id, spreadsheetId:analysis.spreadsheet.id, result});
    } catch (error) {
      await restoreSnapshot(snapshot);
      throw error;
    }
  }),
);

app.post(
  '/api/sync/korean/preview',
  asyncRoute(async (request, response) => {
    if (!config.hasGoogleCredentials) {
      response.status(503).json({
        error: '원본 시트를 읽으려면 Google 서비스 계정 설정이 필요합니다.',
        code: 'GOOGLE_CREDENTIALS_REQUIRED',
      } satisfies ApiError);
      return;
    }

    const input = String(request.body?.spreadsheet ?? config.defaultSpreadsheetId);
    const spreadsheetId = extractSpreadsheetId(input);
    if (!spreadsheetId) {
      response.status(400).json({ error: '올바른 Google Spreadsheet URL 또는 ID가 아닙니다.' });
      return;
    }

    response.json(await createKoreanSyncPreview(spreadsheetId));
  }),
);

app.post(
  '/api/sync/korean/apply',
  asyncRoute(async (request, response) => {
    if (!config.hasGoogleCredentials) {
      response.status(503).json({
        error: '한국어 갱신에는 Google 서비스 계정 설정이 필요합니다.',
        code: 'GOOGLE_CREDENTIALS_REQUIRED',
      } satisfies ApiError);
      return;
    }
    if (!config.allowWrites) {
      response.status(403).json({
        error: '서버의 시트 쓰기 기능이 비활성화되어 있습니다. ALLOW_SHEET_WRITES=true가 필요합니다.',
        code: 'SHEET_WRITES_DISABLED',
      } satisfies ApiError);
      return;
    }
    if (request.body?.confirmation !== '한국어 갱신') {
      workspaceRejected(response, 422, '확인 입력란에 “한국어 갱신”을 정확히 입력해야 합니다.', {operation:'korean-sync'});
      return;
    }

    const spreadsheetId = extractSpreadsheetId(String(request.body?.spreadsheetId ?? ''));
    const previewId = String(request.body?.previewId ?? '');
    if (!spreadsheetId || !previewId) {
      response.status(400).json({ error: '갱신 대상 또는 미리보기 ID가 올바르지 않습니다.' });
      return;
    }
    if(!requireSheetWriteContext(request,response,previewId))return;

    try {
      const result = await applyKoreanSync(spreadsheetId, previewId);
      workspaceSaved(response, '한국어 원문 갱신을 완료했습니다.', {operation:'korean-sync', previewId, spreadsheetId, result});
    } catch (error) {
      if (typeof error === 'object' && error && 'status' in error && error.status === 409) {
        workspaceRejected(response, 409, error instanceof Error ? error.message : '미리보기 이후 시트가 변경되었습니다.', {operation:'korean-sync', previewId, spreadsheetId});
        return;
      }
      throw error;
    }
  }),
);

app.post(
  '/api/snapshots/:snapshotId/restore',
  asyncRoute(async (request, response) => {
    if (!config.hasGoogleCredentials || !config.allowWrites) {
      response.status(403).json({ error: 'Google 시트 쓰기 기능이 활성화되어 있지 않습니다.' });
      return;
    }
    if (request.body?.confirmation !== '스냅샷 복구') {
      response.status(400).json({ error: '“스냅샷 복구”를 정확히 입력해야 합니다.' });
      return;
    }

    const snapshot = await loadSnapshot(String(request.params.snapshotId));
    await restoreSnapshot(snapshot);
    response.json({ restored: snapshot.entryCount, spreadsheetId: snapshot.spreadsheetId });
  }),
);

if (process.env.NODE_ENV === 'production') {
  const clientDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../client',
  );
  app.use(express.static(clientDirectory));
  app.use((request, response) => {
    if (!['GET', 'HEAD'].includes(request.method) || !PAGE_PATHS.includes(request.path)) {
      response.status(404).json({ error: '등록되지 않은 페이지입니다.' });
      return;
    }
    response.sendFile(path.join(clientDirectory, 'index.html'));
  });
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root: path.resolve(process.cwd(), 'src/client'),
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
  const status = typeof error === 'object' && error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : 500;
  const code = typeof error === 'object' && error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
  console.error(error);
  response.status(status).json({ error: message, code } satisfies ApiError);
});

app.listen(config.port, () => {
  console.log(`Sheet Control is running at http://localhost:${config.port}`);
  console.log(`Google mode: ${config.hasGoogleCredentials ? 'connected' : 'demo'}`);
  console.log(`Sheet writes: ${config.allowWrites ? 'enabled' : 'disabled'}`);
});
