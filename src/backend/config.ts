import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';

dotenv.config();

const configSchema = z.object({
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  databaseUrl: z.string().default('postgresql://postgres@localhost:5432/timemachine'),
  storageRoot: z.string().default('./storage'),
  schedulerIntervalMs: z.coerce.number().default(15000),
  workerIntervalMs: z.coerce.number().default(5000),

  // TinyFish API placeholders (populated when owner provides documentation)
  tinyfishApiKey: z.string().default(''),
  tinyfishMonitorEndpoint: z.string().default(''),
  tinyfishBrowserEndpoint: z.string().default(''),
  tinyfishWebhookSecret: z.string().default(''),

  // Gemma Cloud LLM placeholders
  gemmaApiKey: z.string().default(''),
  gemmaApiEndpoint: z.string().default(''),
  gemmaModel: z.string().default('gemma-2-9b-it'),
});

const parsed = configSchema.safeParse({
  port: process.env.PORT,
  nodeEnv: process.env.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  storageRoot: process.env.STORAGE_ROOT,
  schedulerIntervalMs: process.env.SCHEDULER_INTERVAL_MS,
  workerIntervalMs: process.env.WORKER_INTERVAL_MS,
  tinyfishApiKey: process.env.TINYFISH_API_KEY,
  tinyfishMonitorEndpoint: process.env.TINYFISH_MONITOR_ENDPOINT,
  tinyfishBrowserEndpoint: process.env.TINYFISH_BROWSER_ENDPOINT,
  tinyfishWebhookSecret: process.env.TINYFISH_WEBHOOK_SECRET,
  gemmaApiKey: process.env.GEMMA_API_KEY,
  gemmaApiEndpoint: process.env.GEMMA_API_ENDPOINT,
  gemmaModel: process.env.GEMMA_MODEL,
});

if (!parsed.success) {
  console.error('Configuration validation failed:', parsed.error.format());
  throw new Error('Invalid configuration');
}

export const config = {
  ...parsed.data,
  resolvedStorageRoot: path.resolve(process.cwd(), parsed.data.storageRoot),
};

export type AppConfig = typeof config;
