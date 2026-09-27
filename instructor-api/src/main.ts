import 'dotenv/config';
import cluster from 'node:cluster';
import os from 'node:os';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Dev-permissive: the instructor-web frontend runs on a different origin
  // (Next.js dev server). Tighten before this is exposed beyond a
  // local/demo network.
  app.enableCors({ origin: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(process.env.PORT ?? 8020);
}

// Node runs JS on a single thread, so one process is one core's worth of
// throughput no matter how much traffic arrives. WEB_CONCURRENCY forks that
// many worker processes sharing the same listen port (Node's cluster module
// balances connections across them) — more capacity from the same box,
// with no orchestration/auto-scaling involved. Each worker opens its own DB
// pool (PrismaService's DB_POOL_MAX), so total Postgres connections =
// WEB_CONCURRENCY x DB_POOL_MAX — keep that under Postgres's own
// max_connections. Unset (the default) behaves exactly as before: one
// process, no clustering — see docs/standards/capacity.md.
const workers = Math.min(Number(process.env.WEB_CONCURRENCY) || 1, os.cpus().length);

if (workers > 1 && cluster.isPrimary) {
  console.log(`[cluster] primary ${process.pid} starting ${workers} worker(s)`);
  for (let i = 0; i < workers; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.error(`[cluster] worker ${worker.process.pid} exited (code=${code}, signal=${signal}) — restarting`);
    cluster.fork();
  });
} else {
  await bootstrap();
}
