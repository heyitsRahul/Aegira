import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * "Check the way before you go" (architecture §3.6) is a link-out to Google
 * Maps. The destination a person types must never reach Aegira or the phone's
 * storage: that would be a location outside a session (invariant 1).
 */
const page = readFileSync(join(__dirname, '..', 'public', 'app.html'), 'utf8');
const planLines = page.split('\n').filter((line) => /planDest|\bdest\b/.test(line));
const planBlock = page.slice(page.indexOf('let planDest'), page.indexOf('function toolsRow('));

describe('before-you-go route check', () => {
  it('exists on the app page', () => {
    expect(planBlock.length).toBeGreaterThan(0);
    expect(planBlock).toContain('https://www.google.com/maps/dir/?api=1');
  });

  it('never sends the destination to Aegira or stores it on the phone', () => {
    expect(planLines.length).toBeGreaterThan(0);
    for (const line of planLines) {
      expect(line).not.toMatch(/fetch\(|\bapi\(|sendBeacon|XMLHttpRequest|store\.set|localStorage|sessionStorage/);
    }
    expect(planBlock).not.toMatch(/fetch\(|\bapi\(|sendBeacon|XMLHttpRequest|store\.set|localStorage|sessionStorage/);
  });

  it('only opens Google Maps, without a referrer', () => {
    const urls = [...planBlock.matchAll(/`(https?:\/\/[^`$]+)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url.startsWith('https://www.google.com/maps/')).toBe(true);
    }
    expect(planBlock).toContain("'noopener,noreferrer'");
  });

  it('offers no camera feeds and hosts no place reviews', () => {
    expect(planBlock).not.toMatch(/camera|cctv|insecam|rating/i);
  });
});
