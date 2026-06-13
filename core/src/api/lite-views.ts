/**
 * Server-rendered HTML for the /lite channel: plain forms, no JavaScript,
 * no CSS framework, tiny pages. Works on Opera Mini, KaiOS, old Android
 * stock browsers, and anything else that can render a form. Status pages
 * auto-refresh with a meta tag instead of polling scripts.
 */

import { COUNTRIES, DEFAULT_COUNTRY, Helpline, helplinesFor } from '../domain/reference';

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Official-helpline block: always reachable, even when no responder is. */
function helplineBlock(country: string = DEFAULT_COUNTRY): string {
  const lines = helplinesFor(country)
    .map(
      (h: Helpline) =>
        `<a href="tel:${esc(h.number)}">${esc(h.number)}</a> ${esc(h.label)}`,
    )
    .join(' &middot; ');
  return `<div class="box"><b>Official emergency numbers</b><br><small>${lines}</small></div>`;
}

function countryOptions(selected: string = DEFAULT_COUNTRY): string {
  return COUNTRIES.map(
    (c) =>
      `<option value="${esc(c.dial)}"${c.dial === dialOf(selected) ? ' selected' : ''}>` +
      `${esc(c.name)} (+${esc(c.dial)})</option>`,
  ).join('');
}

function dialOf(country: string): string {
  return COUNTRIES.find((c) => c.code === country)?.dial ?? '91';
}

/** Applies a chosen dial code to a nationally-typed number. */
export function applyDial(raw: string, dial?: string): string {
  const d = (dial ?? '91').replace(/\D/g, '');
  const t = (raw ?? '').trim();
  return t.startsWith('+') || t.startsWith('00') ? t : `+${d}${t.replace(/^0+/, '')}`;
}

export function page(title: string, body: string, refreshSeconds?: number): string {
  const refresh =
    refreshSeconds === undefined
      ? ''
      : `<meta http-equiv="refresh" content="${refreshSeconds}">`;
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    refresh +
    `<title>${esc(title)} - Sahay</title>` +
    '<style>body{font-family:sans-serif;max-width:30em;margin:0 auto;padding:12px;background:#fff;color:#111}' +
    'input,select,button{font-size:1em;padding:6px;margin:4px 0;width:95%}' +
    'button{background:#c4302b;color:#fff;border:0;padding:10px}' +
    '.box{border:1px solid #999;padding:8px;margin:10px 0}' +
    'small{color:#555}</style></head><body>' +
    `<p><b>SAHAY</b> | <a href="/lite">home</a></p><h3>${esc(title)}</h3>` +
    body +
    '</body></html>'
  );
}

/** Demo areas for phones with no GPS: the user says where they are. */
export const LITE_AREAS: ReadonlyArray<{ id: string; label: string; lat: number; lng: number }> = [
  { id: 'mg-road', label: 'MG Road', lat: 12.975, lng: 77.606 },
  { id: 'koramangala', label: 'Koramangala', lat: 12.935, lng: 77.624 },
  { id: 'whitefield', label: 'Whitefield', lat: 12.97, lng: 77.75 },
  { id: 'yeshwanthpur', label: 'Yeshwanthpur', lat: 13.028, lng: 77.54 },
];

const phoneWithDial = (): string =>
  `<select name="dial">${countryOptions()}</select>` +
  '<input name="phone" placeholder="your phone number" inputmode="tel">';

const pinFields = (): string =>
  phoneWithDial() + '<input name="pin" placeholder="PIN" inputmode="numeric" type="password">';

export function homePage(): string {
  const areas = LITE_AREAS.map((a) => `<option value="${a.id}">${esc(a.label)}</option>`).join('');
  return page(
    'Emergency help',
    '<div class="box"><form method="post" action="/lite/sos">' +
      '<b>I need help now</b><br>' +
      phoneWithDial() +
      `<select name="area">${areas}</select>` +
      '<select name="category"><option value="personal_safety">Personal safety</option>' +
      '<option value="medical">Medical</option><option value="accident">Accident</option>' +
      '<option value="other">Other</option></select>' +
      '<button type="submit">SEND SOS</button>' +
      '<small>Starts a session with a 30 second cancel window.</small></form></div>' +
      '<div class="box"><form method="post" action="/lite/watch">' +
      '<b>Watch my journey home</b><br>' +
      phoneWithDial() +
      `<select name="area">${areas}</select>` +
      '<input name="minutes" placeholder="minutes until I arrive" inputmode="numeric">' +
      '<button type="submit">START WATCH</button>' +
      '<small>If you do not check in safe in time, your circle is alerted.</small></form></div>' +
      '<div class="box"><form method="post" action="/lite/status">' +
      `<b>Check my session</b><br>${pinFields()}<button type="submit">STATUS</button></form></div>` +
      '<div class="box"><form method="post" action="/lite/register">' +
      '<b>First time? Register</b><br>' +
      `<select name="dial">${countryOptions()}</select>` +
      '<input name="phone" placeholder="your phone number" inputmode="tel">' +
      '<input name="name" placeholder="your name">' +
      '<input name="contact" placeholder="trusted contact phone" inputmode="tel">' +
      '<input name="pinSafe" placeholder="safe PIN (cancels)" inputmode="numeric">' +
      '<input name="pinDuress" placeholder="duress PIN" inputmode="numeric">' +
      '<button type="submit">REGISTER</button>' +
      '<small>Works anywhere: pick your country, or type a full +country number. ' +
      'Over SMS too: text REG to the Sahay number.</small>' +
      '</form></div>' +
      helplineBlock(),
  );
}

export function messagePage(title: string, message: string, statusForm = false): string {
  const form = statusForm
    ? `<div class="box"><form method="post" action="/lite/status"><b>Check session</b><br>${pinFields()}<button type="submit">STATUS</button></form></div>`
    : '';
  return page(title, `<p>${esc(message)}</p>${form}${helplineBlock()}`);
}

export function sosAcceptedPage(seconds: number): string {
  return page(
    'SOS received',
    `<p><b>Your circle will be alerted in ${seconds} seconds.</b></p>` +
      '<div class="box"><form method="post" action="/lite/cancel">' +
      `Cancel it? ${pinFields()}<button type="submit">CANCEL</button></form></div>` +
      '<div class="box"><form method="post" action="/lite/status">' +
      `Or check progress: ${pinFields()}<button type="submit">STATUS</button></form></div>` +
      helplineBlock(),
  );
}

/** Rendered identically for safe and duress cancels (invariant 4). */
export function cancelledPage(): string {
  return messagePage('Cancelled', 'Session cancelled. Nobody was notified.');
}

export function statusPage(stateText: string, showSafeForm: boolean, isWatch = false): string {
  const safeForm = showSafeForm
    ? '<div class="box"><form method="post" action="/lite/safe">' +
      `${isWatch ? 'I have arrived' : 'I am safe now'}: ${pinFields()}` +
      `<button type="submit">${isWatch ? 'CHECK IN SAFE' : 'MARK SAFE'}</button></form></div>`
    : '';
  const extendForm = isWatch
    ? '<div class="box"><form method="post" action="/lite/extend">' +
      `Need more time? ${pinFields()}` +
      '<input name="minutes" placeholder="extra minutes" inputmode="numeric">' +
      '<button type="submit">EXTEND WATCH</button></form></div>'
    : '';
  return page(
    'Session status',
    `<p><b>${esc(stateText)}</b></p>${safeForm}${extendForm}` +
      '<small>This page does not update itself; use the STATUS form on the home page to check again.</small>',
  );
}

export function contactViewPage(view: {
  helpseekerDisplayName: string;
  state: string;
  duress: boolean;
  category: string;
  location: { lat: number; lng: number } | null;
  canDispatch: boolean;
  sessionId: string;
  token: string;
}): string {
  const duressBox = view.duress
    ? '<div class="box" style="border-color:#c4302b"><b>DURESS:</b> their phone shows ' +
      '"cancelled". Do NOT call them. The attacker may be present.</div>'
    : '';
  const where = view.location
    ? `<p>Last location: <b>${view.location.lat.toFixed(5)}, ${view.location.lng.toFixed(5)}</b></p>`
    : '<p>No live location available.</p>';
  const dispatch = view.canDispatch
    ? `<form method="post" action="/lite/c/${esc(view.sessionId)}/dispatch?t=${esc(view.token)}">` +
      '<button type="submit">SEND VERIFIED RESPONDERS</button></form>'
    : '';
  return page(
    `${view.helpseekerDisplayName} - ${view.state}`,
    `${duressBox}<p>Category: ${esc(view.category.replace(/_/g, ' '))}</p>${where}${dispatch}` +
      '<small>This page refreshes every 15 seconds.</small>',
    15,
  );
}
