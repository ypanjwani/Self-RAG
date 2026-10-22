// Hands-on playgrounds for the three models: Retriever, Critic, Generator.
(function () {
  const SR = window.SR;
  const T = SR.text, C = SR.critic, G = SR.generator, U = SR.ui;
  const $ = (id) => document.getElementById(id);
  const corpus = () => SR.state.corpus;
  const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function exampleButtons(el, list, onPick) {
    el.innerHTML = '<span class="small muted" style="align-self:center">Try:</span>' +
      list.map((x, i) => `<button class="ex" data-i="${i}">${T.esc(x.label || x)}</button>`).join('');
    el.onclick = (e) => {
      const b = e.target.closest('.ex');
      if (b) onPick(list[+b.dataset.i]);
    };
  }

  /* ================= Retriever ================= */
  const RET_EX = ['Who designed the Eiffel Tower?', 'How tall is the tower?', 'Why is the tower painted brown?', 'Where can I drink coffee in Paris?'];

  let retSel = null; // passage id whose score breakdown is shown

  function renderExplain(res, q) {
    const r = res.find((x) => x.p.id === retSel) || res[0];
    if (!r) { $('retExplain').innerHTML = ''; return; }
    const base = new Set(T.queryTerms(q));
    const rank = res.indexOf(r) + 1;
    const rows = r.contribs.map((c) => {
      const name = c.special ? (c.term === '__DATE' ? 'contains a date' : 'contains a number') : c.term;
      const syn = !c.special && !base.has(c.term) ? ' <span class="syn">(synonym, ½ weight)</span>' : '';
      return c.special
        ? `<tr><td>${name} <span class="syn">(question bonus)</span></td><td class="num">–</td><td class="num">–</td><td class="num">–</td><td class="num">+${c.part.toFixed(2)}</td></tr>`
        : `<tr><td>${T.esc(name)}${syn}</td><td class="num">${c.tf}</td><td class="num">${c.idf.toFixed(2)}</td><td class="num">${c.norm.toFixed(2)}${c.w !== 1 ? ' × ' + c.w : ''}</td><td class="num">+${c.part.toFixed(2)}</td></tr>`;
    }).join('');
    $('retExplain').innerHTML = `
      <h4>${U.docChip(r.p.id)} ${T.esc(r.p.title)} <span class="muted small">· rank #${rank}</span></h4>
      ${r.contribs.length
        ? `<div class="bm-wrap"><table class="bm-table">
            <tr><th>Query word</th><th class="num">Times in passage</th><th class="num">Rarity (IDF)</th><th class="num">Repeat &amp; length factor</th><th class="num">Points</th></tr>
            ${rows}
            <tr class="total"><td>Total BM25 score</td><td></td><td></td><td></td><td class="num">${r.score.toFixed(2)}</td></tr>
          </table></div>`
        : '<p class="small muted" style="margin:6px 0 0">None of the query words appear in this passage, so its score is 0.</p>'}`;
  }

  function initRetriever() {
    const q = $('retQ'), k = $('retK');
    $('retList').addEventListener('click', (e) => {
      const row = e.target.closest('.rrow');
      if (!row) return;
      retSel = row.dataset.id;
      renderRetriever();
    });
    document.querySelectorAll('#algoTabs button').forEach((b) => (b.onclick = () => {
      document.querySelectorAll('#algoTabs button').forEach((x) => x.classList.toggle('on', x === b));
      $('algoPaper').hidden = b.dataset.a !== 'paper';
      $('algoPage').hidden = b.dataset.a !== 'page';
    }));
    exampleButtons($('retEx'), RET_EX, (v) => { q.value = v; renderRetriever(); });
    q.addEventListener('input', debounce(renderRetriever));
    k.addEventListener('input', renderRetriever);
    renderRetriever();
  }

  function renderRetriever() {
    const q = $('retQ').value, K = +$('retK').value;
    $('retKv').textContent = K;
    $('retKv2').textContent = K;
    const res = corpus().search(q);
    const max = Math.max(res[0] ? res[0].score : 0, 0.001);
    const list = $('retList');

    // Keyed rows so bars animate and rows glide into their new order (FLIP).
    const before = new Map([...list.children].map((el) => [el.dataset.id, el.getBoundingClientRect().top]));
    const existing = new Map([...list.children].map((el) => [el.dataset.id, el]));
    const ids = new Set(res.map((r) => r.p.id));
    existing.forEach((el, id) => { if (!ids.has(id)) el.remove(); });

    res.forEach((r, i) => {
      let el = existing.get(r.p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'rrow';
        el.dataset.id = r.p.id;
        el.innerHTML = `<span class="rid"></span><span class="rbody"><span class="rtitle"></span><span class="rbar"><i></i></span></span><span class="rscore"></span>`;
      }
      el.classList.toggle('top', i < K);
      el.classList.toggle('sel', r.p.id === (retSel || res[0].p.id));
      el.title = 'Click to see how this score is calculated';
      el.querySelector('.rid').textContent = r.p.id;
      el.querySelector('.rtitle').textContent = r.p.title;
      el.querySelector('.rbar i').style.width = (100 * r.score) / max + '%';
      el.querySelector('.rscore').textContent = r.score.toFixed(2);
      list.appendChild(el);
    });
    if (!U.reducedMotion()) {
      [...list.children].forEach((el) => {
        const old = before.get(el.dataset.id);
        if (old == null) return;
        const dy = old - el.getBoundingClientRect().top;
        if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 450, easing: 'cubic-bezier(.3,.7,.2,1)' });
      });
    }

    renderExplain(res, q);
    const qset = new Set(T.queryTerms(q));
    $('retTop').innerHTML = res.slice(0, K).map((r, i) => `
      <div class="tcard fade-in" style="animation-delay:${i * 60}ms">
        <div class="tcard-h"><span>${U.docChip(r.p.id)} <b>${T.esc(r.p.title)}</b></span><span class="rk">#${i + 1} · ${r.score.toFixed(2)}</span></div>
        <p>${T.highlight(r.p.text, qset)}</p>
        ${r.score <= 0 ? '<p class="small muted" style="margin-top:6px">Score 0: a retriever still returns K passages, even poor ones. That is why Self-RAG checks relevance (ISREL).</p>' : ''}
      </div>`).join('') || '<div class="empty">Type a question to search the document.</div>';
  }

  /* ================= Critic ================= */
  const CT = {
    Retrieve: {
      ask: '<b>Retrieve</b> asks: given this input, should the model look something up?',
      show: ['q'], qLabel: 'Question or instruction',
      ex: [
        { label: 'Who designed the tower?', q: 'Who designed the Eiffel Tower?' },
        { label: 'Birthday message', q: 'Write a birthday message for my best friend.' },
        { label: 'How many rivets?', q: 'How many rivets hold the Eiffel Tower together?' },
        { label: 'Tell a joke', q: 'Tell me a joke about cats.' }
      ]
    },
    ISREL: {
      ask: '<b>ISREL</b> asks: is this passage relevant to the question?',
      show: ['q', 'p'], qLabel: 'Question',
      ex: [
        { label: 'Height + d3 (relevant)', q: 'How tall is the Eiffel Tower?', pid: 'd3' },
        { label: 'Height + cafés (off-topic)', q: 'How tall is the Eiffel Tower?', pid: 'd11' },
        { label: '"Made of" + cheese (trap)', q: 'What is the Eiffel Tower made of?', pid: 'd13' }
      ]
    },
    ISSUP: {
      ask: '<b>ISSUP</b> asks: is the sentence the model wrote backed up by the passage?',
      show: ['p', 's'], sLabel: 'Sentence the model wrote',
      ex: [
        { label: '330 m (supported)', pid: 'd3', s: 'The Eiffel Tower is about 330 metres tall.' },
        { label: '300 m (wrong number)', pid: 'd3', s: 'The Eiffel Tower is about 300 metres tall.' },
        { label: 'Steel and glass (made up)', pid: 'd4', s: 'The tower is built mostly from steel and glass.' }
      ]
    },
    ISUSE: {
      ask: '<b>ISUSE</b> asks: how useful is this answer for the question? (5 = very useful)',
      show: ['q', 's'], qLabel: 'Question', sLabel: 'Answer',
      ex: [
        { label: 'Direct answer', q: 'How tall is the Eiffel Tower?', s: 'The Eiffel Tower is about 330 metres tall.' },
        { label: 'Half an answer', q: 'When was the Eiffel Tower built, and who designed it?', s: 'It was finished in 1889.' },
        { label: 'Off-topic answer', q: 'How tall is the Eiffel Tower?', s: 'Paris has many lovely cafés.' }
      ]
    }
  };
  let critType = 'Retrieve';

  function fillPassageSelect() {
    const sel = $('critPSel');
    const cur = sel.value;
    sel.innerHTML = corpus().passages.map((p) => `<option value="${p.id}">${p.id} · ${T.esc(p.title)}</option>`).join('') +
      '<option value="custom">Custom text…</option>';
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }

  function setPassage(pid) {
    const p = corpus().passages.find((x) => x.id === pid);
    $('critPSel').value = p ? pid : 'custom';
    if (p) $('critP').value = p.text;
  }

  function applyCritExample(x) {
    if (x.q != null) $('critQ').value = x.q;
    if (x.pid) setPassage(x.pid);
    if (x.s != null) $('critS').value = x.s;
    renderCritic();
  }

  function setCritType(t) {
    critType = t;
    const cfg = CT[t];
    document.querySelectorAll('#critType button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    $('critAsk').innerHTML = cfg.ask;
    $('critQWrap').hidden = !cfg.show.includes('q');
    $('critPWrap').hidden = !cfg.show.includes('p');
    $('critSWrap').hidden = !cfg.show.includes('s');
    if (cfg.qLabel) $('critQLabel').textContent = cfg.qLabel;
    if (cfg.sLabel) $('critSLabel').textContent = cfg.sLabel;
    exampleButtons($('critEx'), cfg.ex, applyCritExample);
    applyCritExample(cfg.ex[0]);
  }

  function initCritic() {
    fillPassageSelect();
    document.querySelectorAll('#critType button').forEach((b) => (b.onclick = () => setCritType(b.dataset.t)));
    $('critPSel').onchange = () => { if ($('critPSel').value !== 'custom') setPassage($('critPSel').value); else $('critP').focus(); renderCritic(); };
    $('critP').addEventListener('input', () => { $('critPSel').value = 'custom'; });
    ['critQ', 'critP', 'critS'].forEach((id) => $(id).addEventListener('input', debounce(renderCritic)));
    setCritType('Retrieve');
  }

  function renderCritic() {
    const q = $('critQ').value, p = $('critP').value, s = $('critS').value;
    let r, why;
    if (critType === 'Retrieve') {
      r = C.retrieve(q);
      const list = (a) => (a.length ? a.map((x) => `<b>${T.esc(x)}</b>`).join(', ') : '<i>none</i>');
      why = `Fact-seeking words: ${list(r.factual)}<br>Named things: ${list(r.entity)}<br>Creative words: ${list(r.creative)}<br>
        <span class="muted">Facts and names push toward <b>Yes</b>. Creative requests push toward <b>No</b>.</span>`;
    } else if (critType === 'ISREL') {
      r = C.isrel(q, p);
      const set = new Set(r.evidence);
      why = `<span class="lbl">Question words found in the passage</span>${T.highlight(p, set) || '<i>(empty)</i>'}
        <p class="small muted" style="margin:8px 0 0">Coverage of the question: <b>${Math.round(r.cov * 100)}%</b>${r.missing.length ? ` · missing: ${r.missing.map(T.termLabel).join(', ')}` : ''}. Rare words count more than common ones.</p>`;
    } else if (critType === 'ISSUP') {
      r = C.issup(s, p);
      const found = new Set(r.found), miss = new Set(r.missing), bad = new Set(r.badNums);
      const marked = T.markWords(s, (st, raw, isNum) => isNum ? (bad.has(raw.replace(/,/g, '')) ? 'miss' : null) : found.has(st) ? 'hl' : miss.has(st) ? 'miss' : null);
      why = `<span class="lbl">Yellow = found in passage · Red = not found</span>${marked || '<i>(empty)</i>'}
        <p class="small muted" style="margin:8px 0 0">Support: <b>${Math.round(r.f * 100)}%</b> of the sentence's key words.${r.badNums.length ? ` Number <b>${r.badNums.join(', ')}</b> does not appear in the passage.` : ''}</p>`;
    } else {
      r = C.isuse(q, s);
      why = `<span class="lbl">Question words the answer covers</span>${T.highlight(s, new Set(r.evidence)) || '<i>(empty)</i>'}
        <p class="small muted" style="margin:8px 0 0">The more of the question it answers, the higher the score.</p>`;
    }
    $('critOut').innerHTML = `
      <div class="big pop">${U.chip(critType, r.token)}<span class="conf">confidence <b>${Math.round(r.conf ? r.conf * 100 : Math.max(r.p, 1 - r.p) * 100)}%</b></span></div>
      ${U.probBars(r.probs, critType, r.token)}
      <div class="crit-why"><span class="lbl">Why</span>${why}</div>`;
  }

  /* ================= Generator ================= */
  const GEN_EX = [
    'How tall is the Eiffel Tower, and what is it made of?',
    'Write a short intro to Paris for a tourist, then tell me how tall the Eiffel Tower is.',
    'Write a short birthday message for my best friend.'
  ];
  let genToken = 0;

  function initGenerator() {
    exampleButtons($('genEx'), GEN_EX, (v) => { $('genQ').value = v; runGenerator(); });
    $('genGo').onclick = runGenerator;
    $('genQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') runGenerator(); });
    $('genRaw').innerHTML = '<div class="empty">Press <b>Generate</b> to watch the model write.</div>';
    $('genClean').innerHTML = '<span class="muted">…</span>';
  }

  function runGenerator() {
    const my = ++genToken;
    const run = G.buildRun($('genQ').value, corpus(), { K: 1 });
    const pieces = [];
    run.loops.forEach((L) => {
      const lane = L.lanes[0];
      pieces.push({ html: `<span class="loopmark">Segment ${L.t + 1}</span>`, wait: 250 });
      pieces.push({ html: U.chip('Retrieve', L.doRet ? 'Yes' : 'No'), wait: 450 });
      if (L.doRet) {
        pieces.push({ html: `<span class="psg">${U.docChip(lane.passage.id)} ${T.esc(lane.passage.text)}</span>`, wait: 600 });
        pieces.push({ html: U.chip('ISREL', lane.rel.token), wait: 450 });
      }
      pieces.push({ words: lane.text.split(' ') });
      if (L.doRet) pieces.push({ html: U.chip('ISSUP', lane.sup.token), wait: 400 });
      pieces.push({ html: U.chip('ISUSE', lane.use.token), wait: 500 });
    });

    const raw = $('genRaw'), clean = $('genClean');
    raw.innerHTML = '';
    clean.innerHTML = '';
    const fast = U.reducedMotion();
    let pi = 0, wi = 0, segEl = null;

    function tick() {
      if (my !== genToken) return;
      if (pi >= pieces.length) return;
      const pc = pieces[pi];
      if (pc.words) {
        if (wi === 0) {
          segEl = document.createElement('span');
          segEl.className = 'seg';
          raw.appendChild(document.createTextNode(' '));
          raw.appendChild(segEl);
          if (clean.textContent) clean.appendChild(document.createTextNode(' '));
        }
        const w = (wi ? ' ' : '') + pc.words[wi];
        segEl.textContent += w;
        clean.appendChild(document.createTextNode(w));
        wi++;
        if (wi >= pc.words.length) { wi = 0; pi++; }
        setTimeout(tick, fast ? 0 : 55);
      } else {
        raw.insertAdjacentHTML('beforeend', ' ' + pc.html.replace('class="chip', 'class="pop chip'));
        pi++;
        setTimeout(tick, fast ? 0 : pc.wait);
      }
    }
    tick();
  }

  SR.playgrounds = {
    init() {
      document.querySelectorAll('#pgTabs .tab').forEach((t) => {
        t.onclick = () => {
          document.querySelectorAll('#pgTabs .tab').forEach((x) => x.classList.toggle('on', x === t));
          ['pgRet', 'pgCrit', 'pgGen'].forEach((id) => ($(id).hidden = id !== t.dataset.pane));
          if (t.dataset.pane === 'pgRet') renderRetriever();
        };
      });
      initRetriever();
      initCritic();
      initGenerator();
    },
    onDoc() {
      renderRetriever();
      fillPassageSelect();
      renderCritic();
    }
  };
})();
