import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // Prisma 7 no longer reads the datasource URL from schema.prisma at
    // runtime — the client needs an explicit driver adapter, and that
    // adapter wraps node-postgres's own Pool. DB_POOL_MAX is a per-process
    // limit: with clustering (main.ts's WEB_CONCURRENCY), total Postgres
    // connections = WEB_CONCURRENCY x DB_POOL_MAX, so keep that product
    // under Postgres's own max_connections (or put PgBouncer in front) —
    // see docs/standards/capacity.md.
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.DB_POOL_MAX) || 10,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
