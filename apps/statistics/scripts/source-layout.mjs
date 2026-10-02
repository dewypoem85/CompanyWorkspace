import { createPlayFabAzureSource } from '../lib/playfab-azure-source.js';
const blobs = await createPlayFabAzureSource().listAllParquetBlobs();
const patterns = new Map();
for (const blob of blobs) {
  const relative = blob.name.replace(/^.*?\/title=[^/]+\//, '');
  const pattern = relative.split('/').map(segment => segment.replace(/=.+$/, '=*')).join('/');
  patterns.set(pattern, (patterns.get(pattern) || 0) + 1);
}
console.log(JSON.stringify({ samples: blobs.slice(0, 10).map(blob => blob.name), patterns: [...patterns].sort((a,b)=>b[1]-a[1]).slice(0,30) }, null, 2));
