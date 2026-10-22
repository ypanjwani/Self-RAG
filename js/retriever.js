// Simulated Retriever: BM25 ranking over the document's paragraphs.
// (The paper uses a dense retriever, Contriever-MS MARCO. BM25 + a few synonyms behaves similarly here.)
(function () {
  const SR = window.SR;
  const T = SR.text;

  const SYN = {
    tall: ['height', 'high', 'metre'], height: ['tall', 'high'], high: ['tall', 'height'],
    build: ['construct'], construct: ['build'], design: ['engineer', 'sketch'],
    make: ['iron', 'material'], material: ['iron', 'make'], visit: ['tourist'],
    light: ['lamp', 'sparkle', 'bulb'], color: ['paint', 'brown'], paint: ['color'],
    weigh: ['tonne'], night: ['light', 'sunset']
  };

  function parseDoc(raw) {
    const blocks = String(raw).replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return blocks.map((b, i) => {
      const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
      let title, body;
      if (lines.length > 1 && lines[0].length <= 60 && !/[.!?]$/.test(lines[0])) {
        title = lines[0];
        body = lines.slice(1).join(' ');
      } else {
        body = lines.join(' ');
        title = body.split(/\s+/).slice(0, 4).join(' ') + '…';
      }
      return { id: 'd' + (i + 1), idx: i, title, text: body, sentences: T.sentences(body) };
    });
  }

  class Corpus {
    constructor(raw) {
      this.raw = raw;
      this.passages = parseDoc(raw);
      this.N = this.passages.length;
      this.df = new Map();
      let total = 0;
      for (const p of this.passages) {
        p.tok = T.tokens(p.title + ' ' + p.text);
        p.len = p.tok.length || 1;
        p.tf = new Map();
        for (const t of p.tok) p.tf.set(t, (p.tf.get(t) || 0) + 1);
        p.stems = new Set(p.tok);
        p.hasYear = T.hasYear(p.text);
        p.hasNum = T.hasNum(p.text);
        for (const t of p.stems) this.df.set(t, (this.df.get(t) || 0) + 1);
        total += p.len;
      }
      this.avgdl = this.N ? total / this.N : 1;
    }

    idf(term) {
      if (term.startsWith('__')) return 1.5;
      const n = this.df.get(term) || 0;
      return Math.log((this.N - n + 0.5) / (n + 0.5) + 1);
    }

    // weights: Map(term -> weight). Returns every passage with its BM25 score, best first.
    searchWeights(weights) {
      const k1 = 1.5, b = 0.75;
      return this.passages
        .map((p) => {
          let score = 0;
          const hits = [];
          const contribs = []; // per-term breakdown, shown in the Retriever playground
          for (const [term, w] of weights) {
            if (term === '__DATE') {
              if (p.hasYear) { score += w * 1.2; hits.push(term); contribs.push({ term, special: true, w, part: w * 1.2 }); }
              continue;
            }
            if (term === '__NUM') {
              if (p.hasNum) { score += w * 0.8; hits.push(term); contribs.push({ term, special: true, w, part: w * 0.8 }); }
              continue;
            }
            const tf = p.tf.get(term) || 0;
            if (!tf) continue;
            const idf = this.idf(term);
            const norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * p.len) / this.avgdl));
            score += w * idf * norm;
            hits.push(term);
            contribs.push({ term, tf, idf, norm, w, part: w * idf * norm });
          }
          contribs.sort((x, y) => y.part - x.part);
          return { p, score, hits, contribs };
        })
        .sort((a, b2) => b2.score - a.score || a.p.idx - b2.p.idx);
    }

    // Build a weighted query: main terms weigh `weightOf(term)`, synonyms half of that.
    weightsFor(terms, weightOf = () => 1) {
      const w = new Map();
      for (const t of terms) {
        const base = weightOf(t);
        w.set(t, Math.max(w.get(t) || 0, base));
        for (const s of SYN[t] || []) w.set(s, Math.max(w.get(s) || 0, base * 0.5));
      }
      return w;
    }

    search(prompt) {
      return this.searchWeights(this.weightsFor(T.queryTerms(prompt)));
    }
  }

  SR.Corpus = Corpus;
  SR.parseDoc = parseDoc;
})();
