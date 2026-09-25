import 'dotenv/config';
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
await bootstrap();
