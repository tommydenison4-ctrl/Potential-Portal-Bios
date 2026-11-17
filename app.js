'use strict';
let UP = [], DOWN = [];
let PLAYERS = [];           // the current direction's dataset
let byId = {};              // ids in the current dataset
const byIdAll = {};         // every loaded player, both directions (deep links)
let curDir = null;          // 'up' | 'down' once a dataset is active
let sortKey = 'name', sortDir = 1;
const cmpSel = []; // compare selection: player ids, in click order, capped at 3

const DIRS = {
  up:   { label: 'FCS — Moving Up' },
  down: { label: 'P4 — Moving Down' }
};

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = n => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const photo = (p, cls) => p.headshot
  ? `<img class="${cls || 'ph'}" src="headshots/${esc(p.headshot)}" alt="" loading="lazy">`
  : `<span class="${cls || 'ph-init'}">${esc(initials(p.name))}</span>`;
const eligChip = e => `<span class="chip ${e === 'Eligible' ? 'ok' : e === 'Not eligible' ? 'no' : 'un'}">${esc(e)}</span>`;

function fillSelect(sel, values) {
  values.forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
}

const SELECT_DEFAULTS = { 'f-book': 'All books', 'f-pos': 'All positions', 'f-rung': 'Any level' };

function fillFilterSelects() {
  for (const id of ['f-book', 'f-pos', 'f-rung']) {
    const sel = $(id);
    sel.innerHTML = '';
    const o = document.createElement('option');
    o.value = ''; o.textContent = SELECT_DEFAULTS[id];
    sel.appendChild(o);
  }
  fillSelect($('f-book'), [...new Set(PLAYERS.map(p => p.conference_book))].sort());
  fillSelect($('f-pos'), [...new Set(PLAYERS.map(p => p.position))].sort());
  const rungs = [...new Map(PLAYERS.filter(p => p.band).map(p => [p.band.likely, p.band.likely_rung])).entries()]
    .sort((a, b) => a[1] - b[1]).map(e => e[0]);
  fillSelect($('f-rung'), rungs);
}

function setDataset(dir) {
  curDir = dir;
  PLAYERS = dir === 'down' ? DOWN : UP;
  byId = {};
  PLAYERS.forEach(p => byId[p.id] = p);
  cmpSel.length = 0;
  renderCmpTray();
  $('q').value = ''; $('f-elig').value = ''; $('f-hv').checked = false; $('f-ulm').checked = false;
  sortKey = 'name'; sortDir = 1;
  fillFilterSelects();
  $('dirTitle').textContent = DIRS[dir].label;
  const sw = $('dirSwitch');
  if (dir === 'up') { sw.textContent = 'P4 — Moving Down →'; sw.href = '#/down'; }
  else { sw.textContent = '← FCS — Moving Up'; sw.href = '#/up'; }
  applyFilters();
}

function setChrome(dir) {
  // the header shows which direction you're in (none on the title page)
  const chip = $('dirChip');
  if (dir) {
    chip.hidden = false;
    chip.textContent = DIRS[dir].label;
    $('totalChip').textContent = `${(dir === 'down' ? DOWN : UP).length} players`;
  } else {
    chip.hidden = true;
    $('totalChip').textContent = `${UP.length + DOWN.length} players`;
  }
}

function showView(name) {
  for (const v of ['splash', 'directory', 'downempty', 'player', 'compare']) {
    $('view-' + v).hidden = v !== name;
  }
}

function setBackLinks(dir) {
  document.querySelectorAll('.back-dir').forEach(a => { a.href = '#/' + dir; });
}

function currentFilters() {
  return {
    q: $('q').value.trim().toLowerCase(),
    book: $('f-book').value, pos: $('f-pos').value, rung: $('f-rung').value,
    elig: $('f-elig').value, hv: $('f-hv').checked, ulm: $('f-ulm').checked
  };
}

function applyFilters() {
  const f = currentFilters();
  let rows = PLAYERS.filter(p => {
    if (f.q && !(p.name.toLowerCase().includes(f.q) || (p.school || '').toLowerCase().includes(f.q))) return false;
    if (f.book && p.conference_book !== f.book) return false;
    if (f.pos && p.position !== f.pos) return false;
    if (f.rung && (!p.band || p.band.likely !== f.rung)) return false;
    if (f.elig && p.elig_qualified !== f.elig) return false;
    if (f.hv && !p.hidden_value) return false;
    if (f.ulm && !(p.fits && p.fits.ulm_qualifier)) return false;
    return true;
  });
  const keyFns = {
    name: p => p.name.toLowerCase(),
    position: p => p.position,
    school: p => (p.school || '').toLowerCase(),
    grade: p => (p.headline_grade == null ? -1 : p.headline_grade),
    rung: p => (p.band && p.band.likely_rung != null ? p.band.likely_rung : -1)
  };
  const fn = keyFns[sortKey] || keyFns.name;
  rows.sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
  document.querySelectorAll('th[data-sort] .arrow').forEach(a => a.textContent = '');
  const th = document.querySelector(`th[data-sort="${sortKey}"] .arrow`);
  if (th) th.textContent = sortDir === 1 ? '▲' : '▼';
  $('resultCount').textContent = `${rows.length} of ${PLAYERS.length} players`;
  $('dirEmpty').hidden = rows.length > 0;
  $('dirBody').innerHTML = rows.map(p => `
    <tr data-id="${esc(p.id)}">
      <td class="cmp-cell"><input type="checkbox" class="cmp-check" data-cmp="${esc(p.id)}" ${cmpSel.includes(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)} to compare"></td>
      <td>${photo(p)}</td>
      <td><span class="pname">${esc(p.name)}</span>${p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : ''}${p.fits && p.fits.ulm_qualifier ? '<span class="ulm-badge">LM QUALIFIER</span>' : ''}</td>
      <td>${esc(p.position)}</td>
      <td>${esc(p.school)}</td>
      <td>${esc(p.conference_book)}</td>
      <td class="num">${p.headline_grade == null ? '—' : p.headline_grade.toFixed(1)}</td>
      <td>${p.band ? esc(p.band.likely) : 'Pro evaluation only'}</td>
      <td>${eligChip(p.elig_qualified)}</td>
    </tr>`).join('');
}

function listSection(title, items) {
  if (!items || !items.length) return '';
  return `<p class="kv">${esc(title)}</p><ul class="tight">${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
}

function logoImg(r) {
  return r && r.logo ? `<img class="fit-logo" src="logos/${esc(r.logo)}" alt="">` : '';
}

function fitsTable(title, rows) {
  if (!rows || !rows.length) return '';
  return `<p class="kv">${esc(title)}</p><div class="fits-scroll"><table class="fits"><tr><th>School</th><th>Conference</th><th>Incumbent</th><th class="num">Inc. grade</th></tr>
    ${rows.map(r => `<tr><td>${logoImg(r)}${esc(r.school)}</td><td>${esc(r.conf || '')}</td><td>${esc(r.incumbent || '')}</td><td class="num">${r.inc_grade == null ? '—' : Number(r.inc_grade).toFixed(1)}</td></tr>`).join('')}</table></div>`;
}

const PRO_LADDER = ['No verified look', 'Showcase invite', 'Signed', 'Practice squad', 'Roster appearance', 'NFL starter'];

function proLadder(band) {
  const pos = [band.floor_pos, band.likely_pos, band.ceiling_pos];
  if (pos.some(x => x == null)) return '';
  const lo = Math.min(...pos), hi = Math.max(...pos);
  const tags = i => [['Floor', band.floor_pos], ['Likely', band.likely_pos], ['Ceiling', band.ceiling_pos]]
    .filter(t => t[1] === i).map(t => `<span class="pl-tag">${t[0]}</span>`).join('');
  return `<div class="pro-ladder">${PRO_LADDER.map((r, i) =>
    `<div class="pl-rung${i >= lo && i <= hi ? ' in' : ''}${i === band.likely_pos ? ' likely' : ''}"><span class="pl-name">${esc(r)}</span><span class="pl-tags">${tags(i)}</span></div>`).join('')}</div>`;
}

function proSection(p) {
  const pr = p.pro;
  if (!pr) return '';
  const b = pr.band;
  let h = `<div class="card"><h2 class="sec" style="margin-top:2px">Pro track — the two baselines</h2>`;
  if (b) {
    h += proLadder(b);
    h += `<p class="pro-caption"><b>Floor:</b> ${esc(pr.floor_caption || b.floor)} &nbsp;·&nbsp; <b>Most likely:</b> ${esc(b.likely)} &nbsp;·&nbsp; <b>Ceiling:</b> ${esc(b.ceiling)}</p>`;
  }
  if (pr.band_plain) h += `<p class="p-sub">${esc(pr.band_plain)}</p>`;
  if (pr.band_note) h += `<div class="pro-note">${esc(pr.band_note)}</div>`;
  if (pr.baseline1) h += `<p><b>Baseline 1 — production.</b> ${esc(pr.baseline1)}</p>`;
  if (pr.baseline1_note) h += `<p class="p-sub">${esc(pr.baseline1_note)}</p>`;
  if (pr.baseline2) h += `<p><b>Baseline 2 — pedigree.</b> ${esc(pr.baseline2)}</p>`;
  if (pr.baseline2_note) h += `<p>${esc(pr.baseline2_note)}</p>`;
  return h + '</div>';
}

function renderPlayer(p) {
  const vitals = [
    ['Position', p.position], ['School', p.school], ['Book', p.conference_book],
    ['Class', p.listed_class], ['Height', p.height], ['Weight', p.weight],
    ['Hometown', p.hometown]
  ].filter(v => v[1] !== null && v[1] !== undefined && v[1] !== '');
  let h = `<div class="card">
    <div class="p-head">${photo(p)}
      <div>
        <p class="p-name">${esc(p.name)}${p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : ''}${p.fits && p.fits.ulm_qualifier ? '<span class="ulm-badge">LOUISIANA-MONROE QUALIFIER</span>' : ''}</p>
        <p class="p-sub">${vitals.map(v => `${esc(v[0])}: <b>${esc(v[1])}</b>`).join(' &nbsp;·&nbsp; ')}</p>
        <p><span class="grade-big">${p.headline_grade == null ? '—' : p.headline_grade.toFixed(1)}</span> <span class="p-sub">${esc(p.headline_grade_col || 'grade')}</span></p>
        ${p.stat_line ? `<p class="p-sub">${esc(p.stat_line)}</p>` : ''}
        <p>${eligChip(p.elig_qualified)} <span class="p-sub">eligibility — qualified determination</span></p>
      </div>
    </div></div>`;

  h += `<div class="card"><h2 class="sec" style="margin-top:2px">Eligibility</h2>
    <p><b>Qualified:</b> ${esc(p.elig_qualified)}${p.elig_track ? ` <span class="p-sub">(${esc(p.elig_track)})</span>` : ''}</p>
    ${p.elig_basis ? `<p>${esc(p.elig_basis)}</p>` : ''}
    ${p.elig_differs ? `<p><span class="chip book">BOOK: ${esc(p.elig_book.toUpperCase())}</span> <span class="chip ${p.elig_qualified === 'Eligible' ? 'ok' : p.elig_qualified === 'Not eligible' ? 'no' : 'un'}">QUALIFIED: ${esc(p.elig_qualified.toUpperCase())}</span></p><p class="p-sub">The book prints “${esc(p.elig_book)}”; the qualified determination under the current NCAA rules is “${esc(p.elig_qualified)}.”</p>` : `<p class="p-sub">Book: ${esc(p.elig_book)} — the qualified determination agrees with the book.</p>`}
    ${p.eligibility && p.eligibility.note ? `<p class="p-sub">${esc(p.eligibility.note)}</p>` : ''}
  </div>`;

  if (p.bio) h += `<div class="card"><h2 class="sec" style="margin-top:2px">Bio</h2><p>${esc(p.bio)}</p></div>`;

  if ((p.strengths && p.strengths.length) || (p.weaknesses && p.weaknesses.length)) {
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">Strengths &amp; weaknesses</h2><div class="cols">
      <div>${listSection('Strengths', p.strengths)}</div><div>${listSection('Weaknesses', p.weaknesses)}</div></div></div>`;
  }

  if (p.band) {
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">Projection band</h2><div class="band">
      <div class="rung"><b>Floor</b>${esc(p.band.floor)}</div>
      <div class="rung likely"><b>Likely</b>${esc(p.band.likely)}</div>
      <div class="rung"><b>Ceiling</b>${esc(p.band.ceiling)}</div></div>
      ${p.projection_plain ? `<p>${esc(p.projection_plain)}</p>` : ''}</div>`;
  }

  if (p.comps && p.comps.length) {
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">Closest matches</h2><ul class="tight">
      ${p.comps.map(c => `<li>${esc(c.line || c.name || '')}</li>`).join('')}</ul></div>`;
  }

  h += proSection(p);

  if (p.call) {
    const c = p.call;
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">The Call</h2>
      <div class="cols"><div>${listSection('Case for', c.case_for)}</div><div>${listSection('Case against', c.case_against)}</div></div>
      ${c.verdict_college ? `<p class="kv">College verdict</p><div class="verdict">${esc(c.verdict_college)}</div>` : ''}
      ${c.lever_college ? `<p><b>What changes the college call:</b> ${esc(c.lever_college)}</p>` : ''}
      ${c.verdict_pro ? `<p class="kv">Pro verdict</p><div class="verdict">${esc(c.verdict_pro)}</div>` : ''}
      ${c.lever_pro ? `<p><b>What changes the pro call:</b> ${esc(c.lever_pro)}</p>` : ''}
    </div>`;
  }

  if (p.fits && ((p.fits.g6 && p.fits.g6.length) || (p.fits.p4 && p.fits.p4.length) || p.fits.ulm_fit)) {
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">Fits — rooms he would upgrade</h2>
      ${p.fits.benchmark != null ? `<p class="p-sub">Benchmark (his grade after the level-translation adjustment): ${Number(p.fits.benchmark).toFixed(1)}. A fit = his benchmark beats the room's top-graded volume-qualified incumbent.</p>` : ''}
      ${fitsTable('Top G6 fits', p.fits.g6)}
      ${fitsTable(p.conference_book === 'ULM' ? 'P4 fits (as printed)' : 'Top P4 fits', p.fits.p4)}
      ${p.fits.ulm_fit ? `<p class="kv">Louisiana-Monroe</p><div class="fits-scroll"><table class="fits"><tr><th>School</th><th>Conference</th><th>Incumbent</th><th class="num">Inc. grade</th></tr><tr><td>${logoImg(p.fits.ulm_fit)}${esc(p.fits.ulm_fit.school)} <span class="ulm-badge">QUALIFIES</span></td><td>${esc(p.fits.ulm_fit.conf || '')}</td><td>${esc(p.fits.ulm_fit.incumbent || '')}</td><td class="num">${p.fits.ulm_fit.inc_grade == null ? '—' : Number(p.fits.ulm_fit.inc_grade).toFixed(1)}</td></tr></table></div>` : ''}
    </div>`;
  }

  const games = [p.best_game, p.worst_game].filter(Boolean);
  const seasons = [p.best_season, p.worst_season].filter(Boolean);
  if (games.length || seasons.length || p.season_scope_note) {
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">Best &amp; worst</h2>
      ${games.map(g => `<p>${esc(g.line || '')}</p>`).join('')}
      ${seasons.map(s => `<p>${esc(typeof s === 'string' ? s : (s.line || JSON.stringify(s)))}</p>`).join('')}
      ${p.season_scope_note ? `<p class="p-sub">${esc(p.season_scope_note)}</p>` : ''}</div>`;
  }

  if (p.injury_notes || p.transfer_history) {
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">Injury &amp; transfer record</h2>
      ${p.injury_notes ? `<p class="kv">Injury</p><p>${esc(p.injury_notes)}</p>` : ''}
      ${p.transfer_history ? `<p class="kv">Transfers</p><p>${esc(p.transfer_history)}</p>` : ''}</div>`;
  }

  if (p.track_times && p.track_times.length) {
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">Verified speed evidence</h2><ul class="tight">
      ${p.track_times.map(t => `<li>${esc([t.event, t.time, t.timing, t.wind ? 'wind ' + t.wind : '', t.year, t.level_school].filter(Boolean).join(' · '))}${t.source ? ` <span class="p-sub">(${esc(t.source)})</span>` : ''}${t.other_events ? `<br><span class="p-sub">${esc(t.other_events)}</span>` : ''}</li>`).join('')}</ul></div>`;
  }
  return h;
}

/* ---------------- compare up to three players ---------------- */
function cmpCanAdd(id) { return cmpSel.includes(id) || cmpSel.length < 3; }

function syncCmpChecks() {
  document.querySelectorAll('.cmp-check').forEach(cb => { cb.checked = cmpSel.includes(cb.dataset.cmp); });
}

function renderCmpTray(msg) {
  const tray = $('compareTray');
  if (!cmpSel.length) { tray.hidden = true; tray.innerHTML = ''; return; }
  const chips = cmpSel.map(id => {
    const p = byId[id];
    return `<span class="cmp-chip">${esc(p ? p.name : id)} <button type="button" class="cmp-x" data-rm="${esc(id)}" aria-label="Remove ${esc(p ? p.name : id)}">×</button></span>`;
  }).join('');
  tray.innerHTML = `<span class="kv">Compare — ${cmpSel.length} of 3</span>${chips}
    <button type="button" class="btn-print" id="cmpGo" ${cmpSel.length < 2 ? 'disabled' : ''}>Compare</button>
    <span class="p-sub${msg ? ' cmp-warn' : ''}" id="cmpMsg">${esc(msg || (cmpSel.length < 2 ? 'Select at least 2 players.' : ''))}</span>`;
  tray.hidden = false;
  $('cmpGo').addEventListener('click', () => {
    location.hash = '#/compare/' + cmpSel.map(encodeURIComponent).join(',');
  });
}

function bandCell(band) {
  if (!band) return '—';
  return `<span class="cmp-band"><span><b>Floor</b> ${esc(band.floor)}</span><span><b>Likely</b> ${esc(band.likely)}</span><span><b>Ceiling</b> ${esc(band.ceiling)}</span></span>`;
}

function proBandCell(p) {
  if (p.pro && p.pro.band) return bandCell(p.pro.band);
  if (p.call && p.call.verdict_pro) return esc(p.call.verdict_pro);
  return '—';
}

function renderCompare(players) {
  const rows = [
    ['', p => photo(p, 'ph cmp-ph')],
    ['Player', p => `<span class="cmp-name">${esc(p.name)}</span>${p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : ''}`],
    ['Position', p => esc(p.position)],
    ['School', p => esc(p.school)],
    ['Book', p => esc(p.conference_book)],
    ['Class', p => esc(p.listed_class || '—')],
    ['Height', p => esc(p.height || '—')],
    ['Weight', p => esc(p.weight == null ? '—' : p.weight)],
    ['Hometown', p => esc(p.hometown || '—')],
    ['Headline grade', p => p.headline_grade == null ? '—' : `<b>${p.headline_grade.toFixed(1)}</b> <span class="p-sub">${esc(p.headline_grade_col || 'grade')}</span>`],
    ['Stat line', p => esc(p.stat_line || '—')],
    ['Eligibility', p => `${eligChip(p.elig_qualified)}${p.elig_track ? `<br><span class="p-sub">${esc(p.elig_track)}</span>` : ''}`],
    ['Hidden Value', p => p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : '—'],
    ['College band', p => bandCell(p.band)],
    ['Pro band', proBandCell],
    ['Best game', p => esc((p.best_game && p.best_game.line) || '—')],
    ['Strengths', p => (p.strengths && p.strengths.length) ? `<ul>${p.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '—'],
    ['Weaknesses', p => (p.weaknesses && p.weaknesses.length) ? `<ul>${p.weaknesses.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '—'],
    ['Bio', p => esc(p.bio || '—')]
  ];
  return `<div class="cmp-grid" style="--cols:${players.length}">` +
    rows.map(([label, fn]) =>
      `<div class="cmp-label">${esc(label)}</div>` + players.map(p => `<div class="cmp-v">${fn(p)}</div>`).join('')
    ).join('') + '</div>';
}

function route() {
  const hash = location.hash || '';
  const cm = hash.match(/^#\/compare\/(.+)$/);
  if (cm) {
    const ids = cm[1].split(',').map(s => decodeURIComponent(s)).slice(0, 3);
    const ps = ids.map(id => byIdAll[id]).filter(Boolean);
    if (ps.length >= 2) {
      const dir = ps[0].direction || 'up';
      if (curDir !== dir) setDataset(dir);
      setChrome(dir);
      setBackLinks(dir);
      showView('compare');
      $('compareBody').innerHTML = renderCompare(ps);
      document.title = 'Compare players — Player Books';
      window.scrollTo(0, 0);
      return;
    }
  }
  const m = hash.match(/^#\/player\/(.+)$/);
  if (m) {
    const p = byIdAll[decodeURIComponent(m[1])];
    if (p) {
      const dir = p.direction || 'up';
      if (curDir !== dir) setDataset(dir);
      setChrome(dir);
      setBackLinks(dir);
      showView('player');
      $('playerBody').innerHTML = renderPlayer(p);
      document.title = `${p.name} — Player Books`;
      window.scrollTo(0, 0);
      return;
    }
  }
  if (hash === '#/up' || hash === '#/down') {
    const dir = hash === '#/down' ? 'down' : 'up';
    if (curDir !== dir) setDataset(dir);
    setChrome(dir);
    if (dir === 'down' && !DOWN.length) {
      showView('downempty');
      document.title = 'P4 — Moving Down — Player Books';
    } else {
      showView('directory');
      document.title = `${DIRS[dir].label} — Player Books`;
    }
    window.scrollTo(0, 0);
    return;
  }
  // the site root is the title page: choose a direction
  setChrome(null);
  showView('splash');
  document.title = 'Player Books — Player Evaluation Library';
}

function loadJson(url) {
  // a missing file (the P4-down dataset before its first class is built)
  // degrades to an empty dataset, never an error
  return fetch(url)
    .then(r => (r.ok ? r.json() : []))
    .catch(() => []);
}

Promise.all([loadJson('players.json'), loadJson('players_down.json')]).then(([up, down]) => {
  UP = (Array.isArray(up) ? up : []).map(p => ({ ...p, direction: p.direction || 'up' }));
  DOWN = (Array.isArray(down) ? down : []).map(p => ({ ...p, direction: p.direction || 'down' }));
  UP.forEach(p => { byIdAll[p.id] = p; });
  DOWN.forEach(p => { if (!byIdAll[p.id]) byIdAll[p.id] = p; });
  $('splashUpMeta').textContent = `${UP.length} players`;
  $('splashDownMeta').textContent = DOWN.length
    ? `${DOWN.length} players`
    : 'First class in build — the screen is running.';
  ['q', 'f-book', 'f-pos', 'f-rung', 'f-elig', 'f-hv', 'f-ulm'].forEach(id =>
    $(id).addEventListener('input', applyFilters));
  $('reset').addEventListener('click', () => {
    $('q').value = ''; $('f-book').value = ''; $('f-pos').value = ''; $('f-rung').value = '';
    $('f-elig').value = ''; $('f-hv').checked = false; $('f-ulm').checked = false; applyFilters();
  });
  document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
    applyFilters();
  }));
  $('dirBody').addEventListener('click', e => {
    if (e.target.closest('.cmp-cell')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = '#/player/' + encodeURIComponent(tr.dataset.id);
  });
  $('dirBody').addEventListener('change', e => {
    const cb = e.target.closest('.cmp-check');
    if (!cb) return;
    const id = cb.dataset.cmp;
    if (cb.checked) {
      if (!cmpCanAdd(id)) {
        cb.checked = false;
        renderCmpTray('Three is the cap — remove a player to swap one in.');
        return;
      }
      if (!cmpSel.includes(id)) cmpSel.push(id);
    } else {
      const i = cmpSel.indexOf(id);
      if (i >= 0) cmpSel.splice(i, 1);
    }
    renderCmpTray();
  });
  $('compareTray').addEventListener('click', e => {
    const x = e.target.closest('[data-rm]');
    if (!x) return;
    const i = cmpSel.indexOf(x.dataset.rm);
    if (i >= 0) cmpSel.splice(i, 1);
    renderCmpTray();
    syncCmpChecks();
  });
  setDataset('up');
  route();
}).catch(err => {
  $('resultCount').textContent = 'Could not load players.json — ' + err.message;
});
$('printBtn').addEventListener('click', () => window.print());
$('printBtnCmp').addEventListener('click', () => window.print());
window.addEventListener('hashchange', route);
