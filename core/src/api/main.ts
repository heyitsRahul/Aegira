import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainErrorFilter } from './domain-error.filter';
import { SESSION_SERVICE } from './session.controller';
import { SystemClock } from './system-clock';
import { SessionService } from '../services/session.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new DomainErrorFilter());

  // The timer sweep that drives countdown activation, auto-close, and
  // purge. Tests call evaluateTimers with a manual clock; the running app
  // calls it every second with the real one.
  const sessions = app.get<SessionService>(SESSION_SERVICE);
  const clock = new SystemClock();
  const sweep = setInterval(() => void sessions.evaluateTimers(clock.now()), 1000);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      clearInterval(sweep);
      void app.close().then(() => process.exit(0));
    });
  }

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
