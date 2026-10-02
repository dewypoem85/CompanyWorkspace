import { Worker } from 'node:worker_threads';

const THREAD_URL = new URL('./playfab-parquet-reader-thread.js', import.meta.url);

export function createPlayFabParquetReaderPool({ size = 4 } = {}) {
  const workerCount = Math.max(1, Math.min(8, Number.parseInt(String(size), 10) || 4));
  const queue = [];
  const slots = [];
  let sequence = 0;
  let closed = false;

  for (let index = 0; index < workerCount; index += 1) slots.push(createSlot());

  function createSlot() {
    const worker = new Worker(THREAD_URL);
    const slot = { worker, task: null };
    worker.on('message', message => {
      const task = slot.task;
      if (!task || message?.id !== task.id) return;
      slot.task = null;
      if (message.error) task.reject(new Error(message.error));
      else task.resolve(Array.isArray(message.events) ? message.events : []);
      dispatch();
    });
    worker.on('error', error => {
      if (!slot.task) return;
      const task = slot.task;
      slot.task = null;
      task.reject(error);
    });
    worker.on('exit', code => {
      const index = slots.indexOf(slot);
      if (index >= 0) slots.splice(index, 1);
      if (slot.task) {
        slot.task.reject(new Error(`Parquet 해석 작업 스레드가 종료됐습니다. (code ${code})`));
        slot.task = null;
      }
      if (!closed) slots.push(createSlot());
      dispatch();
    });
    return slot;
  }

  function dispatch() {
    for (const slot of slots) {
      if (slot.task || !queue.length) continue;
      const task = queue.shift();
      slot.task = task;
      slot.worker.postMessage({ id: task.id, blob: task.blob });
    }
  }

  function readEvents(blob) {
    if (closed) return Promise.reject(new Error('Parquet 해석 작업 풀이 종료됐습니다.'));
    return new Promise((resolve, reject) => {
      queue.push({ id: ++sequence, blob, resolve, reject });
      dispatch();
    });
  }

  async function close() {
    closed = true;
    while (queue.length) queue.shift().reject(new Error('Parquet 해석 작업 풀이 종료됐습니다.'));
    await Promise.allSettled(slots.map(slot => slot.worker.terminate()));
  }

  return { readEvents, close, size: workerCount };
}
