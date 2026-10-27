/**
 * /guide — "how to use Aegira", server-rendered with no JavaScript so it
 * opens on every phone browser (KaiOS, Opera Mini) and prints cleanly.
 * English and Hindi. Shows the real SMS number when one is configured;
 * otherwise points at the phone simulator.
 */

export type GuideLang = 'en' | 'hi';

export interface GuideOptions {
  /** Display form of the Aegira SMS number, e.g. "+91 98xxx xxxxx". */
  smsNumber: string | null;
  demoMode: boolean;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Copy {
  title: string;
  intro: string;
  demoNote: string;
  emergency: string;
  pick: string;
  smart: string;
  smartSteps: string[];
  install: string;
  installSteps: string[];
  watch: string;
  watchSteps: string[];
  browser: string;
  browserSteps: string[];
  basic: string;
  basicIntro: (n: string | null) => string;
  basicSteps: Array<[string, string]>;
  basicSim: string;
  contact: string;
  contactSteps: (n: string | null) => string[];
  pins: string;
  pinsText: string;
  tryDemo: string;
  tryDemoSteps: string[];
  other: string;
  langs: string;
}

const EN: Copy = {
  title: 'How to use Aegira',
  intro:
    'Aegira tells the people you trust when you are in danger. It works on a smartphone, ' +
    'on an old phone’s web browser, and by SMS on a basic phone.',
  demoNote:
    'This is a working prototype. No real helpers are connected yet.',
  emergency: 'In danger right now? Call 112.',
  pick: 'Pick your phone',
  smart: '📱 Smartphone (Android or iPhone)',
  smartSteps: [
    'Open <a href="/app">the app</a>.',
    'Tap your language.',
    'Tap <b>🆘 I need help</b>.',
    'Type your name and one trusted person\'s phone number.',
    'Choose two PINs (secret numbers): a <b>safe PIN</b> that really cancels, and a <b>danger PIN</b> that is a secret alarm.',
    'In danger? Press the big red <b>SOS</b> button.',
    'You get 30 seconds to cancel with your safe PIN. Then your person gets a message with where you are.',
    'When you are safe, tap <b>I am safe now</b>. Everything is then deleted.',
  ],
  install: 'Put it on your home screen',
  installSteps: [
    '<b>Android (Chrome):</b> tap ⋮ (top right) → <b>Install app</b> or <b>Add to Home screen</b>.',
    '<b>iPhone (Safari):</b> tap the Share button □↑ → <b>Add to Home Screen</b>.',
  ],
  watch: '🛡️ Going somewhere alone?',
  watchSteps: [
    'In the app, tap <b>Going somewhere</b> and choose how many minutes.',
    'When you reach, tap <b>I have reached safely</b> and type your PIN.',
    'If you don\'t, your person gets a message.',
  ],
  browser: '🌐 Old phone or slow internet',
  browserSteps: [
    'Open <a href="/lite">the simple version</a>. It works on very old phones.',
    'Fill in <b>First time? Sign up</b> once.',
    'In danger, fill in <b>I need help now</b> and press <b>SEND SOS</b>.',
  ],
  basic: '📟 Basic phone, no internet',
  basicIntro: (n) =>
    n === null
      ? 'Send these SMS messages to the Aegira number:'
      : `Send these SMS messages to <b>${esc(n)}</b>:`,
  basicSteps: [
    ['REG Meera 9876543210 1234 9999', 'Sign up once: your name, your person\'s number, safe PIN, danger PIN.'],
    ['SOS', 'Ask for help. Add where you are if you can: SOS near Andheri station'],
    ['CANCEL 1234', 'Stop it within 30 seconds.'],
    ['WATCH 20', 'Watch my journey for 20 minutes.'],
    ['SAFE 1234', 'I have reached / I am safe.'],
    ['STATUS', 'What is happening?'],
    ['STOP', 'Delete my registration.'],
  ],
  basicSim: 'No number is set up for this demo yet. Try it on the <a href="/phone">basic-phone simulator</a>.',
  contact: '👁️ If someone made you their trusted person',
  contactSteps: (n) => [
    ...(n === null
      ? []
      : [`Text <b>JOIN</b> to <b>${esc(n)}</b> once, so Aegira is allowed to text you alerts.`]),
    'You get an SMS: <i>“AEGIRA ALERT: Meera needs help”</i> with a link.',
    'Open the link to see where they are. Call them.',
    'If it says <b>SECRET ALARM</b>, do not call. Someone may be with them.',
    'If someone needs to go to them, reply <b>SEND</b> (or tap the button on the page) to send a trained helper.',
  ],
  pins: 'Why two PINs?',
  pinsText:
    'If someone forces you to cancel, type your danger PIN. The screen says “cancelled”, ' +
    'but your person is secretly told you are in danger.',
  tryDemo: 'Trying the demo?',
  tryDemoSteps: [
    'Use safe PIN <b>1234</b> and danger PIN <b>9999</b>.',
    'Open <a href="/console">the behind-the-scenes view</a> to see what really happened.',
  ],
  other: 'हिंदी में पढ़ें',
  langs: 'English and हिंदी now. More Indian languages coming soon: বাংলা, मराठी, తెలుగు, தமிழ், ગુજરાતી, اردو, ಕನ್ನಡ, ଓଡ଼ିଆ, മലയാളം, ਪੰਜਾਬੀ, অসমীয়া. Open the app and tap yours, so we add it first.',
};

const HI: Copy = {
  title: 'Aegira कैसे इस्तेमाल करें',
  intro:
    'ख़तरे में होने पर Aegira आपके भरोसेमंद लोगों को बताता है। यह स्मार्टफ़ोन, ' +
    'किसी भी ब्राउज़र, और सादे फ़ोन पर SMS से चलता है।',
  demoNote: 'यह एक काम करने वाला प्रोटोटाइप है। अभी असली सहायक जुड़े नहीं हैं।',
  emergency: 'अभी ख़तरे में हैं? 112 पर कॉल करें।',
  pick: 'अपना फ़ोन चुनें',
  smart: '📱 स्मार्टफ़ोन (Android या iPhone)',
  smartSteps: [
    '<a href="/app">ऐप</a> खोलें।',
    'अपनी भाषा दबाएँ।',
    '<b>🆘 मुझे मदद चाहिए</b> दबाएँ।',
    'अपना नाम और एक भरोसेमंद व्यक्ति का फ़ोन नंबर लिखें।',
    'दो PIN चुनें: <b>सुरक्षित PIN</b> जो सच में रद्द करता है, और <b>ख़तरे वाला PIN</b> जो सिर्फ़ रद्द होने का दिखावा करता है।',
    'ख़तरे में? बड़ा लाल <b>SOS</b> बटन दबाएँ।',
    '30 सेकंड में सुरक्षित PIN से रद्द कर सकते हैं। फिर आपके भरोसेमंद व्यक्ति को आपकी लाइव जगह के साथ सूचना जाती है।',
    'सुरक्षित होने पर <b>मैं अब सुरक्षित हूँ</b> दबाएँ। फिर सब मिटा दिया जाता है।',
  ],
  install: 'होम स्क्रीन पर लगाएँ',
  installSteps: [
    '<b>Android (Chrome):</b> ⋮ (ऊपर दाएँ) दबाएँ → <b>Install app</b> या <b>Add to Home screen</b>।',
    '<b>iPhone (Safari):</b> Share बटन □↑ दबाएँ → <b>Add to Home Screen</b>।',
  ],
  watch: '🛡️ अकेले कहीं जा रहे हैं?',
  watchSteps: [
    'ऐप में <b>कहीं जा रहे हैं</b> दबाएँ और मिनट चुनें।',
    'पहुँचकर <b>मैं सुरक्षित पहुँच गया/गई</b> दबाएँ और PIN डालें।',
    'समय पर नहीं बताया तो आपके भरोसेमंद व्यक्ति को सूचना जाएगी।',
  ],
  browser: '🌐 पुराना फ़ोन या धीमा इंटरनेट',
  browserSteps: [
    '<a href="/lite">सादा संस्करण</a> खोलें। यह JavaScript के बिना चलता है।',
    'एक बार <b>First time? Sign up</b> भरें।',
    'ख़तरे में <b>I need help now</b> भरें और <b>SEND SOS</b> दबाएँ।',
  ],
  basic: '📟 सादा फ़ोन, इंटरनेट नहीं',
  basicIntro: (n) =>
    n === null
      ? 'Aegira नंबर पर ये SMS भेजें:'
      : `<b>${esc(n)}</b> पर ये SMS भेजें:`,
  basicSteps: [
    ['REG Meera 9876543210 1234 9999', 'एक बार रजिस्टर करें: आपका नाम, भरोसेमंद व्यक्ति का नंबर, सुरक्षित PIN, ख़तरे वाला PIN।'],
    ['SOS', 'मदद बुलाएँ। हो सके तो जगह लिखें: SOS near Andheri station'],
    ['CANCEL 1234', '30 सेकंड के अंदर रोकें।'],
    ['WATCH 20', '20 मिनट तक मेरी यात्रा पर नज़र रखें।'],
    ['SAFE 1234', 'मैं पहुँच गया/गई, सुरक्षित हूँ।'],
    ['STATUS', 'क्या हो रहा है?'],
    ['STOP', 'मेरा रजिस्ट्रेशन मिटाएँ।'],
  ],
  basicSim: 'इस डेमो के लिए अभी नंबर नहीं लगा है। <a href="/phone">सादे फ़ोन सिम्युलेटर</a> पर आज़माएँ।',
  contact: '👁️ अगर किसी ने आपको भरोसेमंद व्यक्ति बनाया है',
  contactSteps: (n) => [
    ...(n === null
      ? []
      : [`एक बार <b>${esc(n)}</b> पर <b>JOIN</b> भेजें, ताकि Aegira आपको सूचना भेज सके।`]),
    'आपको एक SMS आएगा: <i>"AEGIRA ALERT: Meera needs help"</i>, साथ में एक लिंक।',
    'लिंक खोलकर देखें वे कहाँ हैं। उन्हें कॉल करें।',
    'अगर <b>SECRET ALARM</b> लिखा हो, तो कॉल न करें। कोई उनके साथ हो सकता है।',
    'पास में मदद चाहिए तो <b>SEND</b> भेजें (या पेज पर बटन दबाएँ), प्रमाणित सहायक बुलाने के लिए।',
  ],
  pins: 'दो PIN क्यों?',
  pinsText:
    'अगर कोई आपसे ज़बरदस्ती रद्द करवाए, तो ख़तरे वाला PIN डालें। स्क्रीन पर "रद्द" दिखेगा, ' +
    'पर आपके भरोसेमंद व्यक्ति को चुपचाप बताया जाएगा कि आप ख़तरे में हैं।',
  tryDemo: 'डेमो आज़मा रहे हैं?',
  tryDemoSteps: [
    'सुरक्षित PIN <b>1234</b> और ख़तरे वाला PIN <b>9999</b> इस्तेमाल करें।',
    '<a href="/console">पर्दे के पीछे का दृश्य</a> खोलकर देखें कि असल में क्या हुआ।',
  ],
  other: 'Read in English',
  langs: 'अभी English और हिंदी। और भारतीय भाषाएँ जल्द आ रही हैं: বাংলা, मराठी, తెలుగు, தமிழ், ગુજરાતી, اردو, ಕನ್ನಡ, ଓଡ଼ିଆ, മലയാളം, ਪੰਜਾਬੀ, অসমীয়া। ऐप खोलकर अपनी भाषा दबाएँ, ताकि हम उसे पहले जोड़ें।',
};

/**
 * Shown by the service worker when the phone has no internet. Cached at
 * install time, so it must stand alone: no scripts, no external assets.
 */
export function offlinePage(opts: GuideOptions): string {
  const n = opts.smsNumber;
  const dial = n === null ? '' : n.replace(/[^\d+]/g, '');
  const sms =
    n === null
      ? ''
      : `<a class="b" href="sms:${esc(dial)}?body=SOS">📟 Text SOS to ${esc(n)}<br><small>SMS से SOS भेजें</small></a>`;
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>No internet - Aegira</title>' +
    '<style>body{font:18px/1.5 -apple-system,"Segoe UI",sans-serif;background:#0b0e14;color:#eef1f6;' +
    'max-width:30em;margin:0 auto;padding:24px 16px;text-align:center}' +
    '.b{display:block;background:#e5484d;color:#fff;font-weight:700;text-decoration:none;' +
    'border-radius:14px;padding:16px;margin:14px 0}.b.alt{background:#1b2233}small{font-weight:400}' +
    'p{color:#8b93a3}</style></head><body>' +
    '<h1>No internet</h1><p>इंटरनेट नहीं है</p>' +
    '<a class="b" href="tel:112">📞 Call 112<br><small>112 पर कॉल करें</small></a>' +
    sms +
    '<a class="b alt" href="/app">Try again &middot; फिर कोशिश करें</a>' +
    '</body></html>'
  );
}

const list = (items: string[]): string => `<ol>${items.map((i) => `<li>${i}</li>`).join('')}</ol>`;

export function guidePage(lang: GuideLang, opts: GuideOptions): string {
  const c = lang === 'hi' ? HI : EN;
  const n = opts.smsNumber;
  const sms =
    `<p>${c.basicIntro(n)}</p><table>` +
    c.basicSteps.map(([cmd, what]) => `<tr><td><code>${esc(cmd)}</code></td><td>${esc(what)}</td></tr>`).join('') +
    '</table>' +
    (n === null ? `<p class="note">${c.basicSim}</p>` : '');
  const demo = opts.demoMode
    ? `<section><h2>${c.tryDemo}</h2>${list(c.tryDemoSteps)}</section>`
    : '';
  return (
    `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${esc(c.title)}</title>` +
    '<style>body{font:17px/1.55 -apple-system,"Segoe UI",sans-serif;max-width:40em;margin:0 auto;padding:0 14px 40px;color:#111;background:#fff}' +
    'h1{font-size:1.5em;margin:.6em 0 .2em}h2{font-size:1.15em;margin:1.4em 0 .3em;padding-top:.6em;border-top:1px solid #ddd}' +
    'li{margin:.35em 0}table{border-collapse:collapse;width:100%}td{border-top:1px solid #e3e3e3;padding:7px 6px;vertical-align:top}' +
    'code{background:#f1f1f1;padding:2px 5px;border-radius:4px;white-space:nowrap;font-size:.95em}' +
    '.sos{display:block;background:#c4302b;color:#fff;text-align:center;padding:10px;font-weight:700;text-decoration:none;margin:10px 0}' +
    '.note{background:#fff6e0;padding:8px 10px;border-radius:6px}nav{margin:12px 0;font-size:.95em}a{color:#0b57d0}' +
    '@media print{.sos,nav{display:none}}</style></head><body>' +
    `<nav><a href="/">Aegira</a> &middot; <a href="/guide?lang=${lang === 'hi' ? 'en' : 'hi'}">${c.other}</a></nav>` +
    `<a class="sos" href="tel:112">${esc(c.emergency)}</a>` +
    `<h1>${esc(c.title)}</h1><p>${esc(c.intro)}</p>` +
    (opts.demoMode ? `<p class="note">${esc(c.demoNote)}</p>` : '') +
    `<h2>${c.smart}</h2>${list(c.smartSteps)}` +
    `<p><b>${c.install}</b></p><ul>${c.installSteps.map((s) => `<li>${s}</li>`).join('')}</ul>` +
    `<h2>${c.watch}</h2>${list(c.watchSteps)}` +
    `<h2>${c.browser}</h2>${list(c.browserSteps)}` +
    `<h2>${c.basic}</h2>${sms}` +
    `<h2>${c.contact}</h2>${list(c.contactSteps(n))}` +
    `<h2>${c.pins}</h2><p>${esc(c.pinsText)}</p>` +
    `<p class="note">🗣️ ${esc(c.langs)}</p>` +
    demo +
    '</body></html>'
  );
}
