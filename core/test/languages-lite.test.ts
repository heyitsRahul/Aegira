import { describe, expect, it } from 'vitest';
import { LiteErrorFilter } from '../src/api/lite.controller';
import { PublicController, UPCOMING_LANGUAGES } from '../src/api/public.controller';
import { InvalidInputError, NotAuthenticatedError, SessionNotFoundError } from '../src/domain/errors';
import { InMemoryMetrics } from '../src/services/metrics';
import { WaitlistService } from '../src/services/waitlist.service';

describe('coming-soon Indian languages', () => {
  const rig = () => {
    const metrics = new InMemoryMetrics();
    return { metrics, api: new PublicController({} as WaitlistService, metrics) };
  };

  it('lists what is available now and what is coming', () => {
    const { api } = rig();
    const list = api.languages();
    expect(list.available).toEqual(['en', 'hi']);
    expect(list.upcoming.map((l) => l.code)).toContain('ta');
    expect(list.upcoming.map((l) => l.code)).not.toContain('hi');
  });

  it('counts a vote per language, with no identity attached', () => {
    const { api, metrics } = rig();
    expect(api.voteLanguage({ code: 'bn' })).toEqual({ ok: true });
    api.voteLanguage({ code: 'bn' });
    api.voteLanguage({ code: 'ta' });
    expect(metrics.snapshot()).toEqual({ 'language.vote.bn': 2, 'language.vote.ta': 1 });
  });

  it('ignores unknown codes, so the counter names stay a fixed list', () => {
    const { api, metrics } = rig();
    expect(api.voteLanguage({ code: 'x"><script>' })).toEqual({ ok: false });
    expect(api.voteLanguage({})).toEqual({ ok: false });
    expect(metrics.snapshot()).toEqual({});
  });

  it('every upcoming language has a code and a name in its own script', () => {
    for (const lang of UPCOMING_LANGUAGES) {
      expect(lang.code).toMatch(/^[a-z]{2}$/);
      expect(lang.name).not.toMatch(/^[A-Za-z]/);
    }
  });
});

describe('lite pages never show raw errors', () => {
  function capture(error: Error) {
    const sent: { status?: number; type?: string; body?: string } = {};
    const response = {
      status(code: number) { sent.status = code; return this; },
      type(t: string) { sent.type = t; return this; },
      send(body: string) { sent.body = body; return this; },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response }) } as never;
    new LiteErrorFilter().catch(error as never, host);
    return sent;
  }

  it('a mistyped phone number gets a readable page with a way back', () => {
    const sent = capture(new InvalidInputError('that phone number does not look right. Use 10 digits, or + and the country code'));
    expect(sent.status).toBe(400);
    expect(sent.type).toBe('html');
    expect(sent.body).toContain('that phone number does not look right. Use 10 digits, or + and the country code');
    expect(sent.body).not.toContain('invalid input');
    expect(sent.body).not.toContain('{"error"');
    expect(sent.body).toContain('href="/lite"');
  });

  it('broken or old links get plain words', () => {
    expect(capture(new SessionNotFoundError('s-1')).status).toBe(404);
    expect(capture(new NotAuthenticatedError()).body).toContain('link in your message');
  });
});
