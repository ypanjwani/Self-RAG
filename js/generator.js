// Simulated Generator + the Self-RAG inference loop.
// For every segment: decide Retrieve -> fetch K passages -> write K candidates in parallel ->
// critique each -> score -> keep the best -> append -> repeat.
(function () {
  const SR = window.SR;
  const T = SR.text;
  const C = SR.critic;

  // What the model "remembers" without looking anything up. Some of it is slightly wrong on purpose:
  // that's the hallucination risk retrieval protects against.
  const MEMORY = [
    { keys: ['build', '__DATE', 'construct', 'finish'], text: 'The Eiffel Tower was finished around 1890 for a big exhibition.' },
    { keys: ['design', 'engineer'], text: 'I believe it was designed entirely by Gustave Eiffel himself.' },
    { keys: ['tall', 'height', 'high', '__NUM'], text: 'The Eiffel Tower is roughly 300 metres tall.' },
    { keys: ['make', 'material', 'iron', 'steel'], text: 'I think it is made mostly of steel.' },
    { keys: ['visit', 'tourist', 'people'], text: 'Millions of tourists visit it every year.' },
    { keys: ['paint', 'color', 'brown'], text: 'It is usually painted a dark bronze colour.' },
    { keys: ['light', 'night', 'sparkle'], text: 'At night the tower is lit up with bright lights.' }
  ];
  const MEMORY_DEFAULT = "I'm not completely sure about this part, so this is my best guess from memory.";

  function memorySentence(q, uncovered) {
    let best = null, bestScore = 0;
    for (const m of MEMORY) {
      const sc = 3 * m.keys.filter((k) => uncovered.includes(k)).length + m.keys.filter((k) => q.includes(k)).length;
      if (sc > bestScore) { best = m; bestScore = sc; }
    }
    return best ? best.text : MEMORY_DEFAULT;
  }

  function creativeLines(prompt) {
    if (/\b(intro|introduce|introduction|welcome)\b/i.test(prompt)) {
      if (/paris/i.test(prompt)) {
        return ['Paris is a city of art, food and long walks by the river, and every tourist finds a favourite corner.'];
      }
      const m = String(prompt).match(/(?:about|to|of) (.+?)(?: for .+)?[.?!]*$/i);
      const topic = m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : 'This place';
      return [`${topic} has a character all its own, and it is well worth getting to know.`];
    }
    if (/birthday/i.test(prompt)) {
      return [
        'Happy birthday!',
        'Thanks for every laugh and every late-night talk.',
        'Here’s to another year of adventures together.'
      ];
    }
    if (/paris/i.test(prompt)) {
      return [
        'The Seine keeps the lamplight like a secret,',
        'the iron tower glitters on the hour,',
        'and the cafés hum softly while the city dreams.'
      ];
    }
    const m = String(prompt).match(/about (.+?)[.?!]*$/i);
    let topic = m ? m[1] : 'the quiet night';
    topic = topic.charAt(0).toUpperCase() + topic.slice(1);
    return [
      `${topic}, a small spark in the evening air,`,
      'every corner holding a story, every light a prayer,',
      'and the whole world slows down to linger there.'
    ];
  }

  // Write one candidate segment while "reading" one passage.
  function writeFromPassage(passage, ctx) {
    const { q, covered, used, corpus } = ctx;
    let best = null;
    passage.sentences.forEach((s, i) => {
      if (used.has(s)) return;
      const st = new Set(T.tokens(s));
      let gain = 0, base = 0;
      for (const t of q) {
        if (!T.matchesTerm(t, st, s)) continue;
        const w = corpus.idf(t);
        if (covered.has(t)) base += 0.5 * w; else gain += 2 * w;
      }
      const total = gain + base;
      if (!best || total > best.total) best = { i, s, gain, total };
    });
    if (best && best.gain > 0) {
      let text = best.s;
      const usedSentences = [best.s];
      // A sentence starting with "It/Its/This..." needs the previous one for context.
      if (/^(It|Its|This|They|These|He|She|His|Her|Their)\b/.test(text) && best.i > 0) {
        text = passage.sentences[best.i - 1] + ' ' + text;
        usedSentences.unshift(passage.sentences[best.i - 1]);
      }
      const ts = new Set(T.tokens(text));
      const fit = q.reduce((a, t) => a + (T.matchesTerm(t, ts, text) ? corpus.idf(t) : 0), 0);
      return { text, source: 'passage', gain: best.gain, fit, usedSentences };
    }
    const uncovered = q.filter((t) => !covered.has(t));
    return { text: memorySentence(q, uncovered), source: 'memory', gain: 0, usedSentences: [] };
  }

  function weightOf(terms, corpus) {
    return terms.reduce((a, t) => a + corpus.idf(t), 0);
  }

  // p(segment | input, passage): a stand-in for the language model's own confidence.
  function fluency(text, source, fitFrac) {
    const j = (T.hash01(text) - 0.5) * 0.04;
    if (source === 'creative') return T.clamp(0.8 + j, 0.2, 0.95);
    if (source === 'memory') return T.clamp(0.34 + j, 0.2, 0.95);
    return T.clamp(0.45 + 0.4 * Math.min(1, fitFrac) + j, 0.2, 0.95);
  }

  // "Write an intro to Paris, then tell me how tall the tower is" -> two parts, handled in order.
  function splitParts(prompt) {
    const parts = String(prompt)
      .split(/\s*,?\s*(?:\band then\b|\bthen\b|;)\s*/i)
      .map((s) => s.trim().replace(/^[,.\s]+|[,.\s]+$/g, ''))
      .filter((s) => T.tokens(s).length);
    return parts.length > 1 ? parts : [prompt];
  }

  function cueReason(dec) {
    const bits = [];
    if (dec.factual.length) bits.push(`fact-seeking words (${dec.factual.join(', ')})`);
    if (dec.entity.length) bits.push(`named things (${dec.entity.slice(0, 3).join(', ')})`);
    if (dec.creative.length) bits.push(`creative words (${dec.creative.join(', ')})`);
    return bits.length ? 'It noticed ' + bits.join(' and ') + '.' : 'No strong clues either way.';
  }

  function buildRun(prompt, corpus, settings) {
    const st = Object.assign({ K: 3, threshold: 0.5, wRel: 1, wSup: 1, wUse: 0.5, maxSeg: 4 }, settings);
    const parts = splitParts(prompt);
    const multi = parts.length > 1;
    const used = new Set();
    const loops = [];
    const partUse = [];

    parts.forEach((part, pi) => {
      const q = T.queryTerms(part);
      const qW = weightOf(q, corpus) || 1;
      const dec0 = C.retrieve(part, st.threshold);
      const covered = new Set();
      let poem = null, poemIdx = 0;
      const partLoops = [];

      for (let k = 0; k < st.maxSeg; k++) {
        const t = loops.length;
        const uncovered = q.filter((x) => !covered.has(x));
        let p, reason;
        if (k === 0) {
          p = dec0.p;
          reason = (multi && pi > 0 ? `Next part: “${part}”. ` : multi ? `First part: “${part}”. ` : '') + cueReason(dec0);
        } else if (poem) {
          p = 0.06 + T.hash01(prompt + t) * 0.06;
          reason = 'Still writing a creative piece. No facts needed.';
        } else {
          const uf = weightOf(uncovered, corpus) / qW;
          p = uncovered.length ? T.clamp(0.58 + 0.4 * uf, 0.05, 0.97) : 0.12;
          reason = uncovered.length ? `Still missing: ${uncovered.map(T.termLabel).join(', ')}.` : 'This part looks answered.';
        }
        const doRet = p >= st.threshold;
        if (k === 0 && !doRet && dec0.creative.length) poem = creativeLines(part);

        const loop = { t, p, doRet, reason, part: pi, partText: part, firstOfPart: k === 0, lanes: [], order: [], winner: 0 };

        if (doRet) {
          const weights = corpus.weightsFor(q, (x) => (covered.has(x) ? 0.6 : 2));
          const ranked = corpus.searchWeights(weights).slice(0, Math.min(st.K, corpus.N));
          ranked.forEach((r, rank) => {
            const g = writeFromPassage(r.p, { q, covered, used, corpus });
            const rel = C.isrel(part, r.p.title + ' ' + r.p.text, corpus);
            const sup = C.issup(g.text, r.p.text);
            const use = C.isuse(part, g.text, covered, corpus);
            const py = fluency(g.text + r.p.id, g.source, (g.fit || 0) / qW);
            const sc = { py, rel: st.wRel * rel.s, sup: st.wSup * sup.s, use: st.wUse * use.s };
            loop.lanes.push({
              passage: r.p, bm25: r.score, rank, text: g.text, source: g.source, usedSentences: g.usedSentences,
              rel, sup, use, py, parts: sc, score: sc.py + sc.rel + sc.sup + sc.use
            });
          });
        } else {
          let text, source, use;
          if (poem) {
            if (poemIdx >= poem.length) break;
            text = poem[poemIdx++];
            source = 'creative';
            use = C.isuseFromU(0.9);
          } else {
            text = memorySentence(q, uncovered);
            source = 'memory';
            use = C.isuse(part, text, covered, corpus);
          }
          const py = fluency(text, source, 0);
          const sc = { py, rel: 0, sup: 0, use: st.wUse * use.s };
          loop.lanes.push({ passage: null, rank: 0, text, source, usedSentences: [], use, py, parts: sc, score: py + sc.use });
        }

        if (!loop.lanes.length) break;
        loop.order = loop.lanes.map((_, i) => i).sort((a, b) => loop.lanes[b].score - loop.lanes[a].score);
        loop.winner = loop.order[0];
        const win = loop.lanes[loop.winner];

        const before = covered.size;
        const ws = new Set(T.tokens(win.text));
        for (const x of q) if (T.matchesTerm(x, ws, win.text)) covered.add(x);
        win.usedSentences.forEach((s) => used.add(s));
        loops.push(loop);
        partLoops.push(loop);

        if (poem) {
          if (poemIdx >= poem.length) break;
        } else {
          if (!q.filter((x) => !covered.has(x)).length) break;
          if (covered.size === before) break;
        }
      }

      const partText = partLoops.map((L) => L.lanes[L.winner].text).join(' ');
      partUse.push(poem ? 0.92 : C.isuse(part, partText, new Set(), corpus).u);
    });

    const answerText = loops.map((L) => L.lanes[L.winner].text).join(' ');
    const final = C.isuseFromU(partUse.length ? partUse.reduce((a, b) => a + b, 0) / partUse.length : 0.5);
    const switched = loops.some((L, i) => i > 0 && L.doRet && !loops[i - 1].doRet);
    return { prompt, parts, loops, answerText, final, settings: st, switched };
  }

  SR.generator = { buildRun, splitParts, writeFromPassage, memorySentence, creativeLines };
})();
