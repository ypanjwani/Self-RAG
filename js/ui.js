// Small UI helpers: reflection-token chips and probability bars.
(function () {
  const SR = window.SR;
  const esc = SR.text.esc;

  const DESC = {
    Retrieve: 'Retrieve: should the model look something up?',
    ISREL: 'ISREL: is the passage relevant to the question?',
    ISSUP: 'ISSUP: is the written segment supported by the passage?',
    ISUSE: 'ISUSE: how useful is the answer? (5 = best)'
  };
  const CLS = { Retrieve: 't-ret', ISREL: 't-rel', ISSUP: 't-sup', ISUSE: 't-use' };

  function quality(type, v) {
    if (type === 'ISREL') return v === 'Relevant' ? 'good' : 'bad';
    if (type === 'ISSUP') return v === 'Fully' ? 'good' : v === 'Partially' ? 'mid' : 'bad';
    if (type === 'ISUSE') { const n = +v; return n >= 4 ? 'good' : n === 3 ? 'mid' : 'bad'; }
    return 'none';
  }

  function chip(type, v, extra = '') {
    return `<span class="chip ${CLS[type]} q-${quality(type, v)} ${extra}" title="${esc(DESC[type])}"><span class="ck">${type}</span><span class="ce">=</span><span class="cv">${esc(String(v))}</span></span>`;
  }

  function docChip(id, extra = '') {
    return `<span class="chip t-doc ${extra}" title="A retrieved passage">${esc(id)}</span>`;
  }

  const fmt = (x, d = 2) => Number(x).toFixed(d);

  function probBars(probs, type, chosen) {
    return `<div class="pbars">${Object.keys(probs)
      .map((k) => {
        const pct = Math.round(probs[k] * 100);
        return `<div class="pbar ${k === chosen ? 'on' : ''}">
          <span class="pbar-l">${chip(type, k)}</span>
          <span class="pbar-t"><i class="${CLS[type]}" style="width:${pct}%"></i></span>
          <span class="pbar-v">${pct}%</span></div>`;
      })
      .join('')}</div>`;
  }

  const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  SR.ui = { chip, docChip, fmt, probBars, quality, reducedMotion, DESC };
})();
