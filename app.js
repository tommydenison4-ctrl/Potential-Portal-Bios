'use strict';
let UP = [], DOWN = [];
let CMP = null;             // conference comparison dataset (comparison.json)
let TEAMS = null;           // team comparison dataset (teams.json)
const teamSet = [];         // selected team names on the team comparison page, in pick order
const TEAM_CAP = 4;         // side-by-side team comparison cap
let teamOrder = 'position'; // team page room order: 'position' | 'priority'
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

/* -------- directory filters: multi-select dropdown panels --------
   Each filter is a button (filter name, plus "· N" while selections
   are active) opening a panel of checkboxes. Ticked values are OR
   within a filter and AND across filters; nothing ticked = no
   restriction (the old selects' blank option). */
const FILTER_DEFS = [
  { id: 'f-book', name: 'Conference book',
    values: () => [...new Set(PLAYERS.map(p => p.conference_book))].sort(),
    test: (p, set) => !set.size || set.has(p.conference_book) },
  { id: 'f-pos', name: 'Position',
    values: () => [...new Set(PLAYERS.map(p => p.position))].sort(),
    test: (p, set) => !set.size || set.has(p.position) },
  { id: 'f-rung', name: 'Band — likely',
    values: () => [...new Map(PLAYERS.filter(p => p.band).map(p => [p.band.likely, p.band.likely_rung])).entries()]
      .sort((a, b) => a[1] - b[1]).map(e => e[0]),
    test: (p, set) => !set.size || (!!p.band && set.has(p.band.likely)) },
  { id: 'f-elig', name: 'Eligibility (qualified)',
    values: () => ['Eligible', 'Not eligible', 'Unsettled'],
    test: (p, set) => !set.size || set.has(p.elig_qualified) }
];
const filterSel = {};
FILTER_DEFS.forEach(d => { filterSel[d.id] = new Set(); });
const filterDef = id => FILTER_DEFS.find(d => d.id === id);
const msWrap = id => document.querySelector(`.ms[data-ms="${id}"]`);

function updateMsButton(def) {
  const n = filterSel[def.id].size;
  const btn = $(def.id);
  btn.innerHTML = `${esc(def.name)}${n ? ` · ${n}` : ''} <span class="ms-caret">▾</span>`;
  btn.classList.toggle('ms-on', n > 0);
}

function buildFilterPanels() {
  FILTER_DEFS.forEach(def => {
    msWrap(def.id).querySelector('.ms-opts').innerHTML = def.values().map(v =>
      `<label class="ms-opt"><input type="checkbox" value="${esc(v)}"${filterSel[def.id].has(v) ? ' checked' : ''}> ${esc(v)}</label>`).join('');
    updateMsButton(def);
  });
}

function clearFilter(id) {
  filterSel[id].clear();
  msWrap(id).querySelectorAll('.ms-opt input').forEach(cb => { cb.checked = false; });
  updateMsButton(filterDef(id));
}

function clearAllFilters() { FILTER_DEFS.forEach(d => clearFilter(d.id)); }

let openMsId = null;
function closeMs() {
  if (!openMsId) return;
  msWrap(openMsId).querySelector('.ms-panel').hidden = true;
  $(openMsId).setAttribute('aria-expanded', 'false');
  openMsId = null;
}
function toggleMs(id) {
  if (openMsId === id) { closeMs(); return; }
  closeMs();
  msWrap(id).querySelector('.ms-panel').hidden = false;
  $(id).setAttribute('aria-expanded', 'true');
  openMsId = id;
}

function setDataset(dir) {
  curDir = dir;
  PLAYERS = dir === 'down' ? DOWN : UP;
  byId = {};
  PLAYERS.forEach(p => byId[p.id] = p);
  cmpSel.length = 0;
  renderCmpTray();
  $('q').value = ''; clearAllFilters(); $('f-hv').checked = false; $('f-ulm').checked = false;
  sortKey = 'name'; sortDir = 1;
  closeMs();
  buildFilterPanels();
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
  for (const v of ['splash', 'directory', 'downempty', 'player', 'compare', 'comparison', 'teamcmp']) {
    $('view-' + v).hidden = v !== name;
  }
}

function setBackLinks(dir) {
  document.querySelectorAll('.back-dir').forEach(a => { a.href = '#/' + dir; });
}

function currentFilters() {
  return {
    q: $('q').value.trim().toLowerCase(),
    hv: $('f-hv').checked, ulm: $('f-ulm').checked
  };
}

function applyFilters() {
  const f = currentFilters();
  let rows = PLAYERS.filter(p => {
    if (f.q && !(p.name.toLowerCase().includes(f.q) || (p.school || '').toLowerCase().includes(f.q))) return false;
    for (const def of FILTER_DEFS) if (!def.test(p, filterSel[def.id])) return false;
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

/* ---------------- team comparison ---------------- */
function teamBtnLabel() {
  const btn = $('t-team');
  btn.innerHTML = teamSet.length
    ? `Teams — ${teamSet.length} selected <span class="ms-caret">▾</span>`
    : `Teams <span class="ms-caret">▾</span>`;
  btn.classList.toggle('ms-on', teamSet.length > 0);
}

function teamCapNoteSync() {
  const note = $('teamCapNote');
  if (note) note.hidden = teamSet.length < TEAM_CAP;
}

function buildTeamPanel() {
  const box = $('teamOpts');
  if (!TEAMS) { box.innerHTML = ''; return; }
  const q = ($('teamQ').value || '').trim().toLowerCase();
  let html = '';
  for (const conf of TEAMS.meta.conference_order) {
    const ts = TEAMS.teams.filter(t => t.conf === conf && (!q || t.name.toLowerCase().includes(q)));
    if (!ts.length) continue;
    html += `<div class="ms-group">${esc(conf)}</div>` + ts.map(t =>
      `<label class="ms-opt"><input type="checkbox" value="${esc(t.name)}"${teamSet.includes(t.name) ? ' checked' : ''}> ${esc(t.name)}</label>`).join('');
  }
  box.innerHTML = html || '<p class="p-sub" style="padding:6px 8px">No teams match that search.</p>';
  teamCapNoteSync();
}

function toggleTeam(name, on) {
  const i = teamSet.indexOf(name);
  if (on && i < 0) {
    if (teamSet.length >= TEAM_CAP) { teamCapNoteSync(); return; }
    teamSet.push(name);
  } else if (!on && i >= 0) {
    teamSet.splice(i, 1);
  } else {
    return;
  }
  teamBtnLabel();
  teamCapNoteSync();
  renderTeam();
}

function clearTeams() {
  if (!teamSet.length) return;
  teamSet.length = 0;
  teamBtnLabel();
  buildTeamPanel();
  renderTeam();
}

/* The two level standards are the same for every team: each room's
   g6_median is carried in every team's data, and the P4 median is the
   level_median carried by every P4 team. Derive both per group once. */
function levelMedians() {
  const m = {};
  for (const g of TEAMS.meta.groups) {
    let g6 = null, p4 = null;
    for (const t of TEAMS.teams) {
      const r = t.rooms[g];
      if (g6 == null && r.g6_median != null) g6 = r.g6_median;
      if (p4 == null && t.level === 'P4' && r.level_median != null) p4 = r.level_median;
      if (g6 != null && p4 != null) break;
    }
    m[g] = { g6, p4 };
  }
  return m;
}

function teamSummary(t) {
  const gs = TEAMS.meta.groups;
  const withInc = gs.filter(g => t.rooms[g].incumbent);
  const aboveConf = withInc.filter(g => t.rooms[g].gap_conf != null && t.rooms[g].gap_conf >= 0).length;
  const aboveLvl = withInc.filter(g => t.rooms[g].gap_level != null && t.rooms[g].gap_level >= 0).length;
  let worst = null;
  for (const g of withInc) {
    const v = t.rooms[g].gap_level;
    if (v != null && (!worst || v < worst.v)) worst = { g, v };
  }
  const totalCand = gs.reduce((s, g) => s + t.rooms[g].cand_total, 0);
  return { n: withInc.length, aboveConf, aboveLvl, worst, totalCand };
}

function renderTeamMatrix(sel) {
  const med = levelMedians();
  const gs = TEAMS.meta.groups;
  const head1 = sel.map(t => `<th colspan="4" class="mt-team">${t.logo ? `<img class="mt-logo" src="logos/${esc(t.logo)}" alt="">` : ''}<span class="mt-name">${esc(t.name)}</span><span class="mt-sub">${esc(t.conf)} · ${esc(t.level)}</span></th>`).join('');
  const head2 = sel.map(() => '<th class="num">Inc. grade</th><th class="num">vs Conf</th><th class="num">vs G6</th><th class="num">vs P4</th>').join('');
  const rows = gs.map(g => {
    const grades = sel.map(t => (t.rooms[g].incumbent && !t.rooms[g].below_bar ? t.rooms[g].inc_grade : null));
    const live = grades.filter(v => v != null);
    const best = live.length > 1 ? Math.max(...live) : null;
    const cells = sel.map((t, i) => {
      const r = t.rooms[g];
      if (!r.incumbent) return '<td class="num">—</td>' + gapCell(null) + gapCell(null) + gapCell(null);
      const gc = r.conf_median == null ? null : r.inc_grade - r.conf_median;
      const gg = med[g].g6 == null ? null : r.inc_grade - med[g].g6;
      const gp = med[g].p4 == null ? null : r.inc_grade - med[g].p4;
      if (r.below_bar) return `<td class="num bb"><b>${f1(r.inc_grade)}*</b></td>` + gapCell(gc) + gapCell(gg) + gapCell(gp);
      const cls = best != null && grades[i] === best ? 'num mt-best' : 'num';
      return `<td class="${cls}"><b>${f1(r.inc_grade)}</b></td>` + gapCell(gc) + gapCell(gg) + gapCell(gp);
    }).join('');
    return `<tr><td><span class="pname">${esc(g)}</span></td>${cells}</tr>`;
  }).join('');
  const chips = sel.map(t => {
    const s = teamSummary(t);
    const worst = s.worst
      ? `Biggest deficit vs the ${esc(t.level)} median: ${esc(s.worst.g)} (${s.worst.v > 0 ? '+' : ''}${Number(s.worst.v).toFixed(1)})`
      : 'No room with a qualified incumbent';
    return `<div class="mt-chip"><p class="mt-chip-name">${esc(t.name)}</p>
      <p class="p-sub">${s.aboveConf} of ${s.n} rooms at or above its conference median · ${s.aboveLvl} of ${s.n} at or above the ${esc(t.level)} median</p>
      <p class="p-sub">${worst} · ${s.totalCand} evaluated players clear one of its bars</p></div>`;
  }).join('');
  const stdRows = gs.map(g => `<tr><td><span class="pname">${esc(g)}</span></td><td class="num">${f1(med[g].g6)}</td><td class="num">${f1(med[g].p4)}</td></tr>`).join('');
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Side by side — each team against its conference, the G6 and the P4</h2>
    ${cmpNote('Every gap is the room’s <b>incumbent grade minus the median of team incumbents</b> for that standard: a positive gap is above the standard, a negative gap below it. <b>vs Conf</b> uses each team’s own conference; <b>vs G6</b> and <b>vs P4</b> use the two level medians, which are the same for every team and are listed under the table. The strongest qualified incumbent grade in a room is shaded. An <b>asterisked grade</b> is a room with no volume-qualified incumbent, carried by its top player by volume and flagged — its gaps print, but no upgrade candidates are computed for it. The pool is a <b>Nov 17, 2026 in-season snapshot</b> of PFF Ultimate exports, and grades are PFF headline grades.')}
    <div class="mt-chips">${chips}</div>
    <div class="tbl-scroll"><table class="ctable mtable">
      <thead><tr><th rowspan="2">Room</th>${head1}</tr><tr>${head2}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="kv" style="margin-top:14px">The standards — median incumbent grade by room</p>
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th>Room</th><th class="num">G6 median</th><th class="num">P4 median</th></tr></thead>
      <tbody>${stdRows}</tbody></table></div>
    <p class="p-sub">Each team’s full room table — its own conference median, conference rank and room median — and its evaluated upgrade candidates follow below, one card per team.</p>
  </div>`;
}

const gapSortKey = r => (r.gap_level == null ? Infinity : r.gap_level);

function teamGroupsOrdered(t) {
  const gs = TEAMS.meta.groups.slice();
  if (teamOrder === 'priority') gs.sort((a, b) => gapSortKey(t.rooms[a]) - gapSortKey(t.rooms[b]));
  return gs;
}

function gapCell(v) {
  if (v == null) return '<td class="num">—</td>';
  const cls = v < 0 ? 'gap-neg' : v > 0 ? 'gap-pos' : '';
  return `<td class="num ${cls}">${v > 0 ? '+' : ''}${Number(v).toFixed(1)}</td>`;
}

function teamRoomRow(t, g) {
  const r = t.rooms[g];
  const candCell = r.candidates_pending
    ? '<td class="num"><span class="p-sub">Pending Δ</span></td>'
    : r.below_bar
      ? '<td class="num"><span class="p-sub">—*</span></td>'
      : `<td class="num">${r.cand_total}</td>`;
  if (r.below_bar) {
    return `<tr><td><span class="pname">${esc(g)}</span></td>
      <td>${esc(r.incumbent)}<br><span class="p-sub">top by volume — ${r.inc_vol} of ${r.vol_bar} ${esc(r.vol_unit)}, below the bar</span></td>
      <td class="num bb"><b>${f1(r.inc_grade)}*</b></td>
      <td class="num">—</td>
      <td class="num">0</td>
      <td class="num">${f1(r.conf_median)}</td><td class="num">${f1(r.level_median)}</td>
      <td class="num">—</td>${gapCell(r.gap_conf)}${gapCell(r.gap_level)}${candCell}</tr>`;
  }
  if (!r.incumbent) {
    return `<tr><td><span class="pname">${esc(g)}</span></td>
      <td><span class="p-sub">— none qualified —</span></td>
      <td class="num">—</td><td class="num">—</td><td class="num">0</td>
      <td class="num">${f1(r.conf_median)}</td><td class="num">${f1(r.level_median)}</td>
      <td class="num">—</td>${gapCell(null)}${gapCell(null)}${candCell}</tr>`;
  }
  return `<tr><td><span class="pname">${esc(g)}</span></td>
    <td>${esc(r.incumbent)}</td>
    <td class="num"><b>${f1(r.inc_grade)}</b></td>
    <td class="num">${f1(r.median)}</td>
    <td class="num">${r.n}</td>
    <td class="num">${f1(r.conf_median)}</td>
    <td class="num">${f1(r.level_median)}</td>
    <td class="num">${r.conf_rank} of ${r.conf_teams}</td>
    ${gapCell(r.gap_conf)}${gapCell(r.gap_level)}${candCell}</tr>`;
}

function candBlock(t, g) {
  const r = t.rooms[g];
  const head = `<p class="kv">${esc(g)} — upgrade candidates</p>`;
  if (r.candidates_pending) {
    return `<div class="cand-block">${head}<p>Upgrade candidates pending the OL translation delta — no OL fits print before the OL cohort delta exists, so this room shows grades and gaps only.</p></div>`;
  }
  if (r.below_bar) {
    return `<div class="cand-block">${head}<p>No volume-qualified incumbent in this room — the line above is its top player by volume, ${esc(r.incumbent)} (${r.inc_vol} of ${r.vol_bar} ${esc(r.vol_unit)}), carried flagged. The strict test needs a qualified bar to clear, so no upgrade candidates are named for this room.</p></div>`;
  }
  if (!r.incumbent) {
    return `<div class="cand-block">${head}<p>No volume-qualified incumbent in the pool snapshot — the strict test has no bar to clear, so no upgrade candidates are named for this room.</p></div>`;
  }
  if (!r.cand_total) {
    return `<div class="cand-block">${head}<p>No evaluated player clears this room’s bar — the incumbent is ${esc(r.incumbent)} at ${f1(r.inc_grade)}.</p></div>`;
  }
  const rows = r.cand.map(c => `<tr>
    <td><a href="#/player/${esc(encodeURIComponent(c.id))}"><span class="pname">${esc(c.name)}</span></a></td>
    <td>${esc(c.book)}</td><td>${esc(c.school)}</td>
    <td class="num">${f1(c.grade)}</td><td class="num"><b>${f1(c.benchmark)}</b></td></tr>`).join('');
  const more = r.cand_total > r.cand.length
    ? `<p class="p-sub">Top ${r.cand.length} shown by benchmark — ${r.cand_total - r.cand.length} more evaluated player${r.cand_total - r.cand.length === 1 ? '' : 's'} also clear${r.cand_total - r.cand.length === 1 ? 's' : ''} the bar.</p>` : '';
  return `<div class="cand-block">${head}
    <p class="p-sub">${r.cand_total} evaluated player${r.cand_total === 1 ? '' : 's'} clear the bar (incumbent ${esc(r.incumbent)}, ${f1(r.inc_grade)}).</p>
    <div class="fits-scroll"><table class="fits"><tr><th>Player</th><th>Book</th><th>School</th><th class="num">Grade</th><th class="num">Benchmark</th></tr>${rows}</table></div>${more}</div>`;
}

/* ---------------- team comparison charts ---------------- */
const TEAM_COLORS = ['#1d4ed8', '#d97706', '#059669', '#dc2626'];

/* Horizontal bars: each room's gap to the team's own level median,
   biggest deficit first. Below-bar rooms are drawn faded and asterisked. */
function gapChart(t) {
  const rows = TEAMS.meta.groups
    .filter(g => t.rooms[g].incumbent && t.rooms[g].gap_level != null)
    .map(g => ({ g, v: t.rooms[g].gap_level, bb: !!t.rooms[g].below_bar }))
    .sort((a, b) => a.v - b.v);
  if (!rows.length) return '';
  const W = 660, L = 170, R = 646, rowH = 25, top = 8;
  const H = top * 2 + rows.length * rowH;
  const maxAbs = Math.max(6, ...rows.map(r => Math.abs(r.v)));
  const zero = L + (R - L) / 2;
  const X = v => zero + (v / maxAbs) * ((R - L) / 2);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Room gaps versus the ${esc(t.level)} median">`;
  s += `<line x1="${zero}" y1="2" x2="${zero}" y2="${H - 2}" stroke="#9aa3af" stroke-width="1"/>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const x = X(r.v);
    const bx = Math.min(zero, x), bw = Math.max(2, Math.abs(x - zero));
    const fill = r.v >= 0 ? '#1a7f37' : '#c0392b';
    const lab = r.v >= 0 ? `${x + 6}` : `${x - 6}`;
    const anch = r.v >= 0 ? 'start' : 'end';
    s += `<text x="0" y="${y + 15}" class="ch-room">${esc(r.g)}${r.bb ? '*' : ''}</text>`;
    s += `<rect x="${bx.toFixed(1)}" y="${y + 4}" width="${bw.toFixed(1)}" height="15" rx="2" fill="${fill}"${r.bb ? ' fill-opacity="0.45"' : ''}/>`;
    s += `<text x="${lab}" y="${y + 16}" text-anchor="${anch}" class="ch-val">${r.v > 0 ? '+' : ''}${r.v.toFixed(1)}</text>`;
  });
  s += '</svg>';
  return `<div class="card"><h2 class="sec" style="margin-top:2px">${esc(t.name)} — room gaps vs the ${esc(t.level)} median</h2>
    <p class="p-sub">Each bar is the room’s incumbent grade minus the ${esc(t.level)} median incumbent grade, biggest deficit first. Faded, asterisked bars are below-bar rooms — the top player by volume, carried flagged.</p>${s}</div>`;
}

/* Distribution strips: every FBS team's qualified incumbent grade in the
   room as a dot, the two level medians as ticks, the selected teams as
   large coloured dots (hollow when the room is carried below the bar). */
function distChart(sel) {
  const med = levelMedians();
  const gs = TEAMS.meta.groups;
  const W = 660, L = 46, R = 646, stripH = 38, top = 30;
  const H = top + gs.length * stripH + 22;
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Where the selected teams sit in each room's national distribution">`;
  s += `<text x="${L}" y="14" class="ch-leg">● selected team</text>`;
  s += `<text x="${L + 130}" y="14" class="ch-leg">○ below the volume bar</text>`;
  s += `<line x1="${L + 268}" y1="4" x2="${L + 268}" y2="16" stroke="#94a3b8" stroke-width="2"/><text x="${L + 274}" y="14" class="ch-leg">G6 median</text>`;
  s += `<line x1="${L + 352}" y1="4" x2="${L + 352}" y2="16" stroke="#475569" stroke-width="2"/><text x="${L + 358}" y="14" class="ch-leg">P4 median</text>`;
  gs.forEach((g, gi) => {
    const vals = [];
    for (const t of TEAMS.teams) {
      const r = t.rooms[g];
      if (r.incumbent && !r.below_bar) vals.push(r.inc_grade);
    }
    if (!vals.length) return;
    let lo = Math.min(...vals, med[g].g6 ?? 999, med[g].p4 ?? 999);
    let hi = Math.max(...vals, med[g].g6 ?? -999, med[g].p4 ?? -999);
    lo = Math.floor(lo - 2); hi = Math.ceil(hi + 2);
    const X = v => L + ((v - lo) / (hi - lo)) * (R - L);
    const y = top + gi * stripH + stripH / 2;
    s += `<text x="0" y="${y + 4}" class="ch-room">${esc(g)}</text>`;
    s += `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="#e5e9ef" stroke-width="1"/>`;
    vals.forEach((v, i) => {
      const jy = y + (((i * 7) % 9) - 4);
      s += `<circle cx="${X(v).toFixed(1)}" cy="${jy}" r="2.4" fill="#c3cad4"/>`;
    });
    if (med[g].g6 != null) s += `<line x1="${X(med[g].g6)}" y1="${y - 10}" x2="${X(med[g].g6)}" y2="${y + 10}" stroke="#94a3b8" stroke-width="2"/>`;
    if (med[g].p4 != null) s += `<line x1="${X(med[g].p4)}" y1="${y - 10}" x2="${X(med[g].p4)}" y2="${y + 10}" stroke="#475569" stroke-width="2"/>`;
    sel.forEach((t, ti) => {
      const r = t.rooms[g];
      if (!r.incumbent) return;
      const cx = X(r.inc_grade);
      s += r.below_bar
        ? `<circle cx="${cx.toFixed(1)}" cy="${y}" r="5.5" fill="#fff" stroke="${TEAM_COLORS[ti]}" stroke-width="2.5"><title>${esc(t.name)} — ${esc(g)}: ${esc(r.incumbent)}, ${f1(r.inc_grade)} (below the volume bar)</title></circle>`
        : `<circle cx="${cx.toFixed(1)}" cy="${y}" r="5.5" fill="${TEAM_COLORS[ti]}" stroke="#fff" stroke-width="1.5"><title>${esc(t.name)} — ${esc(g)}: ${esc(r.incumbent)}, ${f1(r.inc_grade)}</title></circle>`;
    });
    if (gi === gs.length - 1) {
      for (const tick of [50, 60, 70, 80, 90]) {
        if (tick < lo || tick > hi) continue;
        s += `<text x="${X(tick)}" y="${y + 26}" text-anchor="middle" class="ch-leg">${tick}</text>`;
      }
    }
  });
  s += '</svg>';
  const chips = sel.map((t, ti) => `<span class="dist-chip"><span class="dist-dot" style="background:${TEAM_COLORS[ti]}"></span>${esc(t.name)}</span>`).join('');
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Where they sit — every FBS incumbent, room by room</h2>
    <p class="p-sub">One dot per FBS team’s volume-qualified incumbent in the room; the ticks are the G6 and P4 median incumbent grades. ${chips}</p>${s}
    <p class="p-sub">A hollow dot is a below-bar room — the team’s top player by volume, carried flagged; he is not part of the dot field, which is qualified incumbents only.</p></div>`;
}

function renderTeam() {
  const body = $('teamBody');
  if (!TEAMS) {
    body.innerHTML = `<div class="card empty-state"><h2 class="empty-title">Team comparison</h2>
      <p>The team data (teams.json) isn’t part of this build, so this page has nothing to show. The directories and player pages are unaffected.</p>
      <p><a href="#/up">Browse the FCS — Moving Up directory instead →</a></p></div>`;
    return;
  }
  const sel = teamSet.map(n => TEAMS.teams.find(x => x.name === n)).filter(Boolean);
  if (!sel.length) {
    body.innerHTML = `<div class="card empty-state"><h2 class="empty-title">Pick up to four teams</h2>
      <p>Tick teams in the picker above — one of the ${TEAMS.teams.length} FBS teams for its full page, or up to four to compare them side by side. Every room is measured against the team’s own conference and against both levels, the G6 and the P4, with the evaluated players who would upgrade each room.</p></div>`;
    return;
  }
  let h = '';
  if (sel.length >= 2) h += renderTeamMatrix(sel);
  h += distChart(sel);
  h += sel.map(t => teamCard(t)).join('');
  body.innerHTML = h;
}

function teamCard(t) {
  const gs = teamGroupsOrdered(t);
  const roomsWith = TEAMS.meta.groups.filter(g => t.rooms[g].incumbent && !t.rooms[g].below_bar).length;
  const roomsBelow = TEAMS.meta.groups.filter(g => t.rooms[g].below_bar).length;
  const totalCand = TEAMS.meta.groups.reduce((s, g) => s + t.rooms[g].cand_total, 0);
  let h = `<div class="card"><div class="team-head">
    ${t.logo ? `<img class="team-logo" src="logos/${esc(t.logo)}" alt="">` : ''}
    <div>
      <p class="p-name">${esc(t.name)}</p>
      <p class="p-sub">${esc(t.conf)} · ${esc(t.level)}</p>
      <p class="p-sub">${roomsWith} of ${TEAMS.meta.groups.length} rooms have a volume-qualified incumbent in the pool snapshot${roomsBelow ? ` · ${roomsBelow} carried below the bar by the top player by volume` : ''} · ${totalCand} evaluated players clear one of its bars</p>
    </div></div>
    ${cmpNote('How to read this page: the pool is a <b>Nov 17, 2026 in-season snapshot</b> of PFF Ultimate exports, and grades are PFF headline grades. The <b>incumbent</b> is each room’s top-graded <b>volume-qualified</b> player under the books’ fits bars (for example TE ≥ 20 targets, OL ≥ 200 snaps). A room with no qualified player is <b>carried by its top player by volume</b>, flagged with an asterisk and his volume against the bar — his gaps print, but no candidates are named for that room. Conference and level medians are medians of team incumbents — the level median is the G6 median for a G6 team, the P4 median for a P4 team. <b>Upgrade candidates</b> are the evaluated players from the nine books whose benchmark — headline grade plus the position’s translation delta — beats the incumbent: the same strict test the books print.')}
    <div class="team-sort"><span class="kv">Room order</span>
      <button type="button" class="btn-ghost${teamOrder === 'position' ? ' on' : ''}" data-torder="position">Position</button>
      <button type="button" class="btn-ghost${teamOrder === 'priority' ? ' on' : ''}" data-torder="priority">Upgrade priority</button>
      <span class="p-sub">Upgrade priority sorts rooms by gap to the ${esc(t.level)} median, biggest deficit first — a gap ranking, not a verdict.</span>
    </div>
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th>Room</th><th>Incumbent</th><th class="num">Inc. grade</th><th class="num">Room median</th><th class="num">Qualified</th><th class="num">Conf median</th><th class="num">${esc(t.level)} median</th><th class="num">Conf rank</th><th class="num">Gap vs conf</th><th class="num">Gap vs ${esc(t.level)}</th><th class="num">Candidates</th></tr></thead>
      <tbody>${gs.map(g => teamRoomRow(t, g)).join('')}</tbody></table></div>
  </div>`;

  h += gapChart(t);

  h += `<div class="card"><h2 class="sec" style="margin-top:2px">Recommended upgrades — room by room</h2>
    <p class="p-sub">For each room, the evaluated players whose benchmark clears ${esc(t.name)}’s incumbent, ranked by benchmark. A name here is the books’ strict test applied to this team — nothing more, nothing less.</p>
    ${gs.map(g => candBlock(t, g)).join('')}</div>`;

  if (t.roster) {
    const rrows = TEAMS.meta.groups.filter(g => t.roster[g]).map(g => {
      const r = t.roster[g];
      const best = r.best_returning ? `${esc(r.best_returning)} (${f1(r.best_returning_grade)})` : '— none —';
      return `<tr><td><span class="pname">${esc(g)}</span></td>
        <td class="num">${r.n}</td><td class="num">${r.final_year_n} of ${r.n}</td><td>${best}</td></tr>`;
    }).join('');
    h += `<div class="card"><h2 class="sec" style="margin-top:2px">${esc(t.name)} — the book’s roster layer</h2>
      <p class="p-sub">From ${esc(t.name)}’s own Player Book (the evaluated roster, as carried by the conference comparison): how many of the room’s evaluated players are in their final year, and the best grade coming back. The books predate the OL integration, so this layer covers the nine book groups — no OL row.</p>
      <div class="tbl-scroll"><table class="ctable">
        <thead><tr><th>Room</th><th class="num">Evaluated</th><th class="num">Final year</th><th>Best returning</th></tr></thead>
        <tbody>${rrows}</tbody></table></div></div>`;
  }
  return h;
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
  if (hash === '#/team-comparison') {
    setChrome(null);
    showView('teamcmp');
    renderTeam();
    document.title = 'Team comparison — Player Books';
    window.scrollTo(0, 0);
    return;
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

function loadTeams() {
  // same failure-tolerant pattern: a missing or malformed teams.json
  // degrades to no team data, never an error
  return fetch('teams.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j) && Array.isArray(j.teams) && j.meta) ? j : null)
    .catch(() => null);
}

Promise.all([loadJson('players.json'), loadJson('players_down.json'), loadComparison(), loadTeams()]).then(([up, down, cmp, teams]) => {
  CMP = cmp;
  TEAMS = teams;
  UP = (Array.isArray(up) ? up : []).map(p => ({ ...p, direction: p.direction || 'up' }));
  DOWN = (Array.isArray(down) ? down : []).map(p => ({ ...p, direction: p.direction || 'down' }));
  UP.forEach(p => { byIdAll[p.id] = p; });
  DOWN.forEach(p => { if (!byIdAll[p.id]) byIdAll[p.id] = p; });
  $('statPlayers').textContent = UP.length + DOWN.length;
  $('statBooks').textContent = new Set([...UP, ...DOWN].map(p => p.conference_book)).size;
  $('statTeams').textContent = TEAMS ? TEAMS.teams.length : '—';
  $('teamCardCount').textContent = TEAMS ? TEAMS.teams.length : '—';
  $('splashTeamMeta').textContent = TEAMS ? 'schools in the 2026 pool' : 'team data isn’t part of this build';
  $('upCount').textContent = UP.length;
  $('downCount').textContent = DOWN.length ? DOWN.length : '—';
  $('splashUpMeta').textContent = 'players evaluated';
  $('splashDownMeta').textContent = DOWN.length
    ? 'players evaluated'
    : 'First class in build — the screen is running.';
  ['q', 'f-hv', 'f-ulm'].forEach(id =>
    $(id).addEventListener('input', applyFilters));
  FILTER_DEFS.forEach(def => {
    const w = msWrap(def.id);
    $(def.id).addEventListener('click', () => toggleMs(def.id));
    w.querySelector('.ms-opts').addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      if (cb.checked) filterSel[def.id].add(cb.value); else filterSel[def.id].delete(cb.value);
      updateMsButton(def);
      applyFilters();
    });
    w.querySelector('.ms-clear').addEventListener('click', () => { clearFilter(def.id); applyFilters(); });
  });
  document.addEventListener('click', e => { if (openMsId && !e.target.closest('.ms')) closeMs(); });
  // team picker: the same dropdown panel machinery, multi-select up to TEAM_CAP
  $('teamCount').textContent = TEAMS ? `${TEAMS.teams.length} FBS teams` : '';
  teamBtnLabel();
  buildTeamPanel();
  $('t-team').addEventListener('click', () => toggleMs('t-team'));
  $('teamOpts').addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    if (cb.checked && !teamSet.includes(cb.value) && teamSet.length >= TEAM_CAP) {
      cb.checked = false;
      teamCapNoteSync();
      return;
    }
    toggleTeam(cb.value, cb.checked);
  });
  $('teamClear').addEventListener('click', clearTeams);
  $('teamQ').addEventListener('input', buildTeamPanel);
  $('teamBody').addEventListener('click', e => {
    const b = e.target.closest('[data-torder]');
    if (b) { teamOrder = b.dataset.torder; renderTeam(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMs(); });
  $('reset').addEventListener('click', () => {
    $('q').value = ''; clearAllFilters();
    $('f-hv').checked = false; $('f-ulm').checked = false; applyFilters();
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
