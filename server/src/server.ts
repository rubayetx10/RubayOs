import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { connectDb, disconnectDb } from './config/db';

async function main() {
  await connectDb();
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`RubayOS API listening on :${env.PORT}`));

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
