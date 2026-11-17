'use strict';
let UP = [], DOWN = [];
let CMP = null;             // conference comparison dataset (comparison.json)
let schoolQ = '', schoolSortKey = 'n', schoolSortDir = -1; // school table state
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
  for (const v of ['splash', 'directory', 'downempty', 'player', 'compare', 'comparison']) {
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

/* ---------------- conference comparison ---------------- */
const f1 = x => (x == null ? '—' : Number(x).toFixed(1));
const bookLabel = b => `${esc(b.book)}${b.is_roster ? ' <span class="roster-tag">(roster)</span>' : ''}`;
const cmpNote = html => `<div class="cmp-note">${html}</div>`;

function renderConfTable() {
  const rows = CMP.conference_table.map(b => `
    <tr>
      <td><span class="pname">${bookLabel(b)}</span><br><span class="p-sub">${b.schools} school${b.schools === 1 ? '' : 's'} · ${b.offense_n} off / ${b.defense_n} def</span></td>
      <td class="num">${b.n}</td>
      <td class="num">${f1(b.median_grade)}</td>
      <td class="num">${b.p4_likely}</td>
      <td class="num">${b.p4_starter_likely}</td>
      <td class="num">${b.pct_elig_remaining}% <span class="p-sub">(${b.elig_remaining})</span></td>
      <td class="num">${f1(b.final_year_grade_mass_pct)}%</td>
      <td class="num">${b.hidden_value}</td>
    </tr>`).join('');
  return `<div class="card"><h2 class="sec" style="margin-top:2px">The nine books side by side</h2>
    ${cmpNote('The FCS rows are <b>evaluated cores</b> — the screened, deep-dived players from each Player Book — <b>not full rosters</b>; a conference’s full roster is roughly ten times its core. <b>ULM</b> and <b>UTEP</b> are full evaluated rosters. <b>Grade mass</b> is the sum of headline grades in a group — a concentration proxy that shows where a group’s graded weight sits; it is not a production total.')}
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th>Book</th><th class="num">Players</th><th class="num">Median grade</th><th class="num">P4 at likely</th><th class="num">P4 starters</th><th class="num">Eligibility remaining</th><th class="num">Final-year grade mass</th><th class="num">Hidden Value</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="p-sub">P4 at likely: the band’s likely rung is P4 depth or P4 starter — ${CMP.meta.p4_likely_total} of the 366 banded players, ${CMP.meta.p4_starter_likely_total} of them as P4 starters. The two full rosters sit 9–15 median-grade points below every FCS core; the cores are each conference’s screened top and the rosters are everybody who was evaluated, so the gap measures the screen, not a talent ordering. Eligibility is the qualified determination as printed in the re-issued books.</p></div>`;
}

function renderGrid() {
  let maxN = 1;
  Object.values(CMP.position_grid).forEach(cells => Object.values(cells).forEach(c => { if (c.n > maxN) maxN = c.n; }));
  const head = CMP.positions.map(p => `<th class="ctr">${p}</th>`).join('');
  const rows = CMP.books.map(bk => {
    const b = CMP.conference_table.find(x => x.book === bk);
    const cells = CMP.positions.map(pos => {
      const c = (CMP.position_grid[bk] || {})[pos];
      if (!c) return '<td class="ctr heat-empty">—</td>';
      const a = (0.05 + 0.23 * (c.n / maxN)).toFixed(3);
      return `<td class="ctr" style="background:rgba(15,118,110,${a})"><span class="grid-n">${c.n}</span><span class="grid-sub">P4 ${c.p4_likely} · med ${f1(c.median_grade)}</span></td>`;
    }).join('');
    return `<tr><td><span class="pname">${bookLabel(b)}</span></td>${cells}</tr>`;
  }).join('');
  const posTotals = CMP.positions
    .map(pos => [pos, CMP.books.reduce((s, bk) => s + (((CMP.position_grid[bk] || {})[pos] || {}).p4_likely || 0), 0)])
    .sort((a, b2) => b2[1] - a[1]);
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Conference × position — who has what</h2>
    <p class="p-sub">Each cell: evaluated players at the position, how many project at P4 at likely, and the cell’s median headline grade. Shading deepens with the count. The evaluated universe is 72% defense (302 of 417); LB is the largest group, TE the near-absent one — 7 players of 417, and five books have no evaluated TE at all.</p>
    <div class="tbl-scroll"><table class="ctable grid">
      <thead><tr><th>Book</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="p-sub">The richest cell in the set: <b>Big Sky WR — 13 evaluated, 12 at P4 at likely</b> (3 P4 starter, 9 P4 depth), median grade 75.7. Across all books the P4-at-likely counts run ${posTotals.map(([p, n]) => `${p} ${n}`).join(' · ')}.</p></div>`;
}

function stackBar(r) {
  const t = r.total || 1;
  const seg = (v, cls) => v ? `<span class="${cls}" style="width:${(100 * v / t).toFixed(1)}%"></span>` : '';
  return `<span class="stackbar">${seg(r.Fr, 'sb1')}${seg(r.So, 'sb2')}${seg(r.Jr, 'sb3')}${seg(r['Sr+'], 'sb4')}</span>`;
}

function renderYear() {
  const prow = CMP.year_view.by_position.map(r => `
    <tr><td><span class="pname">${esc(r.position)}</span></td>
      <td class="num">${r.Fr}</td><td class="num">${r.So}</td><td class="num">${r.Jr}</td><td class="num">${r['Sr+']}</td>
      <td>${stackBar(r)}</td>
      <td class="num">${r.total}</td><td class="num">${r.elig_remaining}</td><td class="num">${r.final_year}</td><td class="num">${r.pct_final_year}%</td></tr>`).join('');
  const brow = CMP.year_view.by_book.map(b => `
    <tr><td><span class="pname">${bookLabel(b)}</span></td>
      <td class="num">${b.Fr}</td><td class="num">${b.So}</td><td class="num">${b.Jr}</td><td class="num">${b['Sr+']}</td>
      <td>${stackBar(b)}</td>
      <td class="num">${b.total}</td><td class="num">${b.elig_remaining}</td><td class="num">${b.final_year}</td></tr>`).join('');
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Who has what at what year</h2>
    ${cmpNote('This view is <b>class standing plus eligibility status</b>. Exact years remaining cannot be counted from the site data: a counted-seasons figure is stated in the eligibility basis for only 36 of the 417 players, and two books carry no basis text at all — so seasons used are shown nowhere here rather than filled in where they are not stated. Sr+ standing and final year are not the same thing; the gap is widest at LB (33 Sr+, 8 final-year) and CB (22 Sr+, 4 final-year).')}
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th>Position</th><th class="num">Fr</th><th class="num">So</th><th class="num">Jr</th><th class="num">Sr+</th><th>Class mix</th><th class="num">Total</th><th class="num">Elig. remaining</th><th class="num">Final year</th><th class="num">Final-year share</th></tr></thead>
      <tbody>${prow}</tbody></table></div>
    <p class="p-sub">Every evaluated quarterback has eligibility remaining — 16 of 16, and 8 of the 16 are Fr/So standing. TE carries the highest final-year share of any position (3 of 7, 43%); DI has the largest final-year count (11).</p>
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th>Book</th><th class="num">Fr</th><th class="num">So</th><th class="num">Jr</th><th class="num">Sr+</th><th>Class mix</th><th class="num">Total</th><th class="num">Elig. remaining</th><th class="num">Final year</th></tr></thead>
      <tbody>${brow}</tbody></table></div>
    <p class="p-sub">CAA is the youngest set by construction: zero Sr+ players, 61% Fr/So, all 36 with eligibility remaining. The full rosters carry their final-year players — UTEP 12 of 35, ULM 10 of 38.</p></div>`;
}

function roomRow(r) {
  const fy = (r.final_year_players && r.final_year_players.length)
    ? `<br><span class="p-sub">Final year: ${r.final_year_players.map(esc).join(' · ')}</span>` : '';
  const best = r.best_returning ? `${esc(r.best_returning)} (${f1(r.best_returning_grade)})` : '— none —';
  return `<tr>
    <td><span class="pname">${esc(r.position)}</span>${fy}</td>
    <td class="num">${r.n}</td>
    <td class="num">${f1(r.median_grade)}</td>
    <td>${esc(r.top_player)} <b>${f1(r.top_grade)}</b>${r.top_final_year ? ' <span class="fy-tag">FINAL YEAR</span>' : ''}</td>
    <td class="num">${r.final_year_n} of ${r.n}</td>
    <td><span class="mass-cell"><span class="massbar"><span style="width:${r.grade_mass_final_year_pct || 0}%"></span></span><b>${r.grade_mass_final_year_pct}%</b></span></td>
    <td>${best}</td></tr>`;
}

function renderRooms() {
  const panels = ['ULM', 'UTEP'].map(t => `
    <div class="card"><h2 class="sec" style="margin-top:2px">${t} — room by room (full roster)</h2>
      <div class="tbl-scroll"><table class="ctable">
        <thead><tr><th>Room</th><th class="num">Players</th><th class="num">Median grade</th><th>Top grade</th><th class="num">Final year</th><th>Grade mass in final-year</th><th>Best returning</th></tr></thead>
        <tbody>${(CMP.team_rooms[t] || []).map(roomRow).join('')}</tbody></table></div></div>`).join('');
  const pool = {};
  CMP.pool_context.forEach(r => { (pool[r.scope] = pool[r.scope] || {})[r.position] = r.pool_median; });
  const roomMed = (t, pos) => { const r = (CMP.team_rooms[t] || []).find(x => x.position === pos); return r ? r.median_grade : null; };
  const brows = CMP.positions.map(pos => `<tr><td><span class="pname">${pos}</span></td>
    <td class="num">${f1(roomMed('ULM', pos))}</td><td class="num">${f1((pool['Sun Belt (ULM conf)'] || {})[pos])}</td>
    <td class="num">${f1(roomMed('UTEP', pos))}</td><td class="num">${f1((pool['Mountain West (UTEP conf)'] || {})[pos])}</td></tr>`).join('');
  return panels + `<div class="card"><h2 class="sec" style="margin-top:2px">Conference-pool backdrop</h2>
    <p class="p-sub">Context only: pool medians are every player appearing in the staged 2026 FBS pool at the position, with no volume floor — a backdrop, not the books’ volume-qualified incumbent standard.</p>
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th>Room</th><th class="num">ULM median</th><th class="num">Sun Belt pool</th><th class="num">UTEP median</th><th class="num">Mountain West pool</th></tr></thead>
      <tbody>${brows}</tbody></table></div>
    <p class="p-sub">ULM’s LB room median sits 10.4 points above its conference pool median; UTEP’s CB room 10.9 above its pool. ULM’s QB room median (two players, top grade 56.4) sits 19.2 below the Sun Belt pool median; UTEP’s S room 7.3 below the Mountain West pool median.</p></div>`;
}

function schoolRows() {
  const q = schoolQ.trim().toLowerCase();
  const keyFns = {
    school: s => s.school.toLowerCase(), book: s => s.book,
    n: s => s.n, median_grade: s => (s.median_grade == null ? -1 : s.median_grade),
    top_grade: s => (s.top_grade == null ? -1 : s.top_grade)
  };
  const fn = keyFns[schoolSortKey] || keyFns.n;
  return CMP.schools
    .filter(s => !q || s.school.toLowerCase().includes(q))
    .sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * schoolSortDir; });
}

function renderSchoolBody() {
  const rows = schoolRows();
  if (!rows.length) return '<tr><td colspan="7" class="empty">No schools match that search.</td></tr>';
  return rows.map(s => `<tr>
    <td><span class="pname">${esc(s.school)}</span></td>
    <td>${esc(s.book)}</td>
    <td class="num">${s.n}</td>
    <td>${esc(s.positions)}</td>
    <td class="num">${f1(s.median_grade)}</td>
    <td>${esc(s.top_player)} <span class="p-sub">${esc(s.top_pos)}</span> <b>${f1(s.top_grade)}</b>${s.top_final_year ? ' <span class="fy-tag">FINAL YEAR</span>' : ''}</td>
    <td class="num">${s.elig_remaining} / ${s.final_year}</td>
  </tr>`).join('');
}

function refreshSchools() {
  const body = $('schoolBody');
  if (!body || !CMP) return;
  body.innerHTML = renderSchoolBody();
  const c = $('schoolCount');
  if (c) c.textContent = `${schoolRows().length} of ${CMP.schools.length} schools`;
  document.querySelectorAll('th[data-ssort] .arrow').forEach(a => { a.textContent = ''; });
  const th = document.querySelector(`th[data-ssort="${schoolSortKey}"] .arrow`);
  if (th) th.textContent = schoolSortDir === 1 ? '▲' : '▼';
}

function renderSchools() {
  const th = (key, label, cls) => `<th data-ssort="${key}"${cls ? ` class="${cls}"` : ''}>${label} <span class="arrow">${schoolSortKey === key ? (schoolSortDir === 1 ? '▲' : '▼') : ''}</span></th>`;
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Schools — where the evaluated players sit</h2>
    <p class="p-sub">Every school with an evaluated player, across all nine books. The cores are not spread evenly: Stephen F. Austin holds 16 of Southland’s 66; Chattanooga (14) and Tennessee Tech (14) together hold 28 of SoCon’s 60. “Remaining / Final” counts eligibility remaining against final-year players.</p>
    <div class="school-tools">
      <label class="grow">Search schools
        <input id="schoolQ" type="search" placeholder="School name…" autocomplete="off" value="${esc(schoolQ)}">
      </label>
      <span class="result-count" id="schoolCount"></span>
    </div>
    <div class="tbl-scroll"><table class="ctable" id="schoolTable">
      <thead><tr>${th('school', 'School')}${th('book', 'Book')}${th('n', 'Players', 'num')}<th>Positions</th>${th('median_grade', 'Median grade', 'num')}<th>Top player</th><th class="num">Remaining / Final</th></tr></thead>
      <tbody id="schoolBody">${renderSchoolBody()}</tbody></table></div></div>`;
}

function bindComparison() {
  const q = $('schoolQ');
  if (q) q.addEventListener('input', () => { schoolQ = q.value; refreshSchools(); });
  document.querySelectorAll('th[data-ssort]').forEach(t => t.addEventListener('click', () => {
    const k = t.dataset.ssort;
    if (schoolSortKey === k) schoolSortDir *= -1; else { schoolSortKey = k; schoolSortDir = 1; }
    refreshSchools();
  }));
  refreshSchools();
}

function renderComparison() {
  if (!CMP) {
    return `<div class="card empty-state"><h2 class="empty-title">Conference comparison</h2>
      <p>The comparison data (comparison.json) isn’t part of this build, so this page has nothing to show. The directories and player pages are unaffected.</p>
      <p><a href="#/up">Browse the FCS — Moving Up directory instead →</a></p></div>`;
  }
  return renderConfTable() + renderGrid() + renderYear() + renderRooms() + renderSchools();
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
  if (hash === '#/compare-conferences') {
    setChrome('up');
    showView('comparison');
    $('comparisonBody').innerHTML = renderComparison();
    bindComparison();
    document.title = 'Conference comparison — Player Books';
    window.scrollTo(0, 0);
    return;
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

function loadComparison() {
  // same failure-tolerant pattern: a missing or malformed comparison.json
  // degrades to no comparison data, never an error
  return fetch('comparison.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j) && Array.isArray(j.conference_table)) ? j : null)
    .catch(() => null);
}

Promise.all([loadJson('players.json'), loadJson('players_down.json'), loadComparison()]).then(([up, down, cmp]) => {
  CMP = cmp;
  UP = (Array.isArray(up) ? up : []).map(p => ({ ...p, direction: p.direction || 'up' }));
  DOWN = (Array.isArray(down) ? down : []).map(p => ({ ...p, direction: p.direction || 'down' }));
  UP.forEach(p => { byIdAll[p.id] = p; });
  DOWN.forEach(p => { if (!byIdAll[p.id]) byIdAll[p.id] = p; });
  $('statPlayers').textContent = UP.length + DOWN.length;
  $('statBooks').textContent = new Set([...UP, ...DOWN].map(p => p.conference_book)).size;
  $('upCount').textContent = UP.length;
  $('downCount').textContent = DOWN.length ? DOWN.length : '—';
  $('splashUpMeta').textContent = 'players evaluated';
  $('splashDownMeta').textContent = DOWN.length
    ? 'players evaluated'
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
