import type { Worker } from 'bullmq';
import { logger } from '../../lib/logger.js';
import { createTelegramWorker } from './telegram.js';
import { createSchedulerWorker } from './scheduler.js';
import { createMaintenanceWorker } from './maintenance.js';

let workers: Worker[] = [];

export function startWorkers(): void {
  if (workers.length > 0) return;
  workers = [createTelegramWorker(), createSchedulerWorker(), createMaintenanceWorker()];
  logger.info(`Фоновые воркеры запущены (${workers.length})`);
}

export async function stopWorkers(): Promise<void> {
  await Promise.allSettled(workers.map((worker) => worker.close()));
  workers = [];
}
