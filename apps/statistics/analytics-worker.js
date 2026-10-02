import { createAzureProcessedStore } from './lib/azure-processed-store.js';
import { createPlayFabAnalytics } from './lib/playfab-analytics.js';
import { handleRefreshMessage } from './lib/refresh-worker-handler.js';

const dataDir = String(process.env.STATISTICS_DATA_DIR || '').trim() || new URL('./data', import.meta.url).pathname;
const processedStore = createAzureProcessedStore({
  storageAccount: process.env.AZURE_STATISTICS_STORAGE_ACCOUNT || process.env.AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT,
  container: process.env.AZURE_STATISTICS_CONTAINER,
  sasToken: process.env.AZURE_STATISTICS_SAS_TOKEN,
  prefix: process.env.AZURE_STATISTICS_PREFIX,
  titleId: process.env.PLAYFAB_LIVE_TITLE_ID
});
const analytics = createPlayFabAnalytics({
  dataDir,
  storageAccount: process.env.AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT,
  container: process.env.AZURE_PLAYFAB_LOG_CONTAINER,
  sasToken: process.env.AZURE_PLAYFAB_LOG_SAS_TOKEN,
  prefix: process.env.AZURE_PLAYFAB_LOG_PREFIX,
  liveTitleId: process.env.PLAYFAB_LIVE_TITLE_ID,
  concurrency: process.env.AZURE_PLAYFAB_LOG_CONCURRENCY,
  backfillConcurrency: process.env.AZURE_PLAYFAB_BACKFILL_CONCURRENCY,
  cacheMinutes: process.env.STATISTICS_CACHE_MINUTES,
  processedStore,
  aliases: {
    battleResult: parseAliases(process.env.STATISTICS_EVENT_BATTLE_RESULT),
    bossEncounter: parseAliases(process.env.STATISTICS_EVENT_BOSS_ENCOUNTER),
    bossKill: parseAliases(process.env.STATISTICS_EVENT_BOSS_KILL)
  }
});

if (!analytics.configured) throw new Error('통계 집계 워커에 Azure PlayFab 설정이 필요합니다.');

analytics.startPublisher({
  hourKst: process.env.STATISTICS_DAILY_REFRESH_HOUR_KST || 6,
  days: parseIntegerList(process.env.STATISTICS_PRECACHE_DAYS, [7, 30, 90]),
  syncLookbackDays: process.env.STATISTICS_SYNC_LOOKBACK_DAYS || 2,
  recoverEmptyIndex: true
});

process.on('message', message => {
  if (message?.type === 'refresh') {
    void handleRefreshMessage(message, { analytics, send: reply => process.send?.(reply) })
      .catch(error => console.error(`[analytics-worker] refresh_reply_failed ${error?.stack || error}`))
      .finally(sendState);
  }
  if (message?.type === 'shutdown') shutdown();
});

const stateTimer = setInterval(sendState, 1_000);
sendState();

function sendState() {
  if (!process.send) return;
  process.send({
    type: 'state',
    sync: analytics.getSyncState(),
    publication: analytics.getPublicationState(),
    sentAt: new Date().toISOString()
  });
}

function shutdown() {
  clearInterval(stateTimer);
  analytics.close();
  process.exit(0);
}

process.once('disconnect', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

function parseAliases(value) {
  const aliases = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  return aliases.length ? aliases : undefined;
}

function parseIntegerList(value, fallback) {
  const values = String(value || '').split(',').map(item => Number.parseInt(item.trim(), 10)).filter(item => Number.isInteger(item) && item >= 1 && item <= 90);
  return values.length ? [...new Set(values)] : fallback;
}
