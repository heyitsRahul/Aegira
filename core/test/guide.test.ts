import { describe, expect, it } from 'vitest';
import { guidePage, offlinePage } from '../src/api/guide-view';

const NO_NUMBER = { smsNumber: null, demoMode: true };
const WITH_NUMBER = { smsNumber: '+91 98765 00000', demoMode: false };

describe('/guide', () => {
  it('works without JavaScript, so it opens on any phone browser', () => {
    for (const lang of ['en', 'hi'] as const) {
      expect(guidePage(lang, NO_NUMBER)).not.toMatch(/<script/i);
    }
  });

  it('covers every channel: app, lite web, SMS, and trusted contacts', () => {
    const html = guidePage('en', NO_NUMBER);
    expect(html).toContain('href="/app"');
    expect(html).toContain('href="/lite"');
    expect(html).toContain('SOS');
    expect(html).toContain('REG Meera');
    expect(html).toContain('trusted person');
    expect(html).toContain('tel:112');
  });

  it('points at the simulator until a real number is set up', () => {
    const html = guidePage('en', NO_NUMBER);
    expect(html).toContain('href="/phone"');
    expect(html).not.toContain('JOIN');
  });

  it('shows the real number and the contact opt-in once one exists', () => {
    const html = guidePage('en', WITH_NUMBER);
    expect(html).toContain('+91 98765 00000');
    expect(html).toContain('JOIN');
  });

  it('only shows demo PINs and the ops console in demo mode', () => {
    expect(guidePage('en', NO_NUMBER)).toContain('/console');
    expect(guidePage('en', WITH_NUMBER)).not.toContain('/console');
  });

  it('has a Hindi version that links back to English', () => {
    const html = guidePage('hi', NO_NUMBER);
    expect(html).toContain('lang="hi"');
    expect(html).toContain('कैसे इस्तेमाल करें');
    expect(html).toContain('/guide?lang=en');
  });

  it('escapes the configured number', () => {
    const html = guidePage('en', { smsNumber: '<b>x</b>', demoMode: false });
    expect(html).not.toContain('<b>x</b>');
  });
});

describe('offline page', () => {
  it('always offers 112, with no scripts or external assets', () => {
    const html = offlinePage(NO_NUMBER);
    expect(html).toContain('href="tel:112"');
    expect(html).not.toMatch(/<script|src=|<link/i);
  });

  it('offers a one-tap SOS text when a number is set up', () => {
    expect(offlinePage(WITH_NUMBER)).toContain('href="sms:+919876500000?body=SOS"');
    expect(offlinePage(NO_NUMBER)).not.toContain('sms:');
  });
});
