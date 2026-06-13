/**
 * Reference data shared by every channel (app, lite web, server-rendered
 * pages). India is the default and is detailed; other countries are
 * supported so the system works anywhere. Any number can still be entered
 * in full `+<code>` form even if its country is not listed here.
 *
 * Pure data — no framework, no I/O.
 */

export interface Country {
  /** ISO 3166-1 alpha-2. */
  readonly code: string;
  readonly name: string;
  /** Dial code without the leading '+'. */
  readonly dial: string;
}

export const DEFAULT_COUNTRY = 'IN';

/**
 * A pragmatic, deduplicated set covering the most common diaspora origins
 * and destinations. The UI also offers a free "+code" entry, so this list
 * is a convenience, not a limit.
 */
export const COUNTRIES: readonly Country[] = [
  { code: 'IN', name: 'India', dial: '91' },
  { code: 'US', name: 'United States', dial: '1' },
  { code: 'GB', name: 'United Kingdom', dial: '44' },
  { code: 'CA', name: 'Canada', dial: '1' },
  { code: 'AU', name: 'Australia', dial: '61' },
  { code: 'AE', name: 'United Arab Emirates', dial: '971' },
  { code: 'SA', name: 'Saudi Arabia', dial: '966' },
  { code: 'SG', name: 'Singapore', dial: '65' },
  { code: 'MY', name: 'Malaysia', dial: '60' },
  { code: 'BD', name: 'Bangladesh', dial: '880' },
  { code: 'PK', name: 'Pakistan', dial: '92' },
  { code: 'LK', name: 'Sri Lanka', dial: '94' },
  { code: 'NP', name: 'Nepal', dial: '977' },
  { code: 'ZA', name: 'South Africa', dial: '27' },
  { code: 'NG', name: 'Nigeria', dial: '234' },
  { code: 'KE', name: 'Kenya', dial: '254' },
  { code: 'DE', name: 'Germany', dial: '49' },
  { code: 'FR', name: 'France', dial: '33' },
  { code: 'IT', name: 'Italy', dial: '39' },
  { code: 'ES', name: 'Spain', dial: '34' },
  { code: 'NL', name: 'Netherlands', dial: '31' },
  { code: 'BR', name: 'Brazil', dial: '55' },
  { code: 'MX', name: 'Mexico', dial: '52' },
  { code: 'JP', name: 'Japan', dial: '81' },
  { code: 'CN', name: 'China', dial: '86' },
  { code: 'ID', name: 'Indonesia', dial: '62' },
  { code: 'PH', name: 'Philippines', dial: '63' },
];

export interface Helpline {
  readonly label: string;
  readonly number: string;
}

/**
 * Official emergency numbers, by country. India is complete; others carry
 * at least the primary line. 112 reaches emergency services on virtually
 * every GSM network worldwide and is the universal fallback.
 */
export const UNIVERSAL_HELPLINE: Helpline = {
  label: 'Emergency (most mobile networks)',
  number: '112',
};

export const HELPLINES: Readonly<Record<string, readonly Helpline[]>> = {
  IN: [
    { label: 'All emergencies', number: '112' },
    { label: 'Police', number: '100' },
    { label: 'Ambulance', number: '108' },
    { label: 'Fire', number: '101' },
    { label: 'Women helpline', number: '1091' },
    { label: 'Child helpline', number: '1098' },
    { label: 'Disaster management', number: '1078' },
  ],
  US: [
    { label: 'All emergencies', number: '911' },
  ],
  CA: [{ label: 'All emergencies', number: '911' }],
  GB: [
    { label: 'All emergencies', number: '999' },
    { label: 'Emergency (alt)', number: '112' },
  ],
  AU: [{ label: 'All emergencies', number: '000' }],
  AE: [
    { label: 'Police', number: '999' },
    { label: 'Ambulance', number: '998' },
    { label: 'Fire', number: '997' },
  ],
  SG: [
    { label: 'Police', number: '999' },
    { label: 'Ambulance / Fire', number: '995' },
  ],
  BD: [{ label: 'All emergencies', number: '999' }],
  PK: [
    { label: 'Police', number: '15' },
    { label: 'Ambulance (Edhi)', number: '115' },
  ],
  NP: [{ label: 'Police', number: '100' }],
  LK: [{ label: 'All emergencies', number: '119' }],
  ZA: [{ label: 'All emergencies', number: '112' }],
  DE: [{ label: 'All emergencies', number: '112' }],
  FR: [{ label: 'All emergencies', number: '112' }],
  IT: [{ label: 'All emergencies', number: '112' }],
  ES: [{ label: 'All emergencies', number: '112' }],
  NL: [{ label: 'All emergencies', number: '112' }],
  JP: [
    { label: 'Police', number: '110' },
    { label: 'Ambulance / Fire', number: '119' },
  ],
};

export function helplinesFor(country: string): readonly Helpline[] {
  return HELPLINES[country] ?? [UNIVERSAL_HELPLINE];
}

export function dialCodeFor(country: string): string {
  return COUNTRIES.find((c) => c.code === country)?.dial ?? '91';
}
