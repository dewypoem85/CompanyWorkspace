import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  handleGetSheets,
  handleGetConfig,
  handleSaveConfig,
  handleTestKey,
  handleGetModels,
  handleDetectLanguages,
  handleGetGlossary,
  handleSaveGlossary,
  handleGetResults,
  handleGetStatus,
  handleStartJob,
  handleApplyExcel,
  handleDownloadExcel,
  handleClearCache,
  handleGetServiceAccounts,
  handleUploadServiceAccount,
  handleSelectServiceAccount,
  handleDeleteServiceAccount,
  handleTestServiceAccount,
  handleClearResults,
} from './smart-translator.js';
import { handleGetSchedule, handleSaveSchedule, handleRunSchedule, startScheduler } from './scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 4201);
// Vite HMR(WebSocket)이 별도 포트(24678)를 열지 않고 이 HTTP 서버를 공유하게 해서,
// 이전에 켜 둔 서버가 남아 있어도 'Port 24678 is already in use' 충돌이 나지 않게 한다.
const httpServer = http.createServer(app);

app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// CORS (로컬 개발 환경용)
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  next();
});

function asyncRoute(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

// 로컬 실행용 공통 테마 CSS: 회사 도메인(company.example.com)이 내려주는 것과 같은 생성 파일
// (packages/workspace-ui 의 테마·내비게이션·공통 컴포넌트 묶음, tooling/build-ui.mjs 생성)을 저장소에서 직접 제공한다.
// 이 서버는 127.0.0.1 에만 바인딩되므로 로컬 접속에서만 쓰인다 (index.html 의 로컬 감지 스크립트가 연결).
const LOCAL_WORKSPACE_CSS = path.resolve(__dirname, '../../../portal/wwwroot/css/company-workspace.css');
app.get('/local-workspace/company-workspace.css', (_req, res) => {
  res.sendFile(LOCAL_WORKSPACE_CSS, { headers: { 'Cache-Control': 'no-cache' } }, (err) => {
    if (err && !res.headersSent) res.status(404).type('text/plain').send('공통 테마 CSS를 찾을 수 없습니다: ' + LOCAL_WORKSPACE_CSS);
  });
});

// 헬스체크
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'smart-translator', time: new Date().toISOString() });
});

// 스마트 번역기 API
app.get('/api/smart-translator/sheets', asyncRoute(handleGetSheets));
app.get('/api/smart-translator/config', asyncRoute(handleGetConfig));
app.post('/api/smart-translator/config', asyncRoute(handleSaveConfig));
app.post('/api/smart-translator/test-key', asyncRoute(handleTestKey));
app.get('/api/smart-translator/models', asyncRoute(handleGetModels));
app.post('/api/smart-translator/detect-languages', asyncRoute(handleDetectLanguages));
app.get('/api/smart-translator/glossary', asyncRoute(handleGetGlossary));
app.post('/api/smart-translator/glossary', asyncRoute(handleSaveGlossary));
app.get('/api/smart-translator/results', asyncRoute(handleGetResults));
app.post('/api/smart-translator/results/clear', asyncRoute(handleClearResults));
app.get('/api/smart-translator/status', handleGetStatus);
app.post('/api/smart-translator/start', handleStartJob);
app.post('/api/smart-translator/apply', asyncRoute(handleApplyExcel));
app.post('/api/smart-translator/clear-cache', asyncRoute(handleClearCache));
app.get('/api/smart-translator/download-excel', handleDownloadExcel);
app.get('/api/smart-translator/service-accounts', asyncRoute(handleGetServiceAccounts));
app.post('/api/smart-translator/service-accounts/upload', asyncRoute(handleUploadServiceAccount));
app.post('/api/smart-translator/service-accounts/select', asyncRoute(handleSelectServiceAccount));
app.post('/api/smart-translator/service-accounts/delete', asyncRoute(handleDeleteServiceAccount));
app.post('/api/smart-translator/service-accounts/test', asyncRoute(handleTestServiceAccount));
app.get('/api/smart-translator/schedule', handleGetSchedule);
app.post('/api/smart-translator/schedule', handleSaveSchedule);
app.post('/api/smart-translator/schedule/run', handleRunSchedule);

// 프로덕션 정적 파일 서빙 또는 Vite dev
const isProduction = process.env.NODE_ENV === 'production';
const distClient = path.resolve(__dirname, '../../dist/client');

if (isProduction) {
  app.use(express.static(distClient));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(distClient, 'index.html'));
  });
} else {
  // Vite dev mode
  import('vite').then(async ({ createServer }) => {
    const vite = await createServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: 'spa',
      root: path.resolve(__dirname, '../client'),
    });
    app.use(vite.middlewares);
  });
}

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 [SmartTranslator Web] 서버가 성공적으로 시작되었습니다!`);
  console.log(`👉 접속 주소: http://127.0.0.1:${PORT}`);
  console.log(`======================================================\n`);
  startScheduler();
});
