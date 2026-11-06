import { createServer } from './server.js';
import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { performHealthCheck } from './services/healthService.js';
import { schedulerService } from './services/schedulerService.js';
import { jobWorker } from './services/jobWorker.js';
import { closeDatabase } from './db/index.js';
import { logger } from './utils/logger.js';

async function bootstrap() {
  try {
    logger.info('Starting pagipy server bootstrap...', { port: config.port, env: config.nodeEnv });

    // 1. Ensure migrations are up to date
    const applied = await runMigrations();
    if (applied.length > 0) {
      logger.info(`Applied ${applied.length} pending migrations`, { migrations: applied });
    }

    // 2. Perform startup health check
    const health = await performHealthCheck();
    logger.info('Startup health check status', { status: health.status, components: health.components });

    if (health.status === 'unhealthy') {
      logger.error('Startup aborted: core system health check failed', health);
      process.exit(1);
    }

    // 3. Start background services
    schedulerService.start();
    jobWorker.start();

    // 4. Start server
    const app = createServer();
    const server = app.listen(config.port, () => {
      logger.info(`pagipy backend running on port ${config.port}`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      schedulerService.stop();
      jobWorker.stop();
      server.close(async () => {
        logger.info('HTTP server closed.');
        await closeDatabase();
        logger.info('Database pool closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    logger.error('Fatal bootstrap error', err);
    process.exit(1);
  }
}

bootstrap();
