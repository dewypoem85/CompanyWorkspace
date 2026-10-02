import { createPlayFabAzureSource } from '../lib/playfab-azure-source.js';
const blobs = await createPlayFabAzureSource().listAllParquetBlobs();
const bytes = blobs.reduce((sum, blob) => sum + Number(blob.byteLength || 0), 0);
console.log(JSON.stringify({ blobs: blobs.length, bytes, requiredBytes: bytes * 2, firstDate: blobs[0]?.dateKey || null, lastDate: blobs.at(-1)?.dateKey || null }));
