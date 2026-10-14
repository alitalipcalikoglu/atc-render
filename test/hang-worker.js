import { parentPort } from 'node:worker_threads';

// Test double of render-worker.js: hangs or crashes on request, otherwise answers a tiny "PDF".
const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort);
port.on('message', (/** @type {{ id: number, layout: { hang?: boolean, crash?: boolean } }} */ job) => {
  if (job.layout.hang) for (;;);
  if (job.layout.crash) throw new Error('boom');
  port.postMessage({ id: job.id, ok: true, pdf: Buffer.from('%PDF'), pages: 1 });
});
