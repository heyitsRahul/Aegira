import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isVoiceClip, listVoiceClips, VOICE_KEYS } from '../src/api/voice-clips';

describe('recorded voice clips', () => {
  it('serves only whitelisted language and line names', () => {
    expect(isVoiceClip('en', 'v_sos.m4a')).toBe(true);
    expect(isVoiceClip('hi', 'fake_4.m4a')).toBe(true);
    for (const [lang, file] of [
      ['en', '../app.html'], ['en', 'v_sos.mp3'], ['fr', 'v_sos.m4a'], ['..', 'v_sos.m4a'],
      ['en', 'fake_5.m4a'], ['en', '.m4a'], ['en', 'v_sos.m4a/../../x'], ['hi', 'session.m4a'],
    ]) {
      expect(isVoiceClip(lang, file)).toBe(false);
    }
  });

  it('lists only clips that exist and are on the whitelist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'voice-'));
    mkdirSync(join(dir, 'en'));
    for (const f of ['v_sos.m4a', 'fake_1.m4a', 'notes.txt', 'evil.m4a']) writeFileSync(join(dir, 'en', f), 'x');
    expect(listVoiceClips(dir)).toEqual({ en: ['v_sos', 'fake_1'], hi: [] });
  });

  it('covers every line the app speaks', () => {
    const page = readFileSync(join(__dirname, '..', 'public', 'app.html'), 'utf8');
    const spoken = [...new Set([...page.matchAll(/speakKey\('([a-z_]+)'\)/g)].map((m) => m[1]))];
    expect(spoken.length).toBeGreaterThan(0);
    for (const key of spoken) expect(VOICE_KEYS).toContain(key);
    const fakeLines = page.match(/fake_lines: \[([^\]]*)\]/);
    expect(fakeLines).not.toBeNull();
    expect((fakeLines![1].match(/', '/g) || []).length + 1).toBe(VOICE_KEYS.filter((k) => k.startsWith('fake_')).length);
  });

  it('falls back to the phone voice when a clip is missing or fails', () => {
    const page = readFileSync(join(__dirname, '..', 'public', 'app.html'), 'utf8');
    const block = page.slice(page.indexOf('function playClip('), page.indexOf('function stopSpeaking('));
    expect(block).toContain('speak(fallbackText, opts)');
    expect(block).toContain('a.onerror = fallback');
    expect(block).toMatch(/setTimeout\(\(\) => \{ if \(!playing\) fallback\(\); \}, 2500\)/);
  });
});
