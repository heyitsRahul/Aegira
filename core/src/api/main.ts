import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainErrorFilter } from './domain-error.filter';
import { SESSION_SERVICE } from './session.controller';
import { SystemClock } from './system-clock';
import { SessionService } from '../services/session.service';
import { androidGatewayConfigFromEnv, ensureAndroidWebhook } from '../services/android-gateway';
import { resolveRuntimeConfig } from './runtime-config';

async function bootstrap(): Promise<void> {
  // rawBody: the Android SMS gateway signs the exact bytes it sent.
  const app = await NestFactory.create(AppModule, { rawBody: true });
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

  // A real phone number via an Android SIM gateway: point its incoming texts
  // at us. Only over https (the gateway refuses plain http to the internet).
  const android = androidGatewayConfigFromEnv(process.env);
  const baseUrl = resolveRuntimeConfig(process.env).baseUrl;
  if (android !== null && baseUrl.startsWith('https://')) {
    ensureAndroidWebhook(android, `${baseUrl}/gateway/android`)
      .then((result) => console.log(`SMS gateway webhook: ${result}`))
      .catch((error: Error) => console.error(`SMS gateway webhook: ${error.message}`));
  }
}

void bootstrap();
