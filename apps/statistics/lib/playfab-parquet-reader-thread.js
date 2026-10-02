import { parentPort } from 'node:worker_threads';
import { createPlayFabAzureSource } from './playfab-azure-source.js';

const source = createPlayFabAzureSource();

parentPort.on('message', async ({ id, blob }) => {
  try {
    const events = await source.readEvents(blob);
    parentPort.postMessage({ id, events });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error) });
  }
});
