// The main Self-RAG simulator: loop of Retrieve? -> Retrieve K -> parallel generation ->
// critique -> rank -> append, rendered beat by beat on a single clock.
(function () {
  const SR = window.SR;
  const T = SR.text, G = SR.generator, U = SR.ui;
  const $ = (id) => document.getElementById(id);
  const esc = T.esc;

  const PH = { ready: -1, decide: 0, retrieve: 1, isrel: 2, generate: 3, critique: 4, score: 5, rank: 6, append: 7, finish: 8 };
  const STEPS = ['Retrieve?', 'Retrieve K', 'Generate in parallel', 'Critique', 'Rank', 'Append'];
  const STEP_OF = { decide: 0, retrieve: 1, isrel: 2, generate: 2, critique: 3, score: 3, rank: 4, append: 5 };

  const PRESETS = [
    { label: 'Two facts: height + material', prompt: 'How tall is the Eiffel Tower, and what is it made of?' },
    { label: 'Retrieves mid-answer: intro → fact', prompt: 'Write a short intro to Paris for a tourist, then tell me how tall the Eiffel Tower is.' },
    { label: 'When + who', prompt: 'When was the Eiffel Tower built, and who designed it?' },
    { label: 'Creative: no lookup needed', prompt: 'Write a short birthday message for my best friend.' },
    { label: 'Why does it sparkle?', prompt: 'Why does the Eiffel Tower sparkle at night?' }
  ];

  const S = {
    settings: { K: 3, threshold: 0.5, wRel: 1, wSup: 1, wUse: 0.5, maxSeg: 4 },
    prompt: PRESETS[0].prompt,
    run: null,
    beats: [],
    player: null
  };

  /* ---------------- beats ---------------- */
  function makeBeats(run) {
    const K = run.settings.K;
    const th = run.settings.threshold;
    const beats = [{ ph: 'ready', dur: 300, hold: 600, narr: `Question received: <b>“${esc(run.prompt)}”</b>. Press <b>Play</b> or <b>Step</b> to begin.` }];
    run.loops.forEach((L, li) => {
      const n = li + 1;
      const pTxt = U.fmt(L.p);
      const prev = li > 0 ? run.loops[li - 1] : null;
      const switchNote = prev && L.doRet && !prev.doRet
        ? ' <b>Notice:</b> the last segment did not retrieve, but this one does. The decision is made again before every segment.'
        : prev && !L.doRet && prev.doRet
          ? ' <b>Notice:</b> the last segment retrieved, but this one doesn\'t need to.'
          : '';
      beats.push({
        li, ph: 'decide', dur: 1500, hold: switchNote ? 2200 : 1100,
        narr: (L.doRet
          ? `<b>Segment ${n}.</b> Before writing, the model asks itself: do I need to look something up? p(Retrieve=Yes) = ${pTxt}, which is at least the threshold δ = ${U.fmt(th)}, so it writes <b>[Retrieve=Yes]</b>.`
          : `<b>Segment ${n}.</b> Do I need to look something up? p(Retrieve=Yes) = ${pTxt}, below the threshold δ = ${U.fmt(th)}, so it writes <b>[Retrieve=No]</b> and goes straight to writing.`) + switchNote
      });
      if (L.doRet) {
        const maxTok = Math.max(...L.lanes.map((x) => x.text.split(' ').length));
        const win = L.lanes[L.winner];
        beats.push({ li, ph: 'retrieve', dur: 1100, hold: 1100, narr: `The <b>retriever</b> fetches the top ${L.lanes.length} passage${L.lanes.length > 1 ? 's' : ''} from the document. One lane opens per passage, and from here the lanes work <b>at the same time</b>.` });
        beats.push({ li, ph: 'isrel', dur: 900, hold: 1100, narr: 'Each lane first judges its passage: is it relevant to the question? → <b>ISREL</b>.' });
        beats.push({ li, ph: 'generate', dur: maxTok * 110, hold: 1000, narr: `All ${L.lanes.length} lanes write a candidate segment <b>in parallel</b>, each one reading its own passage.` });
        beats.push({ li, ph: 'critique', dur: 900, hold: 1300, narr: 'Each lane checks its own segment: is it supported by the passage (<b>ISSUP</b>), and is it useful (<b>ISUSE</b>)?' });
        beats.push({ li, ph: 'score', dur: 900, hold: 1300, narr: 'Each lane gets a score: <b>p(segment) + w·ISREL + w·ISSUP + w·ISUSE</b>. Open “How is this scored?” on a lane to see the numbers.' });
        beats.push({ li, ph: 'rank', dur: 900, hold: 1300, narr: `Lanes are ranked by score. The best is <b>${esc(win.passage.id)}</b> (“${esc(win.passage.title)}”) with <b>${U.fmt(win.score)}</b>.` });
        beats.push({ li, ph: 'append', dur: 1000, hold: 1400, narr: li < run.loops.length - 1 ? 'The best segment is <b>appended</b> to the answer, and the other lanes are discarded. <b>↻ Loop:</b> back to “Retrieve?” for the next segment.' : 'The best segment is <b>appended</b> to the answer, and the other lanes are discarded.' });
      } else {
        const lane = L.lanes[0];
        beats.push({ li, ph: 'generate', dur: lane.text.split(' ').length * 110, hold: 1000, narr: lane.source === 'creative' ? 'No passages needed. The generator writes from its own creativity.' : 'No passages. The generator writes from <b>memory</b> only, which is risky for facts.' });
        beats.push({ li, ph: 'critique', dur: 900, hold: 1200, narr: 'With no passage, there is nothing to check relevance or support against. The model only rates usefulness: <b>ISUSE</b>.' });
        beats.push({ li, ph: 'append', dur: 1000, hold: 1300, narr: li < run.loops.length - 1 ? 'The segment is appended. <b>↻ Loop:</b> back to “Retrieve?” for the next segment.' : 'The segment is appended to the answer.' });
      }
    });
    beats.push({ ph: 'finish', dur: 600, hold: 0, narr: `<b>Done.</b> No more segments needed. The model rates its whole answer <b>[ISUSE=${run.final.token}]</b> and stops.` });
    return beats;
  }

  /* ---------------- render ---------------- */
  function renderBeat(i, dir) {
    const b = S.beats[i];
    const run = S.run;
    const P = PH[b.ph];
    const li = b.ph === 'finish' ? run.loops.length - 1 : b.li != null ? b.li : -1;
    const L = li >= 0 ? run.loops[li] : null;
    const fresh = dir !== -1;

    $('simNarr').innerHTML = b.narr;
    $('trSeg').textContent = b.ph === 'finish' ? 'Complete' : L ? `Segment ${li + 1}` : 'Ready';
    renderTracker(b, L);
    renderTimeline(li, P, b.ph === 'finish', fresh && b.ph === 'decide');
    renderDecide(L, P, fresh && b.ph === 'decide');
    renderLanes(L, P, li, fresh);
    renderAnswer(li, P, fresh && b.ph === 'append' && dir === 1, b.ph === 'finish');
    renderScrubState(i);
    $('beatCount').textContent = `Step ${i + 1} / ${S.beats.length}`;
  }

  function renderTracker(b, L) {
    const cur = STEP_OF[b.ph];
    const items = STEPS.map((s, k) => {
      let cls = '';
      if (b.ph === 'finish') cls = 'done';
      else if (cur != null) {
        if (k === cur) cls = 'now';
        else if (k < cur) cls = 'done';
        if (L && !L.doRet && k === 1) cls = 'skip';
      }
      return `<li class="${cls}">${s}</li>`;
    });
    $('trSteps').innerHTML = items.join('<li class="arrow">→</li>') + '<li class="arrow">→</li><li class="loop" title="Repeat for the next segment">↻ next segment</li>';
  }

  // One entry per segment: the Retrieve decision is re-made every time.
  function renderTimeline(li, P, finished, animate) {
    const loops = S.run.loops;
    const shown = finished ? loops.length : li >= 0 ? li + 1 : 0;
    let html = '<span class="dtl-label">Retrieve decision per segment</span>';
    for (let k = 0; k < shown; k++) {
      const L = loops[k];
      const isNew = animate && k === li;
      html += `<span class="dtl-item ${k === li && !finished ? 'cur' : ''}"><span class="dtl-seg">Seg ${k + 1}</span>${U.chip('Retrieve', L.doRet ? 'Yes' : 'No', isNew ? 'pop' : '')}</span>`;
      if (k < shown - 1) html += '<span class="dtl-arrow">→</span>';
    }
    if (!finished) html += `${shown ? '<span class="dtl-arrow">→</span>' : ''}<span class="dtl-item next"><span class="dtl-seg">${shown ? 'next…' : 'Seg 1'}</span><span class="dtl-q">?</span></span>`;
    $('simDtl').innerHTML = html;
  }

  function renderDecide(L, P, animate) {
    const box = $('simDecide');
    if (!L) { box.innerHTML = ''; return; }
    const th = S.run.settings.threshold;
    const pct = (L.p * 100).toFixed(1);
    box.innerHTML = `
      <div class="decide-box ${L.doRet ? '' : 'no'}">
        <div class="decide-title">Should I retrieve?<small>Segment ${L.t + 1}</small></div>
        <div class="gauge"><div class="gauge-fill" style="width:${animate ? 0 : pct}%"></div><div class="gauge-th" style="left:${th * 100}%"><span>δ = ${U.fmt(th)}</span></div></div>
        <div class="decide-row"><span>p(Retrieve=Yes) = <b>${U.fmt(L.p)}</b></span>${U.chip('Retrieve', L.doRet ? 'Yes' : 'No', animate ? 'pop" style="animation-delay:.9s' : '')}<span class="why">${esc(L.reason)}</span></div>
      </div>`;
    if (animate) requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = box.querySelector('.gauge-fill');
      if (f) f.style.width = pct + '%';
    }));
  }

  function laneHTML(L, lane, idx, P, fresh, li) {
    const isWin = idx === L.winner;
    const maxScore = 1 + S.run.settings.wRel + S.run.settings.wSup + S.run.settings.wUse;
    const pop = (ph) => (fresh && P === ph ? 'pop' : '');
    const cls = ['lane'];
    if (fresh && ((L.doRet && P === 1) || (!L.doRet && P === 3))) cls.push('fade-in');
    if (P >= 6 && isWin) cls.push('winner');
    if (P >= 7 && !isWin) cls.push('loser');
    if (!L.doRet && P >= 7) cls.push('winner');

    const srcLabel = { passage: 'from passage', memory: 'from memory', creative: 'creative' }[lane.source];
    const head = lane.passage
      ? `<div class="lane-head">${U.docChip(lane.passage.id)}<span class="lane-title" title="${esc(lane.passage.title)}">${esc(lane.passage.title)}</span>${P >= 6 ? `<span class="rank-badge ${pop(6)}">#${L.order.indexOf(idx) + 1}</span>` : `<span class="rank-badge">BM25 ${U.fmt(lane.bm25, 1)}</span>`}</div>
         <p class="lane-passage" title="Click to expand">${esc(lane.passage.text)}</p>`
      : `<div class="lane-head"><span class="lane-title">No retrieval</span></div>`;

    const relRow = lane.passage ? `<div class="lane-row">${P >= 2 ? U.chip('ISREL', lane.rel.token, pop(2)) : ''}</div>` : '';

    let seg;
    if (P < 3) seg = `<p class="lane-seg waiting">waiting to write…</p>`;
    else if (P === 3) seg = `<p class="lane-seg"><span class="seg-text" data-lane="${idx}"></span><span class="cursor"></span></p>`;
    else seg = `<p class="lane-seg">${esc(lane.text)}</p>`;

    const critRow = P >= 4
      ? `<div class="lane-row">${lane.passage ? U.chip('ISSUP', lane.sup.token, pop(4)) : ''}${U.chip('ISUSE', lane.use.token, pop(4))}</div>`
      : `<div class="lane-row"></div>`;

    let score = '';
    if (P >= 5 && lane.passage) {
      const w = S.run.settings;
      const pc = lane.parts;
      score = `
        <div class="lane-score ${pop(5)}"><span class="bar"><i style="width:${Math.min(100, (100 * lane.score) / maxScore)}%"></i></span><span>${U.fmt(lane.score)}</span></div>
        <details><summary>How is this scored?</summary><div class="breakdown">
          p(segment) ......... ${U.fmt(pc.py)}<br>
          + ${U.fmt(w.wRel, 1)} × ISREL ${U.fmt(lane.rel.s)} = ${U.fmt(pc.rel)}<br>
          + ${U.fmt(w.wSup, 1)} × ISSUP ${U.fmt(lane.sup.s)} = ${U.fmt(pc.sup)}<br>
          + ${U.fmt(w.wUse, 1)} × ISUSE ${U.fmt(lane.use.s)} = ${U.fmt(pc.use)}
          <div class="tot">score = ${U.fmt(lane.score)}</div>
          <div class="small" style="font-family:var(--sans);margin-top:4px">Each critique score is the probability of the best token value (e.g. p(Relevant)).</div>
        </div></details>`;
    }

    const crown = (P >= 6 && isWin && lane.passage) ? `<span class="crown ${pop(6)}">Best</span>` : '';
    return `<div class="${cls.join(' ')}" data-key="L${li}-${idx}">
      ${crown}${head}${relRow}
      <div class="lane-label"><span>Generator writes</span>${P >= 3 ? `<span class="src src-${lane.source}">${srcLabel}</span>` : ''}</div>
      ${seg}${critRow}${score}
    </div>`;
  }

  function renderLanes(L, P, li, fresh) {
    const box = $('simLanes');
    const visible = L && (L.doRet ? P >= 1 : P >= 3);
    if (!visible) {
      box.style.setProperty('--cols', 1);
      box.innerHTML = `<div class="empty">${L && !L.doRet ? 'No retrieval this time, so there are no passage lanes.' : 'Lanes open here when passages are retrieved.'}</div>`;
      return;
    }
    // FLIP: remember where lanes were before re-rendering, then glide to the new spots.
    const old = new Map([...box.querySelectorAll('.lane')].map((e) => [e.dataset.key, e.getBoundingClientRect()]));
    const order = P >= 6 ? L.order : L.lanes.map((_, k) => k);
    box.style.setProperty('--cols', L.lanes.length);
    box.innerHTML = order.map((k) => laneHTML(L, L.lanes[k], k, P, fresh, li)).join('');
    box.querySelectorAll('.lane-passage').forEach((p) => (p.onclick = () => p.classList.toggle('open')));
    if (!U.reducedMotion()) {
      box.querySelectorAll('.lane').forEach((e) => {
        const r0 = old.get(e.dataset.key);
        if (!r0) return;
        const r1 = e.getBoundingClientRect();
        const dx = r0.left - r1.left, dy = r0.top - r1.top;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          e.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 700 / S.player.speed, easing: 'cubic-bezier(.3,.7,.2,1)' });
        }
      });
    }
  }

  function segTokensHTML(L) {
    const lane = L.lanes[L.winner];
    const pre = [U.chip('Retrieve', L.doRet ? 'Yes' : 'No')];
    if (lane.passage) pre.push(U.docChip(lane.passage.id), U.chip('ISREL', lane.rel.token));
    const post = [];
    if (lane.passage) post.push(U.chip('ISSUP', lane.sup.token));
    post.push(U.chip('ISUSE', lane.use.token));
    return { pre: `<span class="ans-tok">${pre.join('')}</span> `, post: ` <span class="ans-tok">${post.join('')}</span>` };
  }

  function renderAnswer(li, P, flyNow, finished) {
    const run = S.run;
    const box = $('simAnswer');
    const upto = finished ? run.loops.length : li >= 0 ? li + (P >= 7 ? 1 : 0) : 0;
    if (!upto) {
      box.innerHTML = '<span class="muted">Nothing yet. One segment is appended here per loop.</span>';
      return;
    }
    let html = '';
    for (let k = 0; k < upto; k++) {
      const L = run.loops[k];
      const tk = segTokensHTML(L);
      const landing = flyNow && k === upto - 1;
      html += `<span class="ans-seg ${landing ? 'landing' : ''}" data-k="${k}">${tk.pre}${esc(L.lanes[L.winner].text)}${tk.post}</span> `;
    }
    if (finished) html += `<div class="final pop">✓ Answer complete ${U.chip('ISUSE', run.final.token)}</div>`;
    box.innerHTML = html;

    if (flyNow) {
      const target = box.querySelector('.ans-seg.landing');
      const L = run.loops[upto - 1];
      const from = document.querySelector(`#simLanes .lane[data-key="L${upto - 1}-${L.winner}"] .lane-seg`);
      if (!target) return;
      if (!from || U.reducedMotion()) { target.classList.remove('landing'); target.classList.add('landed'); return; }
      fly(from, target);
    }
  }

  function fly(fromEl, toEl) {
    const a = fromEl.getBoundingClientRect();
    const z = toEl.getBoundingClientRect();
    const g = document.createElement('div');
    g.className = 'fly-ghost';
    g.textContent = fromEl.textContent;
    Object.assign(g.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px' });
    document.body.appendChild(g);
    const anim = g.animate(
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${z.left - a.left}px, ${z.top - a.top}px) scale(.9)`, opacity: 0.15 }
      ],
      { duration: 900 / S.player.speed, easing: 'cubic-bezier(.5,0,.2,1)' }
    );
    const done = () => { g.remove(); toEl.classList.remove('landing'); toEl.classList.add('landed'); };
    anim.onfinish = done;
    anim.oncancel = done;
  }

  function renderFrame(i, pa) {
    const b = S.beats[i];
    if (b.ph !== 'generate') return;
    const L = S.run.loops[b.li];
    const maxTok = Math.max(...L.lanes.map((x) => x.text.split(' ').length));
    const n = Math.ceil(pa * maxTok);
    document.querySelectorAll('#simLanes .seg-text').forEach((el) => {
      const words = L.lanes[+el.dataset.lane].text.split(' ');
      const shown = words.slice(0, Math.min(n, words.length)).join(' ');
      if (el.textContent !== shown) el.textContent = shown;
      const cur = el.nextElementSibling;
      if (cur) cur.style.display = n >= words.length ? 'none' : '';
    });
  }

  /* ---------------- scrubber & controls ---------------- */
  function renderScrubber() {
    $('scrub').innerHTML = S.beats.map((b, i) => `<i data-i="${i}" class="${b.ph === 'decide' && i > 1 ? 'loopstart' : ''}" title="${b.li != null ? 'Segment ' + (b.li + 1) + ': ' : ''}${b.ph}"></i>`).join('');
  }
  function renderScrubState(i) {
    $('scrub').querySelectorAll('i').forEach((el, k) => {
      el.classList.toggle('done', k < i);
      el.classList.toggle('now', k === i);
    });
  }

  function onState(st) {
    $('playTxt').textContent = st.playing ? 'Pause' : 'Play';
    $('playIco').innerHTML = st.playing ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M8 5v14l11-7z"/>';
    $('cPlay').setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
  }

  function rebuild(keepPos) {
    S.run = G.buildRun(S.prompt, SR.state.corpus, S.settings);
    S.beats = makeBeats(S.run);
    renderScrubber();
    if (keepPos) S.player.load(S.beats, Math.min(S.player.i, S.beats.length - 1), true);
    else S.player.load(S.beats, 0, false);
  }

  function inView(el) {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.3;
  }

  function init() {
    S.player = new SR.Player({ onBeat: renderBeat, onFrame: renderFrame, onState });

    $('simQ').value = S.prompt;
    const presets = $('simPresets');
    presets.innerHTML = '<span class="small muted" style="align-self:center">Try:</span>' +
      PRESETS.map((p, i) => `<button class="ex" data-i="${i}">${esc(p.label)}</button>`).join('');
    presets.onclick = (e) => {
      const b = e.target.closest('.ex');
      if (!b) return;
      S.prompt = PRESETS[+b.dataset.i].prompt;
      $('simQ').value = S.prompt;
      rebuild(false);
      S.player.play();
    };
    $('midAnswerBtn').onclick = () => {
      S.prompt = PRESETS[1].prompt;
      $('simQ').value = S.prompt;
      rebuild(false);
      $('sim').scrollIntoView({ behavior: U.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      setTimeout(() => S.player.play(), 500);
    };
    const run = () => { S.prompt = $('simQ').value.trim() || PRESETS[0].prompt; rebuild(false); S.player.play(); };
    $('simRun').onclick = run;
    $('simQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });

    document.querySelectorAll('#simK button').forEach((b) => (b.onclick = () => {
      document.querySelectorAll('#simK button').forEach((x) => x.classList.toggle('on', x === b));
      S.settings.K = +b.dataset.k;
      rebuild(true);
    }));

    const sliders = [['sTh', 'vTh', 'threshold', 2], ['sRel', 'vRel', 'wRel', 1], ['sSup', 'vSup', 'wSup', 1], ['sUse', 'vUse', 'wUse', 1]];
    sliders.forEach(([sid, vid, key, d]) => {
      $(sid).addEventListener('input', () => {
        S.settings[key] = +$(sid).value;
        $(vid).textContent = (+$(sid).value).toFixed(d);
        rebuild(true);
      });
    });

    $('cPlay').onclick = () => S.player.toggle();
    $('cStep').onclick = () => S.player.step();
    $('cBack').onclick = () => S.player.back();
    $('cReset').onclick = () => S.player.reset();
    document.querySelectorAll('#cSpeed button').forEach((b) => (b.onclick = () => {
      document.querySelectorAll('#cSpeed button').forEach((x) => x.classList.toggle('on', x === b));
      S.player.setSpeed(+b.dataset.s);
    }));
    $('scrub').onclick = (e) => { const t = e.target.closest('i'); if (t) S.player.seek(+t.dataset.i); };
    $('showTok').onchange = () => $('simAnswerBox').classList.toggle('hide-tok', !$('showTok').checked);

    document.addEventListener('keydown', (e) => {
      if (/^(INPUT|TEXTAREA|SELECT|SUMMARY)$/.test(e.target.tagName)) return;
      if (e.target.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return; // native click handles it
      if (!inView($('sim'))) return;
      if (e.key === ' ') { e.preventDefault(); S.player.toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); S.player.step(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); S.player.back(); }
      else if (e.key === 'r' || e.key === 'R') S.player.reset();
    });

    rebuild(false);
  }

  SR.sim = { init, onDoc: () => rebuild(false) };
})();
