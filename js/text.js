// Small text toolkit shared by the simulated Retriever, Critic and Generator.
(function () {
  const SR = (window.SR = window.SR || {});

  const STOP = new Set(
    `a an the and or but if of to in on at by for with from as is are was were be been being it its this that
     these those there here what which who whom whose when where why how do does did done can could would should
     will shall may might must i me my we our us you your he she they them their his her him not no yes so than
     then too very just also about into over under up down out more most some any each every all both few such
     only own same other s t now ever tell please give explain describe list write show know want like let get got
     one two three per around after before during since until while because through between again further once am
     has have had having whats much many really kind sort`.split(/\s+/)
  );

  // Tiny lemma table so "built" matches "build", "taller" matches "tall", etc.
  const LEMMA = {
    built: 'build', building: 'build', builds: 'build', made: 'make', making: 'make', makes: 'make',
    designed: 'design', designer: 'design', designers: 'design', designing: 'design', designs: 'design',
    tallest: 'tall', taller: 'tall', higher: 'high', highest: 'high', heights: 'height',
    changes: 'change', changed: 'change', changing: 'change', visitors: 'visit', visitor: 'visit',
    visited: 'visit', visits: 'visit', visiting: 'visit', lit: 'light', lights: 'light', lighting: 'light',
    lamps: 'lamp', painted: 'paint', repainted: 'paint', repaint: 'paint', paints: 'paint', painting: 'paint',
    weighs: 'weigh', weight: 'weigh', weighed: 'weigh', constructed: 'construct', construction: 'construct',
    engineers: 'engineer', engineering: 'engineer', metres: 'metre', meters: 'metre', meter: 'metre',
    centimetres: 'centimetre', tonnes: 'tonne', tons: 'tonne', ton: 'tonne', years: 'year', cafes: 'cafe',
    colour: 'color', colours: 'color', colors: 'color', sparkles: 'sparkle', sparkling: 'sparkle',
    expands: 'expand', expanded: 'expand', grows: 'grow', growing: 'grow', grew: 'grow', saved: 'save',
    rivets: 'rivet', parts: 'part', tourists: 'tourist', critics: 'critic', criticised: 'critic',
    criticized: 'critic', poems: 'poem', nights: 'night', antennas: 'antenna', lamp: 'lamp'
  };

  function fold(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function stem(w) {
    if (LEMMA[w]) return LEMMA[w];
    let s = w;
    if (s.length > 6 && s.endsWith('ing')) s = s.slice(0, -3);
    else if (s.length > 5 && s.endsWith('ed')) s = s.slice(0, -2);
    else if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
    else if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
    return LEMMA[s] || s;
  }

  const WORD_RE = /[a-z0-9]+(?:[-'’][a-z0-9]+)*/g;

  function words(text) {
    return (fold(text).match(WORD_RE) || []).map((w) => w.replace(/['’]s$/, ''));
  }

  // Content-word stems (no stopwords, no numbers).
  function tokens(text) {
    return words(text)
      .filter((w) => !STOP.has(w) && !/^\d/.test(w))
      .map(stem);
  }

  function numbers(text) {
    return (String(text).match(/\d[\d,]*(?:\.\d+)?/g) || [])
      .map((n) => n.replace(/,/g, '').replace(/\.$/, ''))
      .filter(Boolean);
  }

  const hasYear = (t) => /\b(1[0-9]{3}|20[0-9]{2})\b/.test(t);
  const hasNum = (t) => /\d/.test(t);

  function sentences(text) {
    return String(text)
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?]["”’]?)\s+(?=["“A-ZÀ-Ý0-9])/)
      .filter(Boolean);
  }

  // Question-type "pseudo terms": a "when" question needs a date, a "how tall" question needs a number.
  function specials(prompt) {
    const f = fold(prompt);
    const s = [];
    if (/\bwhen\b|\bwhat year\b|\bwhich year\b|\bwhat date\b/.test(f)) s.push('__DATE');
    if (/\bhow (tall|high|many|much|long|big|heavy|old|far|large|wide|deep|often)\b/.test(f)) s.push('__NUM');
    return s;
  }

  function queryTerms(prompt) {
    return [...new Set(tokens(prompt))].concat(specials(prompt));
  }

  function matchesTerm(term, stemSet, rawText) {
    if (term === '__DATE') return hasYear(rawText);
    if (term === '__NUM') return hasNum(rawText);
    return stemSet.has(term);
  }

  function termLabel(t) {
    return t === '__DATE' ? 'a date' : t === '__NUM' ? 'a number' : t;
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Escape `text`, wrapping each word in <mark class=X> when classify(stem, raw, isNumber) returns X.
  function markWords(text, classify) {
    text = String(text);
    const re = /[A-Za-zÀ-ÿ0-9]+(?:[-'’,.][A-Za-zÀ-ÿ0-9]+)*/g;
    let out = '';
    let last = 0;
    for (const m of text.matchAll(re)) {
      out += esc(text.slice(last, m.index));
      const raw = m[0];
      let cls = null;
      if (/^\d/.test(raw)) cls = classify(null, raw, true);
      else {
        const w = fold(raw).replace(/['’]s$/, '');
        if (!STOP.has(w)) cls = classify(stem(w), raw, false);
      }
      out += cls ? `<mark class="${cls}">${esc(raw)}</mark>` : esc(raw);
      last = m.index + raw.length;
    }
    return out + esc(text.slice(last));
  }

  // Mark words whose stem is in `set`. Digits are marked when the set asks for numbers/dates.
  function highlight(text, set, cls = 'hl') {
    return markWords(text, (s, raw, isNum) => {
      if (isNum) return set.has('__NUM') || (set.has('__DATE') && /^(1[0-9]{3}|20[0-9]{2})$/.test(raw)) ? cls : null;
      return set.has(s) ? cls : null;
    });
  }

  // Stable pseudo-random number in [0, 1) from a string.
  function hash01(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return ((h >>> 0) % 10000) / 10000;
  }

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  SR.text = {
    STOP, fold, stem, words, tokens, numbers, hasYear, hasNum, sentences, specials, queryTerms,
    matchesTerm, termLabel, esc, markWords, highlight, hash01, clamp
  };
})();
