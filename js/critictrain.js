// "Training the critic" zoom-in: input matrix, serialized training input, example tables, toy training loop.
(function () {
  const SR = window.SR;
  const U = SR.ui;
  const esc = SR.text.esc;
  const $ = (id) => document.getElementById(id);

  // Passages from the sample document (shortened where needed).
  const P = {
    build: "The Eiffel Tower was built between 1887 and 1889 as the entrance arch for the 1889 World's Fair in Paris.",
    design: 'The tower is named after Gustave Eiffel, whose engineering company designed and built it. The original sketch was drawn by two of his engineers, Maurice Koechlin and Émile Nouguier.',
    tall: 'The Eiffel Tower is about 330 metres tall, including the antennas at its top. For 41 years it was the tallest man-made structure in the world, until the Chrysler Building passed it in 1930.',
    critics: 'Not everyone loved it at first. In 1887, a group of famous artists published a letter calling the planned tower "useless and monstrous".',
    visitors: 'Around 6 to 7 million people visit the Eiffel Tower every year. Visitors can climb the stairs or take lifts to three different levels.',
    radio: 'The tower was meant to stand for only 20 years. It was saved from being taken down in 1909 because it was useful as a giant radio antenna.',
    cafes: 'Paris is famous for its cafés, where people sit outside for hours drinking coffee and watching the street.'
  };

  // Paper facts: Table 1 (inputs/outputs), Appendix A.1 (GPT-4 label counts), Appendix Fig. 5 (Llama2-7B critic accuracy vs GPT-4).
  const TYPES = {
    Retrieve: {
      uses: { x: 'yes', p: 'opt', d: 'opt', y: 'opt' },
      labels: ['Yes', 'No', 'Continue'], n: 12594, acc: 93.8,
      sig: ['x', '(y<sub>&lt;t</sub>, d, y)'],
      cols: ['x', 'p', 'd', 'y'],
      rows: [
        { x: 'Who designed the Eiffel Tower?', r: 'Yes', raw: '[Yes]', why: 'A factual question. A document can confirm the names.' },
        { x: 'Write a short birthday message for my best friend.', r: 'No', raw: '[No]', why: 'Personal, creative writing. There is nothing to look up.' },
        { x: 'What is 12 × 7?', r: 'No', raw: '[No]', why: 'Simple maths. No document will contain this exact answer.' },
        { x: 'How tall is the Eiffel Tower?', p: 'The Eiffel Tower is about 330 metres tall.', d: P.tall, y: 'For 41 years it was the tallest man-made structure in the world.', r: 'Continue', raw: '[Continue to Use Evidence]', why: 'The passage already in hand verifies the next sentence, so keep using it.' },
        { x: 'Tell me about the Eiffel Tower.', p: 'It was built between 1887 and 1889.', d: P.build, y: 'It weighs about 10,100 tonnes.', r: 'Yes', raw: '[Retrieval]', why: 'The weight is not in the current passage. A new search is needed to check it.' },
        { x: 'Tell me about the Eiffel Tower.', p: 'It was built between 1887 and 1889.', d: P.build, y: 'It is a wonderful sight at sunset.', r: 'No', raw: '[No Retrieval]', why: 'An opinion. Nothing to verify.' }
      ]
    },
    ISREL: {
      uses: { x: 'yes', p: 'opt', d: 'yes', y: 'no' },
      labels: ['Relevant', 'Irrelevant'], n: 19317, acc: 80.2,
      sig: ['x', 'd'],
      cols: ['x', 'd'],
      rows: [
        { x: 'Who designed the Eiffel Tower?', d: P.design, r: 'Relevant', raw: '[Relevant]', why: 'Names the company and the two engineers.' },
        { x: 'Who designed the Eiffel Tower?', d: P.cafes, r: 'Irrelevant', raw: '[Irrelevant]', why: 'About Paris cafés, nothing about the tower.' },
        { x: 'When was the Eiffel Tower built?', d: P.critics, r: 'Irrelevant', raw: '[Irrelevant]', why: 'A keyword trap: it mentions 1887, but it is about the artists’ protest, not when it was built.' },
        { x: 'How tall is the Eiffel Tower?', d: P.tall, r: 'Relevant', raw: '[Relevant]', why: 'Gives the height directly: about 330 metres.' },
        { x: 'Why was the Eiffel Tower not demolished?', d: P.radio, r: 'Relevant', raw: '[Relevant]', why: 'Explains it was kept as a radio antenna.' }
      ]
    },
    ISSUP: {
      uses: { x: 'yes', p: 'opt', d: 'yes', y: 'yes' },
      labels: ['Fully', 'Partially', 'No support'], n: 11181, acc: 93.5,
      sig: ['x', 'd', 'y'],
      cols: ['x', 'd', 'y'],
      rows: [
        { x: 'Who designed the Eiffel Tower?', d: P.design, y: "It was designed by Gustave Eiffel's engineering company.", r: 'Fully', raw: '[Fully supported]', why: 'Every claim is stated in the passage.' },
        { x: 'Who designed the Eiffel Tower?', d: P.design, y: "Gustave Eiffel's company designed it, and it cost 7.8 million francs.", r: 'Partially', raw: '[Partially supported]', why: 'The designer is supported. The cost is not in the passage.' },
        { x: 'How tall is the Eiffel Tower?', d: P.tall, y: 'The tower is about 300 metres tall.', r: 'No support', raw: '[No support / Contradictory]', why: 'The passage says 330 m, so the answer contradicts it.' },
        { x: 'How tall is the Eiffel Tower?', d: P.tall, y: 'It is about 330 metres tall and was the tallest structure for 41 years.', r: 'Fully', raw: '[Fully supported]', why: 'Both facts appear in the passage.' },
        { x: 'How many people visit the Eiffel Tower?', d: P.visitors, y: 'About 7 million people visit each year, mostly in summer.', r: 'Partially', raw: '[Partially supported]', why: '“Mostly in summer” is not in the passage.' }
      ]
    },
    ISUSE: {
      uses: { x: 'yes', p: 'no', d: 'no', y: 'yes' },
      labels: ['5', '4', '3', '2', '1'], n: 3831, acc: 73.5,
      sig: ['x', 'y'],
      cols: ['x', 'y'],
      rows: [
        { x: 'Who designed the Eiffel Tower?', y: "Gustave Eiffel's company designed it; his engineers Maurice Koechlin and Émile Nouguier drew the first sketch.", r: '5', raw: '5', why: 'Complete and detailed. Fully answers the question.' },
        { x: 'Who designed the Eiffel Tower?', y: "It was designed by Gustave Eiffel's company.", r: '4', raw: '4', why: 'Correct, but could name the engineers.' },
        { x: 'How often is the Eiffel Tower repainted?', y: 'It is repainted from time to time to stop rust.', r: '3', raw: '3', why: 'On topic but vague. It never says how often.' },
        { x: 'How tall is the Eiffel Tower?', y: "It's very tall, one of the tallest things in Paris.", r: '2', raw: '2', why: 'Addresses the question but gives no height.' },
        { x: 'When was the Eiffel Tower built?', y: 'Paris has many famous cafés.', r: '1', raw: '1', why: 'Completely off-topic.' }
      ]
    }
  };

  // Instruction text GPT-4 got (shortened from the paper's Appendix D, Tables 8–12). The critic is trained with the same kind of input.
  const TPL = {
    Retrieve0: 'Given an instruction, judge whether finding some external documents from the web (e.g. Wikipedia) helps to generate a better response. Answer [Yes] or [No].',
    Retrieve1: 'Given an instruction, preceding sentences, evidence and an output sentence, decide: can the output be verified with this evidence [Continue to Use Evidence], does it need no verification [No Retrieval], or is more information needed [Retrieval]?',
    ISREL: 'Determine if the evidence is relevant to the instruction and provides useful information to complete the task. Answer [Relevant] or [Irrelevant].',
    ISSUP: 'Evaluate if the output is fully supported by the evidence: [Fully supported], [Partially supported] or [No support / Contradictory]. Do not use outside knowledge.',
    ISUSE: 'Rate whether the response is a helpful and informative answer to the query, from 1 (lowest) to 5 (highest).'
  };

  const COL = {
    x: { h: '<i class="v-x">x</i> Question', cls: 'c-x', key: 'Instruction', s: 's-x' },
    p: { h: '<i class="v-p">y<sub>&lt;t</sub></i> Text so far', cls: 'c-p', key: 'Preceding sentences', s: 's-p' },
    d: { h: '<i class="v-d">d</i> Passage', cls: 'c-d', key: 'Evidence', s: 's-d' },
    y: { h: '<i class="v-y">y</i> Answer', cls: 'c-y', key: 'Output', s: 's-y' }
  };
  const MIXC = { Retrieve: 'var(--t-ret)', ISREL: 'var(--t-rel)', ISSUP: 'var(--t-sup)', ISUSE: 'var(--t-use)' };

  let cur = 'Retrieve', row = 0;

  /* ---------- matrix ---------- */
  function cell(v) {
    if (v === 'yes') return '<span class="ct-yes" title="Always given">✓</span>';
    if (v === 'opt') return '<span class="ct-opt" title="Given in the multi-sentence version">optional</span>';
    return '<span class="ct-no">—</span>';
  }
  function renderMatrix() {
    $('ctMatrix').querySelector('tbody').innerHTML = Object.keys(TYPES).map((t) => {
      const T = TYPES[t];
      return `<tr data-t="${t}">
        <td><span class="chip t-${{ Retrieve: 'ret', ISREL: 'rel', ISSUP: 'sup', ISUSE: 'use' }[t]}"><span class="ck">${t}</span></span></td>
        <td>${cell(T.uses.x)}</td><td>${cell(T.uses.p)}</td><td>${cell(T.uses.d)}</td><td>${cell(T.uses.y)}</td>
        <td><div class="ct-targets">${T.labels.map((l) => U.chip(t, l)).join('')}</div></td>
        <td class="num">${T.n.toLocaleString('en-US')}</td>
        <td><div class="ct-agree"><span class="bar"><i data-w="${T.acc}"></i></span><b>${T.acc}%</b></div></td>
      </tr>`;
    }).join('');
    $('ctMatrix').querySelectorAll('tbody tr').forEach((tr) => (tr.onclick = () => select(tr.dataset.t, 0, true)));

    const total = Object.values(TYPES).reduce((a, T) => a + T.n, 0);
    $('ctMix').innerHTML = Object.keys(TYPES).map((t) =>
      `<span data-t="${t}" style="flex:${TYPES[t].n};background:${MIXC[t]}" title="${t}: ${TYPES[t].n.toLocaleString('en-US')} labels">${t} · ${Math.round((TYPES[t].n / total) * 100)}%</span>`
    ).join('');
    $('ctMix').querySelectorAll('span').forEach((s) => (s.onclick = () => select(s.dataset.t, 0, true)));

    // Fill agreement bars when the matrix scrolls into view.
    const fill = () => $('ctMatrix').querySelectorAll('.ct-agree i').forEach((i) => (i.style.width = i.dataset.w + '%'));
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) { fill(); io.disconnect(); } }, { threshold: 0.3 });
      io.observe($('ctMatrix'));
    } else fill();
  }

  /* ---------- serialized input ---------- */
  function seqHTML(t, r) {
    const T = TYPES[t];
    const tpl = t === 'Retrieve' ? (r.y ? TPL.Retrieve1 : TPL.Retrieve0) : TPL[t];
    const fields = ['x', 'p', 'd', 'y'].filter((k) => r[k] && (T.cols.includes(k) || k === 'p'));
    let out = `<span class="s-h">### Instruction:</span>\n<span class="s-tpl">${esc(tpl)}</span>\n\n`;
    for (const k of fields) out += `<span class="s-k">${COL[k].key}:</span> <span class="${COL[k].s}">${esc(r[k])}</span>\n`;
    out += `\n<span class="s-h">### Response:</span>\n<span class="s-r">${esc(r.raw)}</span>`;
    out += `<span class="s-note">↑ the critic learns to write this. Loss is computed on these tokens only. Saved as ${esc(t)}=${esc(r.r)}.</span>`;
    return out;
  }

  /* ---------- examples table ---------- */
  function renderTable() {
    const T = TYPES[cur];
    const cols = T.cols;
    const head = `<thead><tr>${cols.map((c) => `<th>${COL[c].h}</th>`).join('')}<th>Target</th><th>Why (GPT-4's reasoning)</th></tr></thead>`;
    const body = T.rows.map((r, i) => `<tr data-i="${i}" class="${i === row ? 'on' : ''}">${cols
      .map((c) => `<td class="${COL[c].cls}">${r[c] ? esc(r[c]) : '<span class="dash">—</span>'}</td>`)
      .join('')}<td class="c-r">${U.chip(cur, r.r)}</td><td class="c-why">${esc(r.why)}</td></tr>`).join('');
    $('ctTable').innerHTML = head + `<tbody>${body}</tbody>`;
    $('ctTable').querySelectorAll('tbody tr').forEach((tr) => (tr.onclick = () => select(cur, +tr.dataset.i)));
  }

  /* ---------- before / after probabilities ---------- */
  // Before: near-uniform (the base LM has never seen these labels). After: mass on GPT-4's label.
  // Small per-row noise keeps rows from looking identical. Illustrative numbers, not model output.
  function seeded(i) { const x = Math.sin((row + 1) * 97 + i * 31 + cur.length * 13) * 10000; return x - Math.floor(x); }
  const softmax = (z) => { const m = Math.max(...z); const e = z.map((v) => Math.exp(v - m)); const s = e.reduce((a, b) => a + b, 0); return e.map((v) => v / s); };
  const TCLS = { Retrieve: 'ret', ISREL: 'rel', ISSUP: 'sup', ISUSE: 'use' };

  function bars(p, t, animate) {
    const best = p.indexOf(Math.max(...p));
    return `<div class="pbars">${TYPES[cur].labels.map((l, i) => {
      const pct = Math.round(p[i] * 100);
      return `<div class="pbar ${i === best ? 'on' : ''} ${i === t ? 'tgt' : ''}"><span class="pbar-l">${U.chip(cur, l)}</span>
        <span class="pbar-t"><i class="t-${TCLS[cur]}" data-w="${pct}" style="width:${animate ? 0 : pct}%"></i></span><span class="pbar-v">${pct}%</span></div>`;
    }).join('')}</div>`;
  }
  function drawTrain() {
    const L = TYPES[cur].labels, t = L.indexOf(TYPES[cur].rows[row].r);
    const before = softmax(L.map((_, i) => (seeded(i) - 0.5) * 0.5));
    const after = softmax(L.map((_, i) => (i === t ? 4.2 + seeded(i + 5) * 0.8 : seeded(i + 9) * 0.6)));
    $('ctBefore').innerHTML = `<div class="ct-before">${bars(before, t, false)}</div>`;
    $('ctProbs').innerHTML = bars(after, t, true);
    requestAnimationFrame(() => requestAnimationFrame(() =>
      $('ctProbs').querySelectorAll('.pbar-t i').forEach((i) => (i.style.width = i.dataset.w + '%'))));
    $('ctWhy').innerHTML = `The critic now predicts ${U.chip(cur, L[t])}, matching GPT-4. It learns this across ~47k mixed examples at once, so it picks up the <b>rule</b>, not just this one row.`;
  }

  /* ---------- selection ---------- */
  function select(t, i = 0, scroll = false) {
    cur = t; row = i;
    document.querySelectorAll('#ctType button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    $('ctMatrix').querySelectorAll('tbody tr').forEach((tr) => tr.classList.toggle('on', tr.dataset.t === t));
    $('ctMix').querySelectorAll('span').forEach((s) => s.classList.toggle('dim', s.dataset.t !== t));
    const T = TYPES[t];
    $('ctSig').innerHTML = `<b>${t}</b> learns&nbsp; p<sub>C</sub>( ${T.labels.map((l) => U.chip(t, l)).join(' ')} <span class="arrow">|</span> ${T.sig.map((s) => s === 'x' ? '<i class="v-x">x</i>' : s === 'd' ? '<i class="v-d">d</i>' : s === 'y' ? '<i class="v-y">y</i>' : `<span class="muted">${s}</span>`).join(', ')} )`;
    $('ctSeq').innerHTML = seqHTML(t, T.rows[i]);
    renderTable();
    drawTrain();
    if (scroll) document.querySelector('.ct-lab').scrollIntoView({ behavior: U.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function init() {
    if (!$('criticTraining')) return;
    renderMatrix();
    document.querySelectorAll('#ctType button').forEach((b) => (b.onclick = () => select(b.dataset.t, 0)));
    select('Retrieve', 0);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
