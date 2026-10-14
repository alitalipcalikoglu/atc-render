import { parentPort, workerData } from 'node:worker_threads';
import { RenderError } from '../domain/errors.js';
import { Renderer } from './renderer.js';

/**
 * Worker thread of the render pool: draws one layout per message and answers with the PDF or the error.
 * It never touches the network or the database (images arrive as bytes), so a layout that keeps it busy
 * only ever blocks this thread.
 */
const renderer = new Renderer({ images: null, limits: workerData.limits, compress: workerData.compress });
const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort);
port.on('message', async (/** @type {{ id: number, layout: any, data: unknown, meta: { title?: string }, images: [string, Uint8Array][] }} */ job) => {
  try {
    const images = new Map(job.images.map(([path, bytes]) => [path, Buffer.from(bytes)]));
    const { pdf, pages } = await renderer.draw(job.layout, job.data, job.meta, images);
    port.postMessage({ id: job.id, ok: true, pdf, pages });
  } catch (err) {
    port.postMessage({ id: job.id, ok: false, code: err instanceof RenderError ? err.code : 'RENDER_FAILED', message: err instanceof Error ? err.message : String(err), details: err instanceof RenderError ? err.details : undefined });
  }
});
