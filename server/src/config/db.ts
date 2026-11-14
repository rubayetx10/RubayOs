import mongoose from 'mongoose';
import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

export async function connectDb(): Promise<void> {
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export type DbState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting' | 'unknown';

export function dbState(): DbState {
  const map: Record<number, DbState> = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  return map[mongoose.connection.readyState] ?? 'unknown';
}
