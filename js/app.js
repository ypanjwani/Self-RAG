// Page wiring: document state, nav, hero stream, "why" comparison, token cards, training walkthrough.
(function () {
  const SR = window.SR;
  const T = SR.text, U = SR.ui;
  const $ = (id) => document.getElementById(id);
  const esc = T.esc;

  /* ---------------- shared document ---------------- */
  SR.state = { docRaw: SR.SAMPLE_DOC, corpus: new SR.Corpus(SR.SAMPLE_DOC) };

  function setDoc(raw) {
    SR.state.docRaw = raw;
    SR.state.corpus = new SR.Corpus(raw);
    renderDoc();
    SR.playgrounds.onDoc();
    SR.sim.onDoc();
  }

  function renderDoc() {
    const ps = SR.state.corpus.passages;
    $('docCount').textContent = `${ps.length} passages`;
    $('docGrid').innerHTML = ps.map((p) => `
      <div class="dcard"><div class="dcard-h">${U.docChip(p.id)}<b>${esc(p.title)}</b></div><p>${esc(p.text)}</p></div>`).join('');
  }

  function initDoc() {
    renderDoc();
    $('docEditBtn').onclick = () => { $('docText').value = SR.state.docRaw; $('docEditor').hidden = false; $('docText').focus(); };
    $('docCancelBtn').onclick = () => { $('docEditor').hidden = true; };
    $('docApplyBtn').onclick = () => {
      const raw = $('docText').value.trim();
      if (!raw) return;
      $('docEditor').hidden = true;
      setDoc(raw);
    };
    $('docResetBtn').onclick = () => { $('docEditor').hidden = true; setDoc(SR.SAMPLE_DOC); };
  }

  /* ---------------- nav: active link + reading bar ---------------- */
  function initNav() {
    const links = [...document.querySelectorAll('.navlinks a')];
    const secs = links.map((a) => document.querySelector(a.getAttribute('href')));
    const onScroll = () => {
      const h = document.documentElement;
      $('readBar').style.width = (100 * h.scrollTop) / Math.max(1, h.scrollHeight - h.clientHeight) + '%';
      let cur = -1;
      secs.forEach((s, i) => { if (s && s.getBoundingClientRect().top < window.innerHeight * 0.35) cur = i; });
      links.forEach((a, i) => a.classList.toggle('on', i === cur));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- reveal on scroll ---------------- */
  function initReveal() {
    const els = document.querySelectorAll('.sec .prose, .rag-flow, .rag-probs, .why-grid, .token-grid, .anatomy, .model-cards, .train-grid, .takeaway');
    if (!('IntersectionObserver' in window)) return;
    els.forEach((e) => e.classList.add('reveal'));
    const io = new IntersectionObserver((ents) => ents.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }), { threshold: 0.12 });
    els.forEach((e) => io.observe(e));
  }

  /* ---------------- typing helper ---------------- */
  // Plays a list of pieces into `el`: {text} types word by word, {html} pops in.
  function typeInto(el, pieces, opt = {}) {
    const id = (el._tid = (el._tid || 0) + 1);
    el.innerHTML = '';
    const fast = U.reducedMotion();
    const caret = document.createElement('span');
    caret.className = 'caret';
    el.appendChild(caret);
    let i = 0, w = 0, span = null;
    function next() {
      if (el._tid !== id) return;
      if (i >= pieces.length) { caret.remove(); opt.done && opt.done(); return; }
      const p = pieces[i];
      if (p.text != null) {
        const words = p.text.split(' ');
        if (w === 0) { span = document.createElement('span'); el.insertBefore(document.createTextNode(' '), caret); el.insertBefore(span, caret); }
        span.textContent += (w ? ' ' : '') + words[w];
        w++;
        if (w >= words.length) { w = 0; i++; }
        setTimeout(next, fast ? 0 : opt.wordMs || 70);
      } else {
        const tmp = document.createElement('span');
        tmp.innerHTML = ' ' + p.html + ' ';
        if (tmp.firstElementChild) tmp.firstElementChild.classList.add('pop');
        el.insertBefore(tmp, caret);
        i++;
        setTimeout(next, fast ? 0 : p.wait || 450);
      }
    }
    next();
  }

  /* ---------------- hero ---------------- */
  function initHero() {
    const pieces = [
      { html: U.chip('Retrieve', 'Yes'), wait: 600 },
      { html: `<span class="psg">${U.docChip('d2')} The tower is named after Gustave Eiffel, whose engineering company designed and built it…</span>`, wait: 700 },
      { html: U.chip('ISREL', 'Relevant'), wait: 500 },
      { text: 'It was designed by the engineering company of Gustave Eiffel.' },
      { html: U.chip('ISSUP', 'Fully'), wait: 450 },
      { html: U.chip('ISUSE', '5'), wait: 400 }
    ];
    const el = $('heroStream');
    const loop = () => typeInto(el, pieces, { wordMs: 90, done: () => setTimeout(loop, 4000) });
    loop();
  }

  /* ---------------- why: three approaches ---------------- */
  const WHY = {
    fact: {
      q: 'How tall is the Eiffel Tower?',
      cols: [
        {
          cls: 'bad', name: 'Plain LLM', tag: 'guesses',
          steps: ['Answers from memory only'],
          out: 'The Eiffel Tower is about <span class="wrong">300 metres</span> tall and opened in <span class="wrong">1901</span>.',
          verdict: 'Sounds confident, but it is <b>making things up</b>. Nothing to check against.'
        },
        {
          cls: 'bad', name: 'Standard RAG', tag: 'blind',
          steps: [`Always retrieves top-2: ${U.docChip('d3')} ${U.docChip('d11')}`],
          out: 'The Eiffel Tower is about 330 metres tall. <span class="odd">Paris is famous for its cafés, where people sit outside for hours.</span>',
          verdict: 'Used an <b>off-topic passage</b> and never noticed.'
        },
        {
          cls: 'ok self', name: 'Self-RAG', tag: 'reflects',
          steps: [`${U.chip('Retrieve', 'Yes')}`, `${U.docChip('d3')} ${U.chip('ISREL', 'Relevant')} · ${U.docChip('d11')} ${U.chip('ISREL', 'Irrelevant')}`],
          out: `The Eiffel Tower is about 330 metres tall. ${U.chip('ISSUP', 'Fully')} ${U.chip('ISUSE', '5')}`,
          verdict: 'Retrieved, <b>ignored the off-topic passage</b>, and checked its answer.'
        }
      ]
    },
    creative: {
      q: 'Write a short birthday message for my best friend.',
      cols: [
        {
          cls: 'ok', name: 'Plain LLM', tag: 'fine',
          steps: ['Answers from memory only'],
          out: 'Happy birthday! Thanks for every laugh and every late-night talk. Here’s to another year of adventures together.',
          verdict: 'Fine here, because a birthday message needs no facts.'
        },
        {
          cls: 'bad', name: 'Standard RAG', tag: 'forced',
          steps: [`Always retrieves top-2: ${U.docChip('d13')} ${U.docChip('d11')}`],
          out: 'Happy birthday! Thanks for every laugh. <span class="odd">Did you know France makes more than 1,000 kinds of cheese?</span> <span class="odd">Let’s sit in a Paris café for hours.</span>',
          verdict: 'The document has nothing about birthdays, but retrieval <b>still pasted in two passages</b>, and their facts leaked into the message.'
        },
        {
          cls: 'ok self', name: 'Self-RAG', tag: 'reflects',
          steps: [`${U.chip('Retrieve', 'No')} · no lookup needed`],
          out: `Happy birthday! Thanks for every laugh and every late-night talk. Here’s to another year of adventures together. ${U.chip('ISUSE', '5')}`,
          verdict: 'Knew it <b>did not need to look anything up</b>.'
        }
      ]
    }
  };

  function renderWhy(key) {
    const d = WHY[key];
    $('whyQ').innerHTML = `Everyone gets the same request: <b>“${esc(d.q)}”</b>`;
    $('whyGrid').innerHTML = d.cols.map((c, i) => `
      <div class="why-col card ${c.cls} fade-in" style="animation-delay:${i * 120}ms">
        <h3>${c.name} <span class="why-tag">${c.tag}</span></h3>
        <div class="why-steps">${c.steps.map((s) => `<div class="st">${s}</div>`).join('')}</div>
        <div class="why-out">${c.out}</div>
        <p class="why-verdict">${c.verdict}</p>
      </div>`).join('');
  }

  // Hover or tap a problem card (or a numbered marker) to light up its spot in the pipeline.
  function initRagFlow() {
    const items = document.querySelectorAll('#ragFlow [data-p], #ragProbs [data-p]');
    const light = (p) => items.forEach((el) => el.classList.toggle('lit', el.dataset.p === p));
    items.forEach((el) => {
      el.addEventListener('mouseenter', () => light(el.dataset.p));
      el.addEventListener('mouseleave', () => light(null));
      el.addEventListener('click', () => light(el.dataset.p));
    });
  }

  function initWhy() {
    initRagFlow();
    document.querySelectorAll('#whyTabs .tab').forEach((t) => (t.onclick = () => {
      document.querySelectorAll('#whyTabs .tab').forEach((x) => x.classList.toggle('on', x === t));
      renderWhy(t.dataset.q);
    }));
    renderWhy('fact');
  }

  /* ---------------- token cards + anatomy ---------------- */
  const TOKENS = [
    {
      type: 'Retrieve', cls: 't-ret', q: 'Should I look something up?', vals: ['Yes', 'No', 'Continue'],
      when: 'Decided again before every segment, not just once at the start.',
      ex: `<span class="q">“Who designed the Eiffel Tower?”</span>→ ${U.chip('Retrieve', 'Yes')}<span class="q">“Write a birthday message for my friend.”</span>→ ${U.chip('Retrieve', 'No')}<br><span class="small muted"><b>Continue</b> = keep using the passage already fetched.</span>`
    },
    {
      type: 'ISREL', cls: 't-rel', q: 'Is this passage relevant?', vals: ['Relevant', 'Irrelevant'],
      when: 'Written right after reading a retrieved passage.',
      ex: `<span class="q">Q: How tall is the tower?<br>Passage: “France makes 1,000 kinds of cheese.”</span>→ ${U.chip('ISREL', 'Irrelevant')}`
    },
    {
      type: 'ISSUP', cls: 't-sup', q: 'Does the passage back up what I wrote?', vals: ['Fully', 'Partially', 'No support'],
      when: 'Written after each segment that used a passage.',
      ex: `<span class="q">Passage: “…about 330 metres tall…”<br>Model wrote: “It is 300 metres tall.”</span>→ ${U.chip('ISSUP', 'Partially')}`
    },
    {
      type: 'ISUSE', cls: 't-use', q: 'Is my answer useful?', vals: ['5', '4', '3', '2', '1'],
      when: 'A 1–5 rating of how well it answers the question.',
      ex: `<span class="q">Q: How tall is the tower?<br>A: “Paris has lovely cafés.”</span>→ ${U.chip('ISUSE', '1')}`
    }
  ];

  function initTokens() {
    $('tokenGrid').innerHTML = TOKENS.map((t) => `
      <button class="flip" aria-label="${t.type} token card. Click to flip.">
        <div class="flip-in">
          <div class="face front ${t.cls}">
            <div class="tk-bar"></div>
            <div class="tk-name">${t.type}</div>
            <div class="tk-q">${t.q}</div>
            <div class="tk-when">${t.when}</div>
            <div class="tk-vals">${t.vals.map((v) => U.chip(t.type, v)).join('')}</div>
            <div class="tk-flip">Click for an example ↻</div>
          </div>
          <div class="face back ${t.cls}">
            <div class="tk-name">${t.type} · example</div>
            <div class="tk-ex">${t.ex}</div>
            <div class="tk-flip" style="margin-top:auto">Click to flip back ↻</div>
          </div>
        </div>
      </button>`).join('');
    document.querySelectorAll('#tokenGrid .flip').forEach((f) => (f.onclick = () => f.classList.toggle('on')));

    const WHY_T = [
      {
        type: 'Retrieve', v: 'Yes',
        without: 'Ordinary RAG retrieves for <b>every</b> request, even poems or small talk. That wastes time and pushes off-topic facts into the answer.',
        with: 'The model retrieves <b>only when a fact is needed</b>. Because it decides again before every segment, retrieval can even start <b>halfway through</b> an answer.'
      },
      {
        type: 'ISREL', v: 'Relevant',
        without: 'A retriever <b>always</b> returns K passages, including bad ones, and the model trusts whatever it gets.',
        with: 'Each passage is <b>checked first</b>. Off-topic ones (like the cheese passage for a question about the tower) are flagged and lose in ranking.'
      },
      {
        type: 'ISSUP', v: 'Fully',
        without: 'The model can write claims the passage <b>never says</b>, mixing in guesses from memory. It looks cited, but it\'s a hallucination.',
        with: 'Segments the passage <b>backs up</b> are preferred, so every claim can be traced to its source and checked.'
      },
      {
        type: 'ISUSE', v: '5',
        without: 'An answer can be true and well supported but still <b>not answer the question</b> that was asked.',
        with: 'Segments that <b>actually help the user</b> score higher, so a true but beside-the-point segment loses.'
      }
    ];
    $('whyTokens').innerHTML = WHY_T.map((w) => `
      <div class="whyt-row">
        <div class="whyt-tok">${U.chip(w.type, w.v)}</div>
        <div class="whyt-col whyt-bad"><span class="whyt-k">Without it</span><p>${w.without}</p></div>
        <div class="whyt-arrow">→</div>
        <div class="whyt-col whyt-good"><span class="whyt-k">With it</span><p>${w.with}</p></div>
      </div>`).join('');

    const piece = (cap, html) => `<span class="piece"><span class="cap">${cap}</span>${html}</span>`;
    $('anatomy').innerHTML = [
      piece('1 · decide', U.chip('Retrieve', 'Yes')),
      piece('2 · passage', U.docChip('d3')),
      piece('3 · judge passage', U.chip('ISREL', 'Relevant')),
      piece('4 · write', '<span class="txt">The tower is about 330 metres tall.</span>'),
      piece('5 · judge text', U.chip('ISSUP', 'Fully')),
      piece('6 · rate', U.chip('ISUSE', '5'))
    ].join('<span class="sep">→</span>');
  }

  /* ---------------- training walkthrough ---------------- */
  function initTraining() {
    $('augDemo').innerHTML = `<span class="mini-q">Q: How tall is it?</span> ${U.chip('Retrieve', 'Yes')} ${U.docChip('d3')} ${U.chip('ISREL', 'Relevant')} <span>It is 330 m tall.</span> ${U.chip('ISSUP', 'Fully')} ${U.chip('ISUSE', '5')}`;
    let timer = null;
    $('trainPlay').onclick = () => {
      const grid = $('trainGrid');
      const steps = [...grid.querySelectorAll('.tstep')];
      clearTimeout(timer);
      grid.classList.add('playing');
      let k = 0;
      const go = () => {
        steps.forEach((s, i) => s.classList.toggle('lit', i === k));
        k++;
        if (k <= steps.length) timer = setTimeout(go, U.reducedMotion() ? 600 : 2200);
        else { grid.classList.remove('playing'); steps.forEach((s) => s.classList.remove('lit')); $('trainPlay').textContent = '↻ Play again'; }
      };
      $('trainPlay').textContent = 'Playing…';
      go();
    };
  }

  /* ---------------- boot ---------------- */
  document.addEventListener('DOMContentLoaded', () => {
    initNav();
    initHero();
    initWhy();
    initTokens();
    initDoc();
    SR.playgrounds.init();
    SR.sim.init();
    initTraining();
    initReveal();
  });
})();
