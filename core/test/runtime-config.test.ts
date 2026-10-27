import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminController } from '../src/api/admin.controller';
import { DevController } from '../src/api/dev.controller';
import { GatewayController } from '../src/api/gateway.controller';
import {
  DEV_ADMIN_TOKEN,
  DEV_GATEWAY_SECRET,
  resolveRuntimeConfig,
  tokenMatches,
} from '../src/api/runtime-config';
import { NotAuthenticatedError } from '../src/domain/errors';
import { InMemoryMetrics } from '../src/services/metrics';
import { StubNotifier } from '../src/services/notification.service';
import { SessionService } from '../src/services/session.service';
import { StubSmsTransport } from '../src/services/sms';
import { SmsGatewayService } from '../src/services/sms-gateway.service';
import { WaitlistService } from '../src/services/waitlist.service';
import { ResponderRegistry } from '../src/api/responder-registry';

describe('runtime config', () => {
  it('uses dev defaults outside production so local demos just work', () => {
    const config = resolveRuntimeConfig({});
    expect(config.production).toBe(false);
    expect(config.demoMode).toBe(true);
    expect(config.adminToken).toBe(DEV_ADMIN_TOKEN);
    expect(config.gatewaySecret).toBe(DEV_GATEWAY_SECRET);
    expect(config.baseUrl).toBe('http://localhost:3000');
  });

  it('never falls back to a dev secret in production', () => {
    const config = resolveRuntimeConfig({ NODE_ENV: 'production' });
    expect(config.adminToken).toBeNull();
    expect(config.gatewaySecret).toBeNull();
  });

  it('treats blank values as unset', () => {
    const config = resolveRuntimeConfig({ NODE_ENV: 'production', AEGIRA_ADMIN_TOKEN: '  ' });
    expect(config.adminToken).toBeNull();
  });

  it('reads AEGIRA_* and still honours the pre-rename SAHAY_* names', () => {
    expect(resolveRuntimeConfig({ SAHAY_ADMIN_TOKEN: 'old' }).adminToken).toBe('old');
    expect(
      resolveRuntimeConfig({ SAHAY_ADMIN_TOKEN: 'old', AEGIRA_ADMIN_TOKEN: 'new' }).adminToken,
    ).toBe('new');
    expect(resolveRuntimeConfig({ AEGIRA_DB: ':memory:' }).dbPath).toBe(':memory:');
  });

  it('picks up the host platform URL for alert links unless one is set', () => {
    const render = { RENDER_EXTERNAL_URL: 'https://aegira.onrender.com' };
    expect(resolveRuntimeConfig(render).baseUrl).toBe('https://aegira.onrender.com');
    expect(
      resolveRuntimeConfig({ ...render, AEGIRA_BASE_URL: 'https://aegira.app' }).baseUrl,
    ).toBe('https://aegira.app');
  });

  it('demo mode is on unless explicitly switched off', () => {
    expect(resolveRuntimeConfig({ NODE_ENV: 'production' }).demoMode).toBe(true);
    expect(resolveRuntimeConfig({ AEGIRA_DEMO: 'off' }).demoMode).toBe(false);
    expect(resolveRuntimeConfig({ AEGIRA_DEMO: 'OFF' }).demoMode).toBe(false);
  });
});

describe('tokenMatches', () => {
  it('an unconfigured secret matches nothing — not even an empty string', () => {
    expect(tokenMatches(undefined, null)).toBe(false);
    expect(tokenMatches('', null)).toBe(false);
    expect(tokenMatches('null', null)).toBe(false);
  });

  it('matches only the exact secret', () => {
    expect(tokenMatches('s3cret', 's3cret')).toBe(true);
    expect(tokenMatches('s3cre', 's3cret')).toBe(false);
    expect(tokenMatches(undefined, 's3cret')).toBe(false);
  });
});

const FIXED_CLOCK = { now: () => new Date('2026-10-27T10:00:00.000Z') };

describe('production lock-down of founder and gateway surfaces', () => {
  const gatewayStub = { handle: async () => 'ok' } as unknown as SmsGatewayService;

  it('locks the admin dashboard when no token is configured', () => {
    const admin = new AdminController(
      {} as WaitlistService,
      new InMemoryMetrics(),
      null,
    );
    expect(() => admin.data(DEV_ADMIN_TOKEN)).toThrow(NotAuthenticatedError);
    expect(() => admin.data(undefined)).toThrow(NotAuthenticatedError);
  });

  it('closes the JSON SMS webhook when no secret is configured', async () => {
    const gateway = new GatewayController(gatewayStub, null, null, 'https://x', false, null, FIXED_CLOCK);
    await expect(
      gateway.inbound({ from: '+919876543210', text: 'STATUS' }, DEV_GATEWAY_SECRET),
    ).rejects.toThrow(NotAuthenticatedError);
  });

  it('rejects unsigned Twilio webhooks in production', async () => {
    const gateway = new GatewayController(gatewayStub, 's', null, 'https://x', false, null, FIXED_CLOCK);
    const req = { originalUrl: '/gateway/twilio' } as never;
    await expect(gateway.twilio({ From: '+1', Body: 'SOS' }, req)).rejects.toThrow(
      NotAuthenticatedError,
    );
  });

  it('accepts unsigned Twilio webhooks in local dev only', async () => {
    const gateway = new GatewayController(gatewayStub, 's', null, 'https://x', true, null, FIXED_CLOCK);
    const req = { originalUrl: '/gateway/twilio' } as never;
    await expect(gateway.twilio({ From: '+1', Body: 'SOS' }, req)).resolves.toContain('ok');
  });
});

describe('demo-only surfaces', () => {
  function dev(demoMode: boolean): DevController {
    return new DevController(
      { opsView: () => ({ state: 'ACTIVE' }) } as unknown as SessionService,
      new StubNotifier(),
      new StubSmsTransport(),
      new ResponderRegistry(),
      { handle: async () => 'ok' } as unknown as SmsGatewayService,
      demoMode,
    );
  }

  it('the duress-revealing ops view and simulators 404 when demo mode is off', async () => {
    const off = dev(false);
    expect(() => off.truth('s-1')).toThrow(NotFoundException);
    expect(() => off.outbox()).toThrow(NotFoundException);
    expect(() => off.smsLog()).toThrow(NotFoundException);
    expect(() => off.roster()).toThrow(NotFoundException);
    await expect(off.phoneSms({ from: '+1', text: 'SOS' })).rejects.toThrow(NotFoundException);
  });

  it('are available in demo mode', async () => {
    const on = dev(true);
    expect(on.truth('s-1')).toEqual({ state: 'ACTIVE' });
    expect(await on.phoneSms({ from: '+1', text: 'STATUS' })).toEqual({ reply: 'ok' });
  });
});
