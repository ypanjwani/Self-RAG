// Simulated Critic: predicts the four reflection tokens with simple, explainable rules.
// Each prediction returns a probability for every possible value, like a real classifier head.
(function () {
  const SR = window.SR;
  const T = SR.text;
  const sig = (x) => 1 / (1 + Math.exp(-x));

  // Turn a 0..1 score into probabilities over labels placed at "centers" (soft nearest-center).
  function softCenters(x, centers, labels, v) {
    const logits = centers.map((c) => -((x - c) ** 2) / v);
    const m = Math.max(...logits);
    const ex = logits.map((l) => Math.exp(l - m));
    const z = ex.reduce((a, b) => a + b, 0);
    const probs = {};
    labels.forEach((l, i) => (probs[l] = ex[i] / z));
    return probs;
  }

  function top(probs) {
    let best = null;
    for (const k in probs) if (!best || probs[k] > probs[best]) best = k;
    return [best, probs[best]];
  }

  const corpusNow = () => SR.state && SR.state.corpus;
  const idfOf = (t, corpus) => (corpus ? corpus.idf(t) : t.startsWith('__') ? 1.5 : 2);

  // ---------- Retrieve: does this input need outside facts? ----------
  const FACT_RE = /\b(who|when|where|which|what|why|how|year|date|tall|height|fact|facts|history|explain|list|define|compare|tell me)\b/g;
  const CREATIVE_RE = /\b(write|poem|poetry|haiku|story|song|lyrics|imagine|joke|limerick|creative|compose|rhyme|fiction|fairy tale)\b/g;

  function retrieve(prompt, threshold = 0.5) {
    const f = T.fold(prompt);
    const factual = [...new Set(f.match(FACT_RE) || [])];
    const creative = [...new Set(f.match(CREATIVE_RE) || [])];
    const entity = [...new Set((String(prompt).match(/(?<=\S\s+)[A-Z][a-zà-ÿ]+/g) || []))];
    const nWords = T.tokens(prompt).length;
    const logit =
      0.2 + 1.2 * Math.min(factual.length, 3) - 2.2 * Math.min(creative.length, 2) +
      0.6 * Math.min(entity.length, 2) - (nWords < 2 ? 1.5 : 0);
    const p = sig(logit);
    const probs = { Yes: p, No: 1 - p };
    return { probs, p, token: p >= threshold ? 'Yes' : 'No', factual, creative, entity };
  }

  // ---------- ISREL: is the passage relevant to the input? ----------
  function isrel(prompt, passageText, corpus = corpusNow()) {
    const q = T.queryTerms(prompt);
    const st = new Set(T.tokens(passageText));
    let tot = 0, hit = 0;
    const evidence = [];
    for (const t of q) {
      const w = idfOf(t, corpus);
      tot += w;
      if (T.matchesTerm(t, st, passageText)) { hit += w; evidence.push(t); }
    }
    const cov = tot ? hit / tot : 0;
    // A single shared keyword is weak evidence: "makes cheese" is not about "what is the tower made of".
    const content = q.filter((t) => !t.startsWith('__'));
    const contentHits = evidence.filter((t) => !t.startsWith('__')).length;
    const enough = contentHits >= Math.min(2, content.length || 1);
    const pr = sig(12 * (cov - 0.3)) * (enough ? 1 : 0.35);
    const probs = { Relevant: pr, Irrelevant: 1 - pr };
    const [token, conf] = top(probs);
    return { probs, token, conf, s: pr, cov, evidence, missing: q.filter((t) => !evidence.includes(t)) };
  }

  // ---------- ISSUP: is the written segment supported by the passage? ----------
  function issup(segment, passageText) {
    const segT = [...new Set(T.tokens(segment))];
    const st = new Set(T.tokens(passageText));
    const found = segT.filter((t) => st.has(t));
    const missing = segT.filter((t) => !st.has(t));
    let f = segT.length ? found.length / segT.length : 0;
    const pn = new Set(T.numbers(passageText));
    const badNums = T.numbers(segment).filter((n) => !pn.has(n));
    if (badNums.length) f -= 0.35;
    f = T.clamp(f, 0, 1);
    const probs = softCenters(f, [0.92, 0.55, 0.12], ['Fully', 'Partially', 'No support'], 0.03);
    const [token, conf] = top(probs);
    return { probs, token, conf, s: probs.Fully + 0.5 * probs.Partially, f, found, missing, badNums };
  }

  // ---------- ISUSE: how useful is the segment for the input? (5 = best) ----------
  const USE_LABELS = ['5', '4', '3', '2', '1'];
  const USE_W = { 5: 1, 4: 0.5, 3: 0, 2: -0.5, 1: -1 };

  function isuseFromU(u) {
    const probs = softCenters(T.clamp(u, 0, 1), [1, 0.75, 0.5, 0.25, 0], USE_LABELS, 0.02);
    const [token, conf] = top(probs);
    let s = 0;
    for (const k in probs) s += probs[k] * USE_W[k];
    return { probs, token, conf, s: (s + 1) / 2, u };
  }

  function isuse(prompt, segment, covered = new Set(), corpus = corpusNow()) {
    const q = T.queryTerms(prompt);
    if (!q.length) {
      const r = isuseFromU(T.words(segment).length > 6 ? 0.7 : 0.45);
      r.evidence = [];
      return r;
    }
    const st = new Set(T.tokens(segment));
    let tot = 0, hit = 0, utot = 0, uhit = 0;
    const evidence = [];
    for (const t of q) {
      const w = idfOf(t, corpus);
      const m = T.matchesTerm(t, st, segment);
      tot += w;
      if (m) { hit += w; evidence.push(t); }
      if (!covered.has(t)) { utot += w; if (m) uhit += w; }
    }
    const covAll = tot ? hit / tot : 0;
    const newCov = utot ? uhit / utot : covAll;
    const u = 0.35 * covAll + 0.65 * newCov;
    const r = isuseFromU(u);
    r.evidence = evidence;
    r.covAll = covAll;
    r.newCov = newCov;
    return r;
  }

  SR.critic = { retrieve, isrel, issup, isuse, isuseFromU, top, USE_W };
})();
