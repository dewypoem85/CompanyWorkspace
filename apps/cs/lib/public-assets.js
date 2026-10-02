import path from 'node:path';
import workspacePages from './workspace-pages.js';

const STATIC_FILES = new Map([
  ['/.well-known/assetlinks.json', ['.well-known/assetlinks.json', 'application/json; charset=utf-8']],
  ['/product-command-contract.js', ['product-command-contract.js', 'text/javascript; charset=utf-8']],
  ['/steam-transaction-contract.js', ['steam-transaction-contract.js', 'text/javascript; charset=utf-8']],
  ['/steam-refunds.css', ['steam-refunds.css', 'text/css; charset=utf-8']],
  ['/log-search-contract.js', ['log-search-contract.js', 'text/javascript; charset=utf-8']],
  ['/player-data-contract.js', ['player-data-contract.js', 'text/javascript; charset=utf-8']],
  ...workspacePages,
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/cs-navigation.js', ['cs-navigation.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/theme.js', ['theme.js', 'text/javascript; charset=utf-8']],
  ['/theme.css', ['theme.css', 'text/css; charset=utf-8']],
  ['/product-commands.js', ['product-commands.js', 'text/javascript; charset=utf-8']],
  ['/product-catalog.js', ['product-catalog.js', 'text/javascript; charset=utf-8']],
  ['/product-commands.css', ['product-commands.css', 'text/css; charset=utf-8']],
  ['/playfab-logs.js', ['playfab-logs.js', 'text/javascript; charset=utf-8']],
  ['/playfab-log-format.js', ['playfab-log-format.js', 'text/javascript; charset=utf-8']],
  ['/playfab-logs.css', ['playfab-logs.css', 'text/css; charset=utf-8']],
  ['/player-data.js', ['player-data.js', 'text/javascript; charset=utf-8']],
  ['/json-lossless.js', ['json-lossless.js', 'text/javascript; charset=utf-8']],
  ['/text-diff.js', ['text-diff.js', 'text/javascript; charset=utf-8']],
  ['/player-data.css', ['player-data.css', 'text/css; charset=utf-8']]
]);

const PRODUCT_CATALOG_ASSET_PATTERN = /^\/assets\/product-catalog\/(?:characters\/\d+|pets\/\d+|skins\/\d+\/\d+|weapons\/\d+\/\d+)\.png$/;

export function resolvePublicAsset(publicDir, requestPath) {
  const staticFile = STATIC_FILES.get(requestPath);
  if (staticFile) {
    return {
      filePath: path.join(publicDir, staticFile[0]),
      contentType: staticFile[1]
    };
  }

  if (!PRODUCT_CATALOG_ASSET_PATTERN.test(requestPath)) return null;
  return {
    filePath: path.join(publicDir, ...requestPath.slice(1).split('/')),
    contentType: 'image/png'
  };
}
