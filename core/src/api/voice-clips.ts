import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Recorded voice clips: real people reading the app's fixed spoken lines, so
 * prompts and the fake call sound human instead of like the phone's robot
 * voice. They are static app assets (no user data). The app plays a clip when
 * one exists for the chosen language and falls back to the phone's voice
 * otherwise.
 *
 * Only these exact names are ever served, so a request can't reach any other
 * file on disk.
 */
export const VOICE_LANGS = ['en', 'hi'] as const;
export const VOICE_KEYS = [
  'v_sos', 'v_active', 'v_safe', 'v_checkin', 'v_cancelled', 'v_watch',
  'fake_1', 'fake_2', 'fake_3', 'fake_4',
] as const;
export const VOICE_EXT = '.m4a';

export function isVoiceClip(lang: string, file: string): boolean {
  if (!(VOICE_LANGS as readonly string[]).includes(lang)) return false;
  if (!file.endsWith(VOICE_EXT)) return false;
  return (VOICE_KEYS as readonly string[]).includes(file.slice(0, -VOICE_EXT.length));
}

/** Which clips are actually recorded, per language. Missing folder = none. */
export function listVoiceClips(voiceDir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const lang of VOICE_LANGS) {
    const dir = join(voiceDir, lang);
    const files = existsSync(dir) ? readdirSync(dir) : [];
    out[lang] = VOICE_KEYS.filter((k) => files.includes(k + VOICE_EXT) && isVoiceClip(lang, k + VOICE_EXT));
  }
  return out;
}
