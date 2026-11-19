'use strict';
let UP = [], DOWN = [];
let CMP = null;             // conference comparison dataset (comparison.json)
let TEAMS = null;           // team comparison dataset (teams.json)
let CHAMP = null;           // championship path dataset (championship.json)
let champSel = 'Louisiana-Monroe';  // selected team on the championship path page
let myTeam = null;          // "My Team" mode: the user's saved school (localStorage portalMyTeam), or null
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
  ? `<img class="${cls || 'ph'}" src="headshots/${esc(String(p.headshot).replace(/^headshots\//, ''))}" alt="" loading="lazy">`
  : `<span class="${cls || 'ph-init'}">${esc(initials(p.name))}</span>`;
const eligChip = e => `<span class="chip ${e === 'Eligible' ? 'ok' : e === 'Not eligible' ? 'no' : 'un'}">${esc(e)}</span>`;

/* -------- NIL projection layer --------
   Every player record carries the NIL layer's fields (joined from
   portal_scouting/nil_layer/player_nil.csv): nil_status "priced" with
   nil_floor / nil_ceiling / nil_basis, or "no_estimate" with the reason.
   NIL_LABEL is the layer's required print label (METHOD.md), verbatim —
   it prints wherever these figures appear. */
const NIL_LABEL = 'Estimated NIL projection — modelled from reported market bands [and On3\'s published valuation where shown]. Not a reported deal or an offer for this player.';
const fmtMoney = v => {
  if (v == null) return '—';
  if (v === 0) return '$0';
  if (v >= 1000000) {
    const m = v / 1000000;
    return '$' + (Number.isInteger(m) ? String(m) : m.toFixed(2).replace(/0$/, '')) + 'M';
  }
  return '$' + Math.round(v / 1000) + 'K';
};
const nilRange = x => x && x.nil_status === 'priced' ? `${fmtMoney(x.nil_floor)}–${fmtMoney(x.nil_ceiling)}` : null;

function nilSection(p) {
  if (!p.nil_status) return '';
  let h = `<div class="card"><h2 class="sec" style="margin-top:2px">Estimated NIL projection</h2>`;
  if (p.nil_status === 'no_estimate') {
    h += `<p><b>No estimate</b> — ${esc(p.nil_reason || 'no destination projection to price')}.</p>`;
  } else {
    h += `<p><span class="grade-big">${fmtMoney(p.nil_floor)}–${fmtMoney(p.nil_ceiling)}</span> <span class="p-sub">a year — floor to ceiling at his projected destination</span></p>`;
    h += `<p class="p-sub">Basis: ${esc(p.nil_basis || '')}${p.nil_projection_basis ? ` (${esc(p.nil_projection_basis)})` : ''}${p.nil_band_basis ? ` · band evidence: ${esc(p.nil_band_basis.toLowerCase())}` : ''}</p>`;
    if (p.on3_valuation != null) {
      const rel = p.on3_flag === 'ON3 ABOVE CEILING' ? ' It sits <b>above</b> this projection’s ceiling — the two figures answer different questions (On3 values his current situation; the band prices his projected role) and are shown side by side, never merged.'
        : p.on3_flag === 'ON3 BELOW FLOOR' ? ' It sits <b>below</b> this projection’s floor — the two figures answer different questions and are shown side by side, never merged.' : '';
      h += `<p>On3 published valuation: <b>${fmtMoney(p.on3_valuation)}</b> <span class="p-sub">— On3’s model estimate, shown as a market reference.</span>${rel} ${p.on3_url ? `<a href="${esc(p.on3_url)}" target="_blank" rel="noopener">On3 NIL profile</a>` : ''}</p>`;
    }
  }
  h += `<p class="p-sub">${esc(NIL_LABEL)}</p></div>`;
  return h;
}

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
  $('q').value = ''; clearAllFilters(); $('f-hv').checked = false; $('f-ulm').checked = false; $('f-myteam').checked = false;
  syncMyTeamToggle();
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
  for (const v of ['splash', 'directory', 'downempty', 'player', 'compare', 'comparison', 'teamcmp', 'champ']) {
    $('view-' + v).hidden = v !== name;
  }
}

function setBackLinks(dir) {
  document.querySelectorAll('.back-dir').forEach(a => { a.href = '#/' + dir; });
}

/* "Fits my team": the player's PRINTED fits include the school — the
   g6 / p4 fit rows on his record, plus the separately printed
   Louisiana-Monroe fit (ulm_fit / ulm_qualifier). The fit rows carry
   full school names identical to the championship pool's team names
   (verified across all 766 records: every fits school is a CHAMP team
   name), so the match is plain string equality. */
function fitsMyTeam(p, teamName) {
  const f = p.fits;
  if (!f || !teamName) return false;
  if (f.ulm_fit && f.ulm_fit.school === teamName) return true;
  if (teamName === 'Louisiana-Monroe' && f.ulm_qualifier) return true;
  return [...(f.g6 || []), ...(f.p4 || [])].some(r => r.school === teamName);
}

function currentFilters() {
  return {
    q: $('q').value.trim().toLowerCase(),
    hv: $('f-hv').checked, ulm: $('f-ulm').checked, mt: $('f-myteam').checked
  };
}

function applyFilters() {
  const f = currentFilters();
  let rows = PLAYERS.filter(p => {
    if (f.q && !(p.name.toLowerCase().includes(f.q) || (p.school || '').toLowerCase().includes(f.q))) return false;
    for (const def of FILTER_DEFS) if (!def.test(p, filterSel[def.id])) return false;
    if (f.hv && !p.hidden_value) return false;
    if (f.ulm && !(p.fits && p.fits.ulm_qualifier)) return false;
    if (f.mt && myTeam && !fitsMyTeam(p, myTeam)) return false;
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

function classOf(teamName) {
  try { return JSON.parse(localStorage.getItem('portalClass:' + teamName) || '{}'); } catch { return {}; }
}
function hitDefault() {
  try { const v = parseFloat(localStorage.getItem('portalHitDefault')); if (!isNaN(v)) return Math.min(1, Math.max(0, v)); } catch {}
  return champHitDefault;
}
function savePlayerToTeam(pid, teamName) {
  const e = availIdx()[pid];
  if (!e) return false;
  const cls = classOf(teamName);
  if (!cls[pid]) cls[pid] = { g: e._g, hit: hitDefault() };
  try { localStorage.setItem('portalClass:' + teamName, JSON.stringify(cls)); } catch { return false; }
  if (teamName === champClassTeam) champClass = cls;
  return true;
}
/* -------- My Team mode --------
   One saved school (localStorage portalMyTeam, picked in the topbar)
   frames the site around the user's own program: the championship
   path opens on it (and follows it until the user picks a team on
   that page themselves), the player page reads each player against
   its rooms, the save picker defaults to it, and the directories can
   filter to the players whose printed fits include it. */
function myTeamObj() {
  return (myTeam && CHAMP) ? CHAMP.teams.find(t => t.name === myTeam) || null : null;
}
function buildMyTeamSelect() {
  const sel = $('myTeamSel');
  if (!sel) return;
  const names = CHAMP ? CHAMP.teams.map(t => t.name) : [];
  sel.innerHTML = '<option value="">No team set</option>' + names.map(n =>
    `<option value="${esc(n)}"${n === myTeam ? ' selected' : ''}>${esc(n)}</option>`).join('');
  sel.value = myTeam || '';
}
function syncMyTeamToggle() {
  const wrap = $('f-myteam-wrap'), hint = $('f-myteam-hint'), cb = $('f-myteam'), nm = $('f-myteam-name');
  if (!wrap || !cb) return;
  const on = !!myTeam;
  wrap.hidden = !on;
  if (hint) hint.hidden = on;
  if (nm) nm.textContent = on ? `— ${myTeam}` : '';
  if (!on && cb.checked) { cb.checked = false; if (curDir) applyFilters(); }
}
function setMyTeam(name) {
  myTeam = name && CHAMP && CHAMP.teams.some(t => t.name === name) ? name : null;
  try { if (myTeam) localStorage.setItem('portalMyTeam', myTeam); else localStorage.removeItem('portalMyTeam'); } catch (err) {}
  const sel = $('myTeamSel');
  if (sel) sel.value = myTeam || '';
  syncMyTeamToggle();
  const hash = location.hash || '';
  if (hash.startsWith('#/player/')) route();   // re-render so the For card and the save default apply
  else if ((hash === '#/up' || hash === '#/down') && $('f-myteam') && $('f-myteam').checked) applyFilters();
}
/* Is he already theirs? His record's school, or his book's own team
   (the ULM book's players carry school "ULM"; champOwnBookTeam maps
   the book to its championship-pool team name), or his pool entry's
   school — the same own-team semantics champAvailFor excludes by. */
function onRosterOf(p, t) {
  if (!t) return false;
  if (p.school === t.name) return true;
  if (champOwnBookTeam(p.conference_book) === t.name) return true;
  const e = availIdx()[p.id];
  return !!(e && e.school === t.name);
}
function myTeamCard(p) {
  const t = myTeamObj();
  if (!t) return '';
  const head = `<h2 class="sec" style="margin-top:2px">For ${esc(t.name)}</h2>`;
  const e = availIdx()[p.id];
  if (onRosterOf(p, t)) {
    let h = `<div class="card">${head}<p>He is already on ${esc(t.name)}’s roster — this page is his evaluation in the ${esc(p.conference_book)} book.</p>`;
    const g = (e && e._g) || p.group || p.position;
    const room = t.rooms && t.rooms[g];
    if (room) {
      const entry = (room.roster || []).find(x => x.name === p.name);
      const grade = entry ? entry.grade : (e ? e.grade : p.headline_grade);
      if (grade != null) {
        const s = slotIn(playedRoom(room).filter(x => x.name !== p.name), grade);
        h += `<p class="p-sub">His grade (${f1(grade)}) ranks <b>#${s.rank} of ${s.of}</b> against the ${esc(g)} room’s played roster.</p>`;
      }
    }
    return h + '</div>';
  }
  if (!e) {
    const why = p.elig_qualified === 'Not eligible' ? 'his eligibility is used up under the qualified determination' : 'he carries no projection benchmark in the pool';
    return `<div class="card">${head}<p class="p-sub">He carries no college projection to measure against your room — ${why}.</p></div>`;
  }
  if (t.level === 'P4' && e.dir === 'down') {
    return `<div class="card">${head}<p>He is in the P4 Down pool, which projects players to G6 schools — there is no projection for a P4 room, so there is no standing to read against ${esc(t.name)}’s ${esc(e._g)} room.</p></div>`;
  }
  const g = e._g;
  const room = t.rooms && t.rooms[g];
  let h = `<div class="card">${head}`;
  if (room) {
    const getable = (room.getable || []).some(x => x.id === p.id);
    h += getable
      ? `<p><b>Getable for ${esc(t.name)}</b> — he clears your incumbent under the strict test.</p>`
      : `<p>Does not clear your room’s incumbent under the strict test.</p>`;
    const s = slotIn(playedRoom(room), e.benchmark);
    h += `<p class="p-sub">Slots <b>#${s.rank} of ${s.of}</b> in your ${esc(g)} room — his benchmark against the room’s played roster${s.above ? `, behind ${esc(s.above.name)} ${f1(s.above.grade)}` : ' — the room’s top grade'}${s.below ? `, ahead of ${esc(s.below.name)} ${f1(s.below.grade)}` : ''}.</p>`;
  } else {
    h += `<p class="p-sub">No ${esc(g)} room for ${esc(t.name)} in the championship pool.</p>`;
  }
  h += `<p class="p-sub">Benchmark <b>${f1(e.benchmark)}</b> — his grade after the level-translation adjustment, the number the fits and the strict test use.</p>`;
  return h + '</div>';
}

function saveStrip(p) {
  if (!CHAMP) return '';
  const e = availIdx()[p.id];
  if (!e) {
    const why = p.elig_qualified === 'Not eligible' ? 'his eligibility is used up under the qualified determination' : 'he carries no projection benchmark in the pool';
    return `<div class="card"><h2 class="sec" style="margin-top:2px">Save to a school’s class</h2>
      <p class="p-sub">Not saveable — ${why}, so no school can add him to a class.</p></div>`;
  }
  const teams = CHAMP.teams.filter(t => champAvailFor(t, e._g).some(x => x.id === p.id));
  if (!teams.length) return `<div class="card"><h2 class="sec" style="margin-top:2px">Save to a school’s class</h2>
    <p class="p-sub">No school can add him — the only rooms he clears are at his own school.</p></div>`;
  const def = teams.some(t => t.name === myTeam) ? myTeam
    : teams.some(t => t.name === champSel) ? champSel : teams[0].name;
  const has = !!classOf(def)[p.id];
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Save to a school’s class</h2>
    <div class="save-row">
      <label>School <select id="saveTeamSel">${teams.map(t => `<option value="${esc(t.name)}"${t.name === def ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <button type="button" class="btn-save" data-saveplayer="${esc(p.id)}"${has ? ' disabled' : ''}>${has ? `Saved in ${esc(def)}’s class ✓` : 'Save to this class'}</button>
      <span class="p-sub" id="saveMsg"></span>
    </div>
    <p class="p-sub">Saving puts him on that school’s saved class — the board at the top of its <a href="#/championship-path">championship path</a> page — priced at your menu default. A class is kept per school, in this browser.</p></div>`;
}
function updateSaveBtn() {
  const sel = $('saveTeamSel'), btn = document.querySelector('[data-saveplayer]');
  if (!sel || !btn) return;
  const team = sel.value;
  const has = !!classOf(team)[btn.dataset.saveplayer];
  btn.disabled = has;
  btn.textContent = has ? `Saved in ${team}’s class ✓` : 'Save to this class';
  if (!has) { const m = $('saveMsg'); if (m) m.textContent = ''; }
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

  h += saveStrip(p);

  h += myTeamCard(p);

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

  h += nilSection(p);

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

/* CSV export of the room table for the selected teams: one row per room,
   the same numbers the page prints (gaps vs P4 derived like the matrix). */
function buildTeamCSV(sel) {
  const med = levelMedians();
  const head = ['Team', 'Conference', 'Level', 'Room', 'Incumbent', 'Incumbent grade',
    'Below bar', 'Volume', 'Volume bar', 'Volume unit', 'Room median', 'Qualified players',
    'Conference median', 'Conference rank', 'Conference teams', 'Level median',
    'Gap vs conference', 'Gap vs G6', 'Gap vs P4', 'Gap vs level', 'Upgrade candidates'];
  const q = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [head.join(',')];
  for (const t of sel) {
    for (const g of TEAMS.meta.groups) {
      const r = t.rooms[g];
      if (!r) continue;
      const gapP4 = (r.inc_grade != null && med[g] && med[g].p4 != null)
        ? Math.round((r.inc_grade - med[g].p4) * 10) / 10 : null;
      rows.push([t.name, t.conf, t.level, g, r.incumbent, r.inc_grade,
        r.below_bar ? 'Y' : '', r.below_bar ? r.inc_vol : '', r.below_bar ? r.vol_bar : '',
        r.below_bar ? r.vol_unit : '', r.median, r.n, r.conf_median, r.conf_rank,
        r.conf_teams, r.level_median, r.gap_conf, r.gap_g6, gapP4, r.gap_level,
        r.cand_total].map(q).join(','));
    }
  }
  return rows.join('\n');
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

/* ---------------- championship path ----------------
   One team, measured room by room against the conference-best standard:
   the highest volume-qualified incumbent grade at the group in its
   conference (below-bar rooms never set it; if a conference has no
   qualified incumbent at the group, the standard is the level best and
   the table says so). GETABLE players and the bars are computed by
   build_team_json.py into championship.json — an evaluated player with
   eligibility remaining whose benchmark clears the room's incumbent
   under the books' strict test, and not already on the team. The path
   player is the best getable player; the projected room grade after
   the path is his benchmark. Each getable entry also carries his NIL
   projection (nil_floor / nil_ceiling or a no-estimate status), and the
   header totals the path players' estimated NIL cost — unpriced path
   players are counted and named as unpriced, never as $0. */
/* champ-model-begin */
function champModel(t, groups) {
  const EPS = 1e-9;
  const rooms = groups.map(g => {
    const r = t.rooms[g];
    const inc = r.inc_grade, bar = r.bar_grade, bb = !!r.below_bar;
    const gap = (inc != null && bar != null) ? Math.round((inc - bar) * 10) / 10 : null;
    const atBar = !bb && inc != null && bar != null && inc >= bar - EPS;
    const path = (r.getable && r.getable.length) ? r.getable[0] : null;
    let status;
    if (atBar) status = 'AT STANDARD';
    else if (!path) status = 'NO GETABLE PLAYER';
    else if (bar != null && path.benchmark >= bar - EPS) status = 'CLOSES THE GAP';
    else status = 'PARTIAL';
    return { g, r, inc, bar, bb, gap, atBar, path, status,
             projected: path ? path.benchmark : inc,
             atBarAfter: atBar || status === 'CLOSES THE GAP' };
  });
  /* Estimated path cost: the sum of the path players' NIL band floors
     and ceilings. A path player with no estimate is counted as unpriced
     and excluded from the sums — never treated as $0. */
  const pathRooms = rooms.filter(x => x.path);
  const pricedPaths = pathRooms.filter(x => x.path.nil_status === 'priced');
  return {
    rooms,
    atNow: rooms.filter(x => x.atBar).length,
    atAfter: rooms.filter(x => x.atBarAfter).length,
    improved: rooms.filter(x => x.status === 'PARTIAL').length,
    noGet: rooms.filter(x => x.status === 'NO GETABLE PLAYER').length,
    points: Math.round(rooms.reduce((s, x) =>
      s + (x.inc != null && x.bar != null ? Math.max(0, x.bar - x.inc) : 0), 0) * 10) / 10,
    cost: {
      floor: pricedPaths.reduce((s, x) => s + x.path.nil_floor, 0),
      ceiling: pricedPaths.reduce((s, x) => s + x.path.nil_ceiling, 0),
      priced: pricedPaths.length,
      total: pathRooms.length,
      unpriced: pathRooms.length - pricedPaths.length
    }
  };
}
/* champ-model-end */

function champBtnLabel() {
  const btn = $('c-team');
  const t = CHAMP && CHAMP.teams.find(x => x.name === champSel);
  btn.innerHTML = t ? `Team — ${esc(t.name)} <span class="ms-caret">▾</span>` : `Team <span class="ms-caret">▾</span>`;
  btn.classList.toggle('ms-on', !!t);
}

function buildChampPanel() {
  const box = $('champOpts');
  if (!CHAMP) { box.innerHTML = ''; return; }
  const q = ($('champQ').value || '').trim().toLowerCase();
  let html = '';
  for (const conf of CHAMP.meta.conference_order) {
    const ts = CHAMP.teams.filter(t => t.conf === conf && (!q || t.name.toLowerCase().includes(q)));
    if (!ts.length) continue;
    html += `<div class="ms-group">${esc(conf)}</div>` + ts.map(t =>
      `<label class="ms-opt"><input type="radio" name="champTeam" value="${esc(t.name)}"${t.name === champSel ? ' checked' : ''}> ${esc(t.name)}</label>`).join('');
  }
  box.innerHTML = html || '<p class="p-sub" style="padding:6px 8px">No teams match that search.</p>';
}

const CHAMP_STATUS_CLS = { 'AT STANDARD': 'ok', 'CLOSES THE GAP': 'ok', 'PARTIAL': 'un', 'NO GETABLE PLAYER': 'no' };

function champPlayerLine(c) {
  return `<div class="path-cell">${photo(c)}
    <div><a href="#/player/${esc(encodeURIComponent(c.id))}"><span class="pname">${esc(c.name)}</span></a>${c.hv ? '<span class="hv">Hidden Value</span>' : ''}
    <br><span class="p-sub">${esc(c.school)} · benchmark <b>${f1(c.benchmark)}</b></span>
    <br><span class="p-sub">${nilRange(c) ? `Est. NIL <b>${nilRange(c)}</b> a year` : 'Est. NIL — no estimate'}</span>
    <br>${eligChip(c.elig)}${c.elig === 'Unsettled' ? '<span class="p-sub"> eligibility unsettled</span>' : ''}
    <br><button type="button" class="btn-add" data-add="${esc(c.id)}">+ Save to class</button></div></div>`;
}

function champRoomRow(x, confName) {
  const r = x.r;
  const incCell = !r.incumbent
    ? '<span class="p-sub">— none qualified —</span>'
    : x.bb
      ? `${esc(r.incumbent)}<br><span class="p-sub">top by volume — ${r.inc_vol} of ${r.vol_bar} ${esc(r.vol_unit)}, below the bar</span>`
      : esc(r.incumbent);
  const incGrade = r.incumbent == null ? '<td class="num">—</td>'
    : x.bb ? `<td class="num bb"><b>${f1(x.inc)}*</b></td>` : `<td class="num"><b>${f1(x.inc)}</b></td>`;
  const barCell = x.bar == null ? '<td class="num">—</td>'
    : `<td class="num"><b>${f1(x.bar)}</b><br><span class="p-sub">${r.bar_scope === 'level'
        ? `no qualified incumbent in the ${esc(confName)} — level best, ${esc(r.bar_team)}`
        : `set by ${esc(r.bar_team)}`}</span></td>`;
  let pathCell;
  if (x.status === 'AT STANDARD' && !x.path) {
    pathCell = `<span class="chip ok">AT STANDARD</span><br><span class="p-sub">The incumbent already meets the conference-best standard, and no getable player clears him.</span>`;
  } else if (x.status === 'NO GETABLE PLAYER') {
    pathCell = `<span class="chip no">NO GETABLE PLAYER</span><br><span class="p-sub">${x.bb
      ? 'No candidates are named for a below-bar room — the strict test needs a qualified bar to clear.'
      : r.incumbent == null
        ? 'No qualified incumbent in the pool snapshot — the strict test has no bar to clear.'
        : 'No evaluated player with eligibility remaining clears this room.'}</span>`;
  } else {
    const c = x.path;
    const more = r.getable_total > 1 ? `<details class="getable-more"><summary>All getable players (${r.getable_total})</summary>
      <div class="fits-scroll"><table class="fits"><tr><th>Player</th><th>School</th><th class="num">Grade</th><th class="num">Benchmark</th><th>Est. NIL</th><th>Eligibility</th></tr>
      ${r.getable.map(o => `<tr draggable="true" data-dragpid="${esc(o.id)}"><td><a href="#/player/${esc(encodeURIComponent(o.id))}"><span class="pname">${esc(o.name)}</span></a>${o.hv ? '<span class="hv">Hidden Value</span>' : ''}</td><td>${esc(o.school)}</td><td class="num">${f1(o.grade)}</td><td class="num"><b>${f1(o.benchmark)}</b></td><td>${nilRange(o) || 'no estimate'}</td><td>${eligChip(o.elig)}</td></tr>`).join('')}
      </table></div></details>` : '';
    pathCell = `${champPlayerLine(c)}<p class="path-status"><span class="chip ${CHAMP_STATUS_CLS[x.status]}">${x.status}</span>${
      x.status === 'PARTIAL' ? `<span class="p-sub"> projected ${f1(c.benchmark)} — ${f1(Math.round((x.bar - c.benchmark) * 10) / 10)} short of the standard</span>`
      : x.status === 'CLOSES THE GAP' ? `<span class="p-sub"> projected ${f1(c.benchmark)} — reaches the standard</span>`
      : `<span class="p-sub"> the room already meets the standard; he clears it too</span>`}</p>${more}`;
  }
  return `<tr><td><span class="pname">${esc(x.g)}</span></td>
    <td>${incCell}</td>${incGrade}${barCell}${gapCell(x.gap)}
    <td>${pathCell}</td></tr>`;
}

/* Grouped horizontal bars per room: incumbent vs the conference-best
   standard vs the projected grade after the path, on one grade scale. */
function champChart(t, m) {
  const vals = [];
  m.rooms.forEach(x => { if (x.inc != null) vals.push(x.inc); if (x.bar != null) vals.push(x.bar); if (x.path) vals.push(x.path.benchmark); });
  if (!vals.length) return '';
  let lo = Math.max(0, Math.floor(Math.min(...vals) - 3));
  let hi = Math.min(100, Math.ceil(Math.max(...vals) + 3));
  if (hi - lo < 20) { lo = Math.max(0, lo - 5); hi = Math.min(100, hi + 5); }
  const W = 660, L = 200, R = 646, top = 30, blockH = 37, barH = 8, barGap = 3;
  const H = top + m.rooms.length * blockH + 22;
  const X = v => L + ((v - lo) / (hi - lo)) * (R - L);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.name)} — incumbent, conference-best standard and projected grade after the path, room by room">`;
  s += `<rect x="${L}" y="6" width="10" height="10" fill="#94a3b8"/><text x="${L + 15}" y="15" class="ch-leg">Incumbent</text>`;
  s += `<rect x="${L + 96}" y="6" width="10" height="10" fill="#0f172a"/><text x="${L + 111}" y="15" class="ch-leg">Conference-best standard</text>`;
  s += `<rect x="${L + 268}" y="6" width="10" height="10" fill="#1a7f37"/><text x="${L + 283}" y="15" class="ch-leg">Projected after the path</text>`;
  m.rooms.forEach((x, i) => {
    const y0 = top + i * blockH;
    s += `<text x="0" y="${y0 + 16}" class="ch-room">${esc(x.g)}${x.bb ? '*' : ''}</text>`;
    const bars = [
      { v: x.inc, fill: '#94a3b8', faded: x.bb, label: x.inc != null ? f1(x.inc) + (x.bb ? '*' : '') : null },
      { v: x.bar, fill: '#0f172a', faded: false, label: x.bar != null ? f1(x.bar) : null },
      { v: x.path ? x.path.benchmark : null, fill: '#1a7f37', faded: false, label: x.path ? f1(x.path.benchmark) : null }
    ];
    bars.forEach((b, bi) => {
      if (b.v == null) return;
      const y = y0 + bi * (barH + barGap);
      s += `<rect x="${L}" y="${y}" width="${Math.max(2, X(b.v) - L).toFixed(1)}" height="${barH}" rx="2" fill="${b.fill}"${b.faded ? ' fill-opacity="0.45"' : ''}/>`;
      s += `<text x="${(X(b.v) + 6).toFixed(1)}" y="${y + barH - 1}" class="ch-val">${b.label}</text>`;
    });
    if (i === m.rooms.length - 1) {
      for (const tick of [40, 50, 60, 70, 80, 90]) {
        if (tick < lo || tick > hi) continue;
        s += `<text x="${X(tick)}" y="${y0 + blockH + 12}" text-anchor="middle" class="ch-leg">${tick}</text>`;
      }
    }
  });
  s += '</svg>';
  return `<div class="card"><h2 class="sec" style="margin-top:2px">${esc(t.name)} — the path in grades</h2>
    <p class="p-sub">Per room: the incumbent’s grade, the conference-best standard, and the projected grade after the path (the path player’s benchmark). A faded, asterisked incumbent bar is a below-bar room — its top player by volume, carried flagged; no projected bar is drawn where no player is getable.</p>${s}</div>`;
}

function renderChamp() {
  const body = $('champBody');
  if (!CHAMP) {
    body.innerHTML = `<div class="card empty-state"><h2 class="empty-title">Path to a conference championship</h2>
      <p>The championship data (championship.json) isn’t part of this build, so this page has nothing to show. The directories and player pages are unaffected.</p>
      <p><a href="#/team-comparison">Open the team comparison instead →</a></p></div>`;
    return;
  }
  // Until the user makes an explicit team choice of their own for this
  // page (champPicked), the page follows My Team — including a My Team
  // set mid-session, after boot. Once they pick, the setting never
  // moves the page again.
  if (!champPicked && myTeam && champSel !== myTeam && CHAMP.teams.some(x => x.name === myTeam)) {
    champSel = myTeam;
    buildChampPanel();
  }
  const t = CHAMP.teams.find(x => x.name === champSel) || CHAMP.teams[0];
  champSel = t.name;
  champBtnLabel();
  if (champClassTeam !== t.name) loadClass(t.name);
  if (champSharedPending && champSharedPending.team === t.name) {
    // a share link's class replaces the board's class in memory only —
    // the stored class for this team is not read again and not overwritten
    champClass = champSharedPending.cls;
    champSharedView = true;
    champSharedPending = null;
  }
  const m = champModel(t, CHAMP.meta.groups);
  const ph = $('champPrintHead');
  if (ph) ph.innerHTML = `<h1 class="print-title">Path to a conference championship — ${esc(t.name)}</h1><p class="print-sub">${esc(t.conf)} · ${esc(t.level)} · pool snapshot Nov 17, 2026 · the standard is the conference-best qualified incumbent grade per room · projected grades are Player Book benchmarks</p>`;
  let h = `<div class="card"><div class="team-head">
    ${t.logo ? `<img class="team-logo" src="logos/${esc(t.logo)}" alt="">` : ''}
    <div>
      <p class="p-name">${esc(t.name)}</p>
      <p class="p-sub">${esc(t.conf)} · ${esc(t.level)}</p>
      <p class="p-sub">Rooms at the conference-best standard today: <b>${m.atNow} of ${m.rooms.length}</b> · after the path: <b>${m.atAfter} of ${m.rooms.length}</b> · improved but still short: <b>${m.improved}</b> · no getable player: <b>${m.noGet}</b></p>
      <p class="p-sub">Total grade points to the standard across the ten rooms: <b>${f1(m.points)}</b></p>
      <p class="p-sub">${m.cost.total === 0
        ? 'Estimated path cost: <b>—</b> (no path players named)'
        : `Estimated path cost: <b>${fmtMoney(m.cost.floor)}–${fmtMoney(m.cost.ceiling)}</b> a year · ${m.cost.priced} of ${m.cost.total} path players priced${m.cost.unpriced ? ` · <b>${m.cost.unpriced} path player${m.cost.unpriced > 1 ? 's carry' : ' carries'} no estimate and ${m.cost.unpriced > 1 ? 'are' : 'is'} not counted in the total — never as $0</b>` : ''}`}</p>
    </div></div>
    ${cmpNote('How to read this page: the <b>conference-best standard</b> is the highest <b>volume-qualified</b> incumbent grade at the room among the teams in ' + esc(t.conf) + ' — the championship bar for that room. The <b>path</b> names, per room, the single best <b>getable</b> player: an evaluated player from the Player Books who has eligibility remaining, whose benchmark clears this room’s incumbent under the same strict test the books print, and who is not already on ' + esc(t.name) + '. His benchmark is the room’s <b>projected</b> grade after the path. <b>Closes the gap</b> — his benchmark reaches the standard. <b>Partial</b> — he clears the incumbent but not the standard.')}
  </div>`;
  h += renderClassBoard(t, m);
  h += champChart(t, m);
  h += `<div class="card"><h2 class="sec" style="margin-top:2px">The path, room by room</h2>
    <div class="tbl-scroll"><table class="ctable champ-table">
      <thead><tr><th>Room</th><th>Incumbent</th><th class="num">Inc. grade</th><th class="num">Conference-best standard</th><th class="num">Gap</th><th>The path — best getable player</th></tr></thead>
      <tbody>${m.rooms.map(x => champRoomRow(x, t.conf)).join('')}</tbody></table></div>
    <p class="foot-note">Method, in plain terms. <b>The standard:</b> the highest volume-qualified incumbent grade at the group among all teams in the conference; a room carried below the volume bar never sets it, and if no team in the conference has a qualified incumbent at the group, the standard is the best qualified incumbent grade at the team’s level (G6 or P4) and the table says so. <b>Getable:</b> eligibility remaining under the qualified determination — Unsettled players are shown and flagged “eligibility unsettled” — a benchmark that clears the room’s incumbent under the books’ strict test, and not already on this team. <b>Projected</b> is his benchmark from the Player Book method — headline grade plus the position’s translation delta. <b>NIL:</b> getable is a field test — it means he clears your room and has eligibility; it does not price him. Separately, each path and getable player carries his estimated NIL projection where priced, and the header’s estimated path cost sums the path players’ floors and ceilings; a path player with no estimate is named as unpriced in that count and is never counted as $0. ${esc(NIL_LABEL)} An asterisked incumbent is a room with no volume-qualified player, carried by its top player by volume under the team-comparison ruling; no getable players are named for those rooms. Pool: Nov 17, 2026 in-season snapshot of PFF Ultimate exports; grades are PFF headline grades.</p>
  </div>`;
  h += renderFullRooms(t, m);
  body.innerHTML = h;
  if (champRestoreScroll === 'board') { const b = $('classBoard'); if (b) b.scrollIntoView({ block: 'start' }); }
  else if (typeof champRestoreScroll === 'number') window.scrollTo(0, champRestoreScroll);
  champRestoreScroll = null;
}

/* ---------------- championship path: full rooms, regional view, class builder
   Tommy, Nov 18, 2026: the path above names only the single best getable
   player per room. The fuller product below it: every room printed in
   full — the room a transfer would actually enter — and every available
   player at the position, not just the top five and not only the men who
   beat the room's #1, each with his slot-in standing against the full
   room (entering as WR2 is a real outcome). A regional view filters the
   available lists to players whose home state is the school's state or
   a bordering one. And a class builder: drag any available player in
   (or use his Add button) and price him where you judge he lands
   between his estimated NIL floor and ceiling — the class spend totals
   at your marks, with the all-floor / all-ceiling bounds beside it. */
const STATE_ADJ = { AL: ['FL', 'GA', 'MS', 'TN'], AK: [], AZ: ['CA', 'CO', 'NM', 'NV', 'UT'], AR: ['LA', 'MO', 'MS', 'OK', 'TN', 'TX'], CA: ['AZ', 'NV', 'OR'], CO: ['AZ', 'KS', 'NE', 'NM', 'OK', 'UT', 'WY'], CT: ['MA', 'NY', 'RI'], DE: ['MD', 'NJ', 'PA'], DC: ['MD', 'VA'], FL: ['AL', 'GA'], GA: ['AL', 'FL', 'NC', 'SC', 'TN'], HI: [], ID: ['MT', 'NV', 'OR', 'UT', 'WA', 'WY'], IL: ['IN', 'IA', 'KY', 'MO', 'WI'], IN: ['IL', 'KY', 'MI', 'OH'], IA: ['IL', 'MN', 'MO', 'NE', 'SD', 'WI'], KS: ['CO', 'MO', 'NE', 'OK'], KY: ['IL', 'IN', 'MO', 'OH', 'TN', 'VA', 'WV'], LA: ['AR', 'MS', 'TX'], ME: ['NH'], MD: ['DE', 'PA', 'VA', 'WV', 'DC'], MA: ['CT', 'NH', 'NY', 'RI', 'VT'], MI: ['IN', 'OH', 'WI'], MN: ['IA', 'ND', 'SD', 'WI'], MS: ['AL', 'AR', 'LA', 'TN'], MO: ['AR', 'IL', 'IA', 'KS', 'KY', 'NE', 'OK', 'TN'], MT: ['ID', 'ND', 'SD', 'WY'], NE: ['CO', 'IA', 'KS', 'MO', 'SD', 'WY'], NV: ['AZ', 'CA', 'ID', 'OR', 'UT'], NH: ['ME', 'MA', 'VT'], NJ: ['DE', 'NY', 'PA'], NM: ['AZ', 'CO', 'OK', 'TX'], NY: ['CT', 'MA', 'NJ', 'PA', 'VT'], NC: ['GA', 'SC', 'TN', 'VA'], ND: ['MN', 'MT', 'SD'], OH: ['IN', 'KY', 'MI', 'PA', 'WV'], OK: ['AR', 'CO', 'KS', 'MO', 'NM', 'TX'], OR: ['CA', 'ID', 'NV', 'WA'], PA: ['DE', 'MD', 'NJ', 'NY', 'OH', 'WV'], RI: ['CT', 'MA'], SC: ['GA', 'NC'], SD: ['IA', 'MN', 'MT', 'NE', 'ND', 'WY'], TN: ['AL', 'AR', 'GA', 'KY', 'MS', 'MO', 'NC', 'VA'], TX: ['AR', 'LA', 'NM', 'OK'], UT: ['AZ', 'CO', 'ID', 'NV', 'WY'], VT: ['MA', 'NH', 'NY'], VA: ['DC', 'KY', 'MD', 'NC', 'TN', 'WV'], WA: ['ID', 'OR'], WV: ['KY', 'MD', 'OH', 'PA', 'VA'], WI: ['IL', 'IA', 'MI', 'MN'], WY: ['CO', 'ID', 'MT', 'NE', 'SD', 'UT'] };

let champRegional = false;
let champHitDefault = 0.5;
let champClass = {};          // playerId -> {g, hit} — hit is 0..1 across his NIL band
let champClassTeam = null;
let champSharedPending = null;  // {team, cls} decoded from a share link, applied by the next renderChamp
let champSharedView = false;    // the board is showing an unmodified shared class, not this device's stored one
let champPicked = false;        // an explicit team choice for this page — its own picker, a share link, or a go-to-class link; until one happens, the page follows My Team (see renderChamp)
let champRestoreScroll = null;
let AVAIL_IDX = null;

function availIdx() {
  if (AVAIL_IDX) return AVAIL_IDX;
  AVAIL_IDX = {};
  if (CHAMP && CHAMP.avail) for (const g of Object.keys(CHAMP.avail))
    for (const e of CHAMP.avail[g]) { e._g = g; AVAIL_IDX[e.id] = e; }
  return AVAIL_IDX;
}
function champOwnBookTeam(book) { return book === 'ULM' ? 'Louisiana-Monroe' : book === 'UTEP' ? 'UTEP' : null; }
function champAvailFor(t, g) {
  const all = (CHAMP.avail && CHAMP.avail[g]) || [];
  return all.filter(e => e.school !== t.name
    && champOwnBookTeam(e.book) !== t.name
    && !(t.level === 'P4' && e.dir === 'down'));
}
function isRegional(t, e) {
  if (!e.home_state || !t.state) return false;
  return e.home_state === t.state || (STATE_ADJ[t.state] || []).includes(e.home_state);
}
function playedRoom(r) { return ((r && r.roster) || []).filter(p => p.vol > 0); }
function slotIn(roster, bench) {
  let rank = 1, above = null, below = null;
  for (const p of roster || []) {
    if (p.grade > bench) { rank++; if (!above || p.grade < above.grade) above = p; }
    else if (!below || p.grade > below.grade) below = p;
  }
  return { rank, of: (roster || []).length + 1, above, below };
}
function loadClass(team) {
  champClassTeam = team;
  champSharedView = false;   // (re)reading the stored class ends any shared view
  try { const hd = parseFloat(localStorage.getItem('portalHitDefault')); if (!isNaN(hd)) champHitDefault = Math.min(1, Math.max(0, hd)); } catch (err) {}
  try { champClass = JSON.parse(localStorage.getItem('portalClass:' + team) || '{}'); }
  catch (err) { champClass = {}; }
  const idx = availIdx();
  for (const id of Object.keys(champClass)) if (!idx[id]) delete champClass[id];
}
function saveClass() {
  // every mutation path saves through here — from the first change on, a
  // shared class being viewed is the user's own saved class on this device
  champSharedView = false;
  const st = document.querySelector('[data-sharedstrip]');
  if (st) st.remove();
  try { localStorage.setItem('portalClass:' + champClassTeam, JSON.stringify(champClass)); } catch (err) {}
}
function hitPrice(e, hit) {
  return e && e.nil_status === 'priced' ? Math.round(e.nil_floor + hit * (e.nil_ceiling - e.nil_floor)) : null;
}
function classTotals() {
  const idx = availIdx();
  let spend = 0, floor = 0, ceiling = 0, priced = 0, n = 0;
  for (const [id, c] of Object.entries(champClass)) {
    const e = idx[id]; if (!e) continue;
    n++;
    const p = hitPrice(e, c.hit);
    if (p != null) { priced++; spend += p; floor += e.nil_floor; ceiling += e.nil_ceiling; }
  }
  return { n, priced, spend, floor, ceiling };
}
function updateClassTotals() {
  const ct = classTotals();
  const s = $('classSpend'), b = $('classBounds');
  if (s) s.textContent = ct.priced ? fmtMoney(ct.spend) : '—';
  if (b) b.textContent = ct.priced ? `${fmtMoney(ct.floor)} at everyone's floor · ${fmtMoney(ct.ceiling)} at everyone's ceiling` : '';
}
function syncHitRow(id, sliderEl) {
  const e0 = availIdx()[id], c = champClass[id];
  if (!e0 || !c) return;
  const price = hitPrice(e0, c.hit);
  const priceEl = document.getElementById('hitprice-' + id);
  if (priceEl && price != null) priceEl.textContent = fmtMoney(price);
  const row = priceEl ? priceEl.closest('.class-row') : null;
  if (row) {
    const rg = row.querySelector('[data-hitrange]');
    if (rg && rg !== sliderEl) rg.value = Math.round(c.hit * 100);
    row.querySelectorAll('[data-hitpid]').forEach(ch =>
      ch.classList.toggle('on', Math.abs(parseFloat(ch.dataset.hitval) - c.hit) < 0.001));
  }
  updateClassTotals();
}
function classAdd(id) {
  const e = availIdx()[id];
  if (!e || champClass[id]) return;
  champClass[id] = { g: e._g, hit: champHitDefault };
  saveClass();
  champRestoreScroll = 'board';
  renderChamp();
}
function classRemove(id) {
  if (!champClass[id]) return;
  delete champClass[id];
  saveClass();
  champRestoreScroll = window.scrollY;
  renderChamp();
}
/* The class applied to the path model: per room, the projected grade
   becomes the better of the incumbent and the best class benchmark in
   that room; rooms-at-standard is then read the same way the path
   summary reads it (below-bar rooms never count). */
function classEffect(t, m) {
  const idx = availIdx();
  const best = {};
  for (const [id, c] of Object.entries(champClass)) {
    const e = idx[id]; if (!e) continue;
    if (best[c.g] == null || e.benchmark > best[c.g]) best[c.g] = e.benchmark;
  }
  const EPS = 1e-9;
  let atAfter = 0, points = 0;
  for (const x of m.rooms) {
    let proj = x.inc;
    if (best[x.g] != null) proj = proj == null ? best[x.g] : Math.max(proj, best[x.g]);
    if (!x.bb && proj != null && x.bar != null && proj >= x.bar - EPS) atAfter++;
    if (proj != null && x.bar != null) points += Math.max(0, x.bar - proj);
  }
  return { atAfter, points: Math.round(points * 10) / 10 };
}

const HIT_STOPS = [[0, 'Floor'], [0.25, 'Low'], [0.5, 'Mid'], [0.75, 'High'], [1, 'Ceiling']];

function hitLabel(hit) {
  for (const [v, lab] of HIT_STOPS) if (Math.abs(hit - v) < 0.001) return lab;
  return `${Math.round(hit * 100)}% of the way from floor to ceiling`;
}
function classEmailText(t, m, ct, eff, lines) {
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const shareUrl = classShareUrl(t.name, champClass);
  const body = [
    `${t.name} — saved class · ${date}`,
    'Built on the championship path page of the Player Books site.',
    '',
    ...lines,
    '',
    ct.priced ? `Class spend at your marks: ${fmtMoney(ct.spend)} a year (${fmtMoney(ct.floor)} at everyone's floor · ${fmtMoney(ct.ceiling)} at everyone's ceiling)${ct.priced < ct.n ? ` · ${ct.n - ct.priced} player(s) with no estimate, not counted` : ''}` : 'Class spend: no priced players.',
    eff ? `Path with this class: ${eff.atAfter} of ${m.rooms.length} rooms at the conference standard (today ${m.atNow}) · ${f1(eff.points)} grade points to the standard (today ${f1(m.points)}).` : '',
    shareUrl ? `Open this class live: ${shareUrl}` : '',
    '',
    NIL_LABEL,
  ].filter(x => x !== '').join('\n');
  return { subject: `Saved class — ${t.name} (championship path)`, body };
}
function classMailto(t, m, ct, eff, lines) {
  const em = classEmailText(t, m, ct, eff, lines);
  return `mailto:?subject=${encodeURIComponent(em.subject)}&body=${encodeURIComponent(em.body)}`;
}
function gmailCompose(t, m, ct, eff, lines) {
  const em = classEmailText(t, m, ct, eff, lines);
  return `https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(em.subject)}&body=${encodeURIComponent(em.body)}`;
}
/* ---- shareable class links: the class travels in the URL itself ----
   #/championship-path/class/<base64url of JSON {t, c: [[id, hit], ...]}>
   Opening one shows the sender's class on the board without touching
   the stored class on this device; the first change the viewer makes
   saves it as their own (every mutation path runs through saveClass). */
function b64urlEncode(str) {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = b.length % 4 ? '='.repeat(4 - (b.length % 4)) : '';
  return decodeURIComponent(escape(atob(b + pad)));
}
function classShareUrl(teamName, classObj) {
  if (!CHAMP) return null;
  const idx = availIdx();
  const entries = Object.entries(classObj || {}).filter(([id, c]) => c && idx[id]);
  if (!entries.length) return null;
  const payload = { t: teamName, c: entries.map(([id, c]) => [id, Math.min(1, Math.max(0, +c.hit || 0))]) };
  return `${location.origin}${location.pathname}#/championship-path/class/${b64urlEncode(JSON.stringify(payload))}`;
}
function parseSharedClass(payloadStr) {
  if (!CHAMP) return null;
  try {
    const obj = JSON.parse(b64urlDecode(payloadStr));
    if (!obj || typeof obj.t !== 'string' || !Array.isArray(obj.c)) return null;
    if (!CHAMP.teams.some(x => x.name === obj.t)) return null;
    const idx = availIdx();
    const cls = {};
    for (const pair of obj.c) {
      if (!Array.isArray(pair)) continue;
      const e = idx[pair[0]];
      if (!e) continue;
      cls[pair[0]] = { g: e._g, hit: Math.min(1, Math.max(0, +pair[1] || 0)) };
    }
    return Object.keys(cls).length ? { team: obj.t, cls } : null;
  } catch (err) { return null; }
}
function copyShareLink(btn) {
  const url = classShareUrl(champClassTeam, champClass);
  if (!url) return;
  const done = () => {
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = 'Link copied ✓';
    setTimeout(() => { btn.textContent = old; }, 2000);
  };
  const fallback = () => {
    // no clipboard access: surface the link in a selectable field instead
    const wrap = document.querySelector('[data-sharefieldwrap]');
    const field = document.querySelector('[data-sharefield]');
    if (wrap && field) {
      wrap.hidden = false;
      field.value = url;
      try { field.focus(); field.select(); } catch (err) {}
      try { if (typeof document.execCommand === 'function' && document.execCommand('copy')) done(); } catch (err) {}
    }
  };
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(url).then(done, fallback);
      return;
    }
  } catch (err) {}
  fallback();
}
/* ---- the board as a picture: a canvas rendering of the saved class,
   drawn from the same snapshot the board prints, so the email carries
   the look of the screen and not only text. ---- */
let champBoardSnapshot = null;
function canShareFiles() {
  try {
    if (!navigator.share || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File(['x'], 'x.png', { type: 'image/png' })] });
  } catch (err) { return false; }
}
function wrapLines(ctx, text, maxW) {
  const out = [];
  let cur = '';
  for (const w of String(text).split(/\s+/)) {
    const t = cur ? cur + ' ' + w : w;
    if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}
function fitLine(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}
function classBoardCanvas() {
  const snap = champBoardSnapshot;
  if (!snap || !snap.items.length) return null;
  const probe = document.createElement('canvas');
  const pctx = probe.getContext('2d');
  if (!pctx) return null;
  const W = 640, PAD = 28, MAXW = W - PAD * 2, ROWH = 60;
  const FONT = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  pctx.font = `12.5px ${FONT}`;
  const effLine = snap.effAt != null ? `With this class: ${snap.effAt} of ${snap.rooms} rooms at the standard (today: ${snap.atNow}) · ${f1(snap.effPoints)} grade points to the standard (today: ${f1(snap.pointsNow)}).` : '';
  const effLines = effLine ? wrapLines(pctx, effLine, MAXW) : [];
  pctx.font = `10.5px ${FONT}`;
  const footLines = wrapLines(pctx, NIL_LABEL, MAXW);
  const totalsH = 36 + (snap.ct.priced ? 18 : 0) + effLines.length * 18;
  const tY = 116 + snap.items.length * ROWH;
  const H = tY + totalsH + 22 + footLines.length * 14 + 12;
  const S = 2;
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.scale(S, S);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#334155'; ctx.fillRect(0, 0, W, 88);
  ctx.fillStyle = '#ffffff'; ctx.font = `700 20px ${FONT}`;
  ctx.fillText(fitLine(ctx, `Saved class — ${snap.team}`, MAXW), PAD, 38);
  ctx.fillStyle = '#cbd5e1'; ctx.font = `12.5px ${FONT}`;
  ctx.fillText(`${snap.date} · Player Books — championship path`, PAD, 62);
  let y = 112;
  for (const it of snap.items) {
    ctx.fillStyle = '#1e293b'; ctx.font = `700 15px ${FONT}`;
    ctx.fillText(fitLine(ctx, it.name + `${it.hv ? ' · Hidden Value' : ''}${it.down ? ' · P4 Down' : ''}`, MAXW), PAD, y);
    ctx.fillStyle = '#64748b'; ctx.font = `12.5px ${FONT}`;
    ctx.fillText(fitLine(ctx, `${it.g} · ${it.school} · benchmark ${f1(it.benchmark)} · slots #${it.rank} of ${it.of} in this room`, MAXW), PAD, y + 19);
    ctx.fillStyle = '#1e293b';
    ctx.fillText(fitLine(ctx, it.price != null ? `Priced at ${hitLabel(it.hit)} — ${fmtMoney(it.price)} a year · band ${it.band}` : 'Est. NIL — no estimate (not counted in the spend)', MAXW), PAD, y + 38);
    y += ROWH;
    ctx.strokeStyle = '#e2e8f0'; ctx.beginPath(); ctx.moveTo(PAD, y - 12); ctx.lineTo(W - PAD, y - 12); ctx.stroke();
  }
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(PAD - 8, tY, MAXW + 16, totalsH);
  ctx.fillStyle = '#1e293b'; ctx.font = `700 14.5px ${FONT}`;
  ctx.fillText(snap.ct.priced ? `Class spend at your marks: ${fmtMoney(snap.ct.spend)} a year` : 'Class spend: no priced players.', PAD, tY + 24);
  let ly = tY + 24;
  if (snap.ct.priced) {
    ctx.fillStyle = '#64748b'; ctx.font = `12.5px ${FONT}`;
    ly += 18;
    ctx.fillText(fitLine(ctx, `${fmtMoney(snap.ct.floor)} at everyone's floor · ${fmtMoney(snap.ct.ceiling)} at everyone's ceiling · ${snap.ct.n} player${snap.ct.n > 1 ? 's' : ''}${snap.ct.priced < snap.ct.n ? ` · ${snap.ct.n - snap.ct.priced} with no estimate, not counted` : ''}`, MAXW), PAD, ly);
  }
  ctx.fillStyle = '#1e293b'; ctx.font = `12.5px ${FONT}`;
  for (const L of effLines) { ly += 18; ctx.fillText(L, PAD, ly); }
  ctx.fillStyle = '#64748b'; ctx.font = `10.5px ${FONT}`;
  let fy = tY + totalsH + 22;
  for (const L of footLines) { ctx.fillText(L, PAD, fy); fy += 14; }
  return cv;
}
function classImageBlob(cb) {
  const cv = classBoardCanvas();
  if (!cv) { cb(null); return; }
  if (cv.toBlob) { cv.toBlob(b => cb(b), 'image/png'); return; }
  try {
    const bin = atob(cv.toDataURL('image/png').split(',')[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    cb(new Blob([arr], { type: 'image/png' }));
  } catch (err) { cb(null); }
}
function classImageName() {
  const snap = champBoardSnapshot;
  return `saved-class-${(snap ? snap.team : 'team').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`;
}
function downloadClassImage() {
  classImageBlob(b => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = classImageName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
}
function shareClassImage() {
  const snap = champBoardSnapshot;
  if (!snap || !snap.mail) return;
  classImageBlob(b => {
    if (!b) { try { navigator.share({ title: snap.mail.subject, text: snap.mail.body }).catch(() => {}); } catch (err) {} return; }
    const data = { title: snap.mail.subject, text: snap.mail.body };
    try {
      const file = new File([b], classImageName(), { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) data.files = [file];
    } catch (err) {}
    try { navigator.share(data).catch(() => {}); } catch (err) {}
  });
}
function renderClassBoard(t, m) {
  const idx = availIdx();
  const ct = classTotals();
  const eff = ct.n ? classEffect(t, m) : null;
  const byGroup = {};
  for (const [id, c] of Object.entries(champClass)) {
    const e = idx[id]; if (!e) continue;
    (byGroup[c.g] = byGroup[c.g] || []).push({ e, hit: c.hit });
  }
  for (const g of Object.keys(byGroup)) byGroup[g].sort((a, b) => b.e.benchmark - a.e.benchmark);
  let rows = '';
  const lines = [];
  const items = [];
  for (const g of CHAMP.meta.groups) {
    for (const { e, hit } of byGroup[g] || []) {
      const s = slotIn(playedRoom(t.rooms[g]), e.benchmark);
      const price = hitPrice(e, hit);
      lines.push(`${e.name} (${g}) — ${e.school} — benchmark ${f1(e.benchmark)} — slots #${s.rank} of ${s.of} in the ${t.name} room — ${price != null ? `priced at ${hitLabel(hit)}: ${fmtMoney(price)} a year (band ${nilRange(e)})` : 'Est. NIL: no estimate'}`);
      items.push({ name: e.name, g, school: e.school, benchmark: e.benchmark, rank: s.rank, of: s.of, price, hit, band: price != null ? nilRange(e) : null, hv: !!e.hv, down: e.dir === 'down' });
      rows += `<div class="class-row">${photo(e)}
        <div class="avail-main">
          <a href="#/player/${esc(encodeURIComponent(e.id))}"><span class="pname">${esc(e.name)}</span></a>
          <span class="room-tag">${esc(g)}</span>${e.hv ? '<span class="hv">Hidden Value</span>' : ''}${e.dir === 'down' ? '<span class="down-badge">P4 Down</span>' : ''}
          <br><span class="p-sub">${esc(e.school)} · benchmark <b>${f1(e.benchmark)}</b> · slots <b>#${s.rank} of ${s.of}</b> in this room</span>
          <br><span class="p-sub">${price != null ? `Est. NIL ${nilRange(e)} a year` : 'Est. NIL — no estimate (not counted in the spend)'}</span>
          ${price != null ? `<span class="hit-ctl"><span class="hit-chips">${HIT_STOPS.map(([v, lab]) =>
            `<button type="button" class="hit-chip${Math.abs(hit - v) < 0.001 ? ' on' : ''}" data-hitpid="${esc(e.id)}" data-hitval="${v}">${lab}</button>`).join('')}</span>
          <input type="range" class="hit-range" min="0" max="100" step="5" value="${Math.round(hit * 100)}" data-hitrange="${esc(e.id)}" aria-label="Where ${esc(e.name)} lands between floor and ceiling">
          <b class="hit-price" id="hitprice-${esc(e.id)}">${fmtMoney(price)}</b></span>
          <span class="hit-print">Priced at ${esc(hitLabel(hit))} — ${fmtMoney(price)} a year</span>` : ''}
        </div>
        <button type="button" class="btn-remove" data-remove="${esc(e.id)}" aria-label="Remove ${esc(e.name)} from the class">✕</button>
      </div>`;
    }
  }
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  champBoardSnapshot = { team: t.name, date, items, ct, effAt: eff ? eff.atAfter : null, effPoints: eff ? eff.points : null, rooms: m.rooms.length, atNow: m.atNow, pointsNow: m.points, mail: classEmailText(t, m, ct, eff, lines) };
  return `<div class="card class-board" id="classBoard">
    <div class="print-only class-print-head">Saved class — ${esc(t.name)} · ${esc(date)}</div>
    <h2 class="sec" style="margin-top:2px">Saved class — ${esc(t.name)}</h2>
    ${champSharedView ? `<div class="shared-strip" data-sharedstrip><b>Shared class.</b> You’re viewing a class sent to you — your own saved class for ${esc(t.name)} is untouched. If you change anything here, this becomes your saved class on this device.</div>` : ''}
    <p class="p-sub">This is the school's saved list. Drag any player from the lists below into this board, or use his <b>Save</b> button — you can also save a man straight from his player page. Because a band is a range, price each man where <i>you</i> judge he lands between his floor and his ceiling — the spend totals at your marks. New saves are priced at the menu default; adjust each man on his own row. The class is kept per team, in this browser.</p>
    <div class="class-ctl">
      <label>Price new saves at
        <select data-hitdefault>${HIT_STOPS.map(([v, lab]) => `<option value="${v}"${Math.abs(champHitDefault - v) < 0.001 ? ' selected' : ''}>${lab}</option>`).join('')}</select>
      </label>
      <label class="reg-tgl"><input type="checkbox" data-regional${champRegional ? ' checked' : ''}> Regional replacements only — the lists below show players whose home state is ${t.state ? esc(t.state) : 'the school’s state'} or a bordering state</label>
      ${ct.n ? '<button type="button" class="btn-ghost" data-clearclass>Clear the class</button>' : ''}
      ${ct.n ? '<button type="button" class="btn-ghost" data-printclass>Print / Save PDF</button>' : ''}
      ${ct.n ? '<button type="button" class="btn-ghost" data-emailclass>Email / share the class</button>' : ''}
      ${ct.n ? '<button type="button" class="btn-ghost" data-sharelink>Copy share link</button>' : ''}
    </div>
    ${ct.n ? '<div class="share-fieldwrap" data-sharefieldwrap hidden><input type="text" readonly data-sharefield class="share-field" aria-label="Share link for this class"></div>' : ''}
    ${ct.n ? `<div class="email-panel" data-emailpanel hidden>
      <p class="p-sub" style="margin-top:0">The email carries a <b>picture of this board</b> — the class as it looks on screen — with the <b>full text underneath it</b>, so it still reads on a phone even where the picture doesn't load.</p>
      <div class="email-btns">
        ${canShareFiles() ? '<button type="button" class="btn-save" data-shareclass>Share — picture + text</button>' : ''}
        <button type="button" class="btn-ghost" data-dlimg>Download the board picture</button>
        <a class="btn-ghost mail-btn" href="${classMailto(t, m, ct, eff, lines)}">Open an email draft — text version</a>
        <a class="btn-ghost mail-btn" href="${gmailCompose(t, m, ct, eff, lines)}" target="_blank" rel="noopener">Open in Gmail — text version</a>
      </div>
      <p class="p-sub">On a phone, <b>Share</b> drops the picture straight into your mail app — Apple Mail, the Gmail app, whichever you pick — with the text under it. On a computer, download the picture and attach it to the draft (in Gmail, just drag the picture into the compose window) — a web page can't attach a file to an email by itself.</p>
    </div>` : ''}
    ${ct.n ? `<div class="class-list">${rows}</div>
    <p class="class-totals">Class spend at your marks: <b id="classSpend">${ct.priced ? fmtMoney(ct.spend) : '—'}</b> a year
      <span class="p-sub" id="classBounds">${ct.priced ? `${fmtMoney(ct.floor)} at everyone's floor · ${fmtMoney(ct.ceiling)} at everyone's ceiling` : ''}</span>
      <span class="p-sub">· ${ct.n} player${ct.n > 1 ? 's' : ''}${ct.priced < ct.n ? ` · ${ct.n - ct.priced} with no estimate, not counted` : ''}</span></p>
    <p class="p-sub">With this class: <b>${eff.atAfter} of ${m.rooms.length} rooms at the standard</b> (today: ${m.atNow}) · <b>${f1(eff.points)} grade points to the standard</b> (today: ${f1(m.points)}). Read the same way as the path summary above — a room counts when its projected top grade, the better of the incumbent and your best class benchmark in it, reaches the conference-best standard.</p>`
    : '<p class="p-sub class-empty">No players saved yet — drag a player here, use his Save button below, or save him from his player page.</p>'}
    <p class="foot-note">${esc(NIL_LABEL)}</p>
  </div>`;
}

function renderFullRooms(t, m) {
  let h = '';
  for (const x of m.rooms) {
    const g = x.g, r = x.r;
    const rosterAll = r.roster || [];
    const roster = rosterAll.filter(p => p.vol > 0);
    const zeroVol = rosterAll.filter(p => !(p.vol > 0));
    const all = champAvailFor(t, g);
    const reg = all.filter(e => isRegional(t, e));
    const shown = champRegional ? reg : all;
    const rosterRows = roster.map((p, i) => `<tr><td class="num">${i + 1}</td><td>${esc(p.name)}</td><td class="num"><b>${f1(p.grade)}</b></td><td class="num">${esc(p.vol)} ${esc(r.vol_unit || '')}</td></tr>`).join('')
      + (zeroVol.length ? `<tr class="roster-div"><td colspan="4">Also in the data — no recorded ${esc(r.vol_unit || 'volume')} in the snapshot</td></tr>`
        + zeroVol.map(p => `<tr class="vol0"><td class="num">—</td><td>${esc(p.name)}</td><td class="num">${f1(p.grade)}</td><td class="num">0 ${esc(r.vol_unit || '')}</td></tr>`).join('') : '');
    const availRows = shown.map(e => {
      const s = slotIn(roster, e.benchmark);
      const inClass = !!champClass[e.id];
      const slotTxt = roster.length
        ? `Slots <b>#${s.rank} of ${s.of}</b>${s.above ? ` — behind ${esc(s.above.name)} ${f1(s.above.grade)}` : ' — the room’s top grade'}${s.below ? ` · ahead of ${esc(s.below.name)} ${f1(s.below.grade)}` : ''}`
        : 'No player with recorded volume in this room in the pool snapshot';
      return `<div class="avail-row${inClass ? ' in-class' : ''}" draggable="true" data-dragpid="${esc(e.id)}">${photo(e)}
        <div class="avail-main">
          <a href="#/player/${esc(encodeURIComponent(e.id))}"><span class="pname">${esc(e.name)}</span></a>${e.hv ? '<span class="hv">Hidden Value</span>' : ''}${e.dir === 'down' ? '<span class="down-badge">P4 Down</span>' : ''}${isRegional(t, e) ? `<span class="reg-badge">Regional · ${esc(e.home_state)}</span>` : ''}
          <br><span class="p-sub">${esc(e.school)} · grade ${f1(e.grade)} → benchmark <b>${f1(e.benchmark)}</b></span>
          <br><span class="p-sub">${slotTxt}</span>
          <br><span class="p-sub">${nilRange(e) ? `Est. NIL <b>${nilRange(e)}</b> a year` : 'Est. NIL — no estimate'} · </span>${eligChip(e.elig)}${e.elig === 'Unsettled' ? '<span class="p-sub"> eligibility unsettled</span>' : ''}
        </div>
        <button type="button" class="btn-add" data-add="${esc(e.id)}"${inClass ? ' disabled' : ''}>${inClass ? 'Saved ✓' : '+ Save'}</button>
      </div>`;
    }).join('');
    h += `<div class="card room-full">
      <h2 class="sec" style="margin-top:2px">${esc(g)} — the room in full, and everyone available</h2>
      <div class="room-grid">
        <div>
          <h3 class="sub-h">The room he enters — ${esc(t.name)} ${esc(g)} (${roster.length})</h3>
          ${rosterAll.length ? `<div class="tbl-scroll"><table class="fits room-tbl"><thead><tr><th class="num">#</th><th>Player</th><th class="num">Grade</th><th class="num">Volume</th></tr></thead><tbody>${rosterRows}</tbody></table></div>`
            : '<p class="p-sub">No rostered players at this group in the pool snapshot.</p>'}
          <p class="p-sub">Every player with a report row at this group — the rotation first (with volume), then the rostered names with no recorded ${esc(r.vol_unit || 'volume')} in the snapshot; those carry a grade on a snap or two and do not count in slot-in standing. Incumbent: <b>${r.incumbent ? esc(r.incumbent) : '— none qualified —'}${r.inc_grade != null ? ` (${f1(r.inc_grade)})` : ''}</b> · conference-best standard <b>${r.bar_grade != null ? f1(r.bar_grade) : '—'}</b>.</p>
        </div>
        <div>
          <h3 class="sub-h">Available — ${shown.length} of ${all.length} evaluated players${champRegional ? ` (regional only · ${reg.length} regional)` : ''}</h3>
          <div class="avail-scroll">${availRows || '<p class="p-sub">No available players under the current view.</p>'}</div>
          <p class="p-sub">Every evaluated player with eligibility remaining at this group${t.level === 'G6' ? ', both directions — the Moving Up pool at his book benchmark and the P4 Down pool at his projected G6 grade' : ' at his book benchmark'}, best benchmark first — not only the men who beat the room’s #1. <b>Slot-in</b> ranks his benchmark against the full room’s grades: #2 means he enters behind one man, not that he failed a test. Drag a player to the saved class, or use his Save button.</p>
        </div>
      </div>
    </div>`;
  }
  return h;
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
  const csvBtn = $('csvBtnTeam');
  if (csvBtn) csvBtn.disabled = !sel.length;
  const ph = $('teamPrintHead');
  if (ph) ph.innerHTML = sel.length
    ? `<h1 class="print-title">Team comparison — ${sel.map(t => esc(t.name)).join(' · ')}</h1><p class="print-sub">Pool snapshot ${esc(TEAMS.meta.snapshot || 'Nov 17, 2026')} · grades are PFF headline grades · conference and level medians are medians of team incumbents · an asterisked grade is a below-bar room carried by its top player by volume</p>`
    : '';
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
  const sm = hash.match(/^#\/championship-path\/class\/(.+)$/);
  if (sm) {
    setChrome(null);
    showView('champ');
    const shared = parseSharedClass(sm[1]);
    if (shared) {
      champSel = shared.team;
      champPicked = true;   // a share link names its team — an explicit choice, so My Team must not move the page off it
      champSharedPending = shared;
      champBtnLabel();
      buildChampPanel();
    }
    renderChamp();
    document.title = 'Path to a conference championship — Player Books';
    window.scrollTo(0, 0);
    return;
  }
  if (hash === '#/championship-path') {
    setChrome(null);
    showView('champ');
    if (champSharedView || champSharedPending) {
      // the plain page is the user's own class — drop any shared view
      // and force the stored class to be re-read on the next render
      champSharedView = false;
      champSharedPending = null;
      champClassTeam = null;
    }
    renderChamp();
    document.title = 'Path to a conference championship — Player Books';
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

function loadChamp() {
  // same failure-tolerant pattern: a missing or malformed
  // championship.json degrades to no championship data, never an error
  return fetch('championship.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j) && Array.isArray(j.teams) && j.meta) ? j : null)
    .catch(() => null);
}

Promise.all([loadJson('players.json'), loadJson('players_down.json'), loadComparison(), loadTeams(), loadChamp()]).then(([up, down, cmp, teams, champ]) => {
  CMP = cmp;
  TEAMS = teams;
  CHAMP = champ;
  // My Team: a returning user's saved school seeds the championship
  // path's selected team here at boot. After boot the page keeps
  // following the setting (renderChamp) until the user makes an
  // explicit team choice of their own there — champPicked.
  try {
    const mt = localStorage.getItem('portalMyTeam');
    if (mt && CHAMP && CHAMP.teams.some(t => t.name === mt)) { myTeam = mt; champSel = mt; }
  } catch (err) {}
  buildMyTeamSelect();
  syncMyTeamToggle();
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
  ['q', 'f-hv', 'f-ulm', 'f-myteam'].forEach(id =>
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
  // championship path picker: the same dropdown panel machinery, single-select
  $('champCount').textContent = CHAMP ? `${CHAMP.teams.length} FBS teams` : '';
  champBtnLabel();
  buildChampPanel();
  $('c-team').addEventListener('click', () => toggleMs('c-team'));
  $('champOpts').addEventListener('change', e => {
    const rb = e.target.closest('input[type=radio][name=champTeam]');
    if (!rb) return;
    champSel = rb.value;
    champPicked = true;   // the page's own picker is an explicit choice — My Team no longer moves this page
    champBtnLabel();
    closeMs();
    renderChamp();
  });
  $('champQ').addEventListener('input', buildChampPanel);
  $('playerBody').addEventListener('click', e => {
    const go = e.target.closest('[data-goclass]');
    if (go) { champSel = go.dataset.goclass; champPicked = true; champBtnLabel(); buildChampPanel(); }
    const sv = e.target.closest('[data-saveplayer]');
    if (sv) {
      const sel = $('saveTeamSel');
      const team = sel ? sel.value : champSel;
      if (savePlayerToTeam(sv.dataset.saveplayer, team)) {
        updateSaveBtn();
        const m = $('saveMsg');
        if (m) m.innerHTML = `Saved ✓ — <a href="#/championship-path" data-goclass="${esc(team)}">open ${esc(team)}’s saved class</a>`;
      }
    }
  });
  $('playerBody').addEventListener('change', e => { if (e.target.closest('#saveTeamSel')) updateSaveBtn(); });
  $('champBody').addEventListener('click', e => {
    const add = e.target.closest('[data-add]');
    if (add) { classAdd(add.dataset.add); return; }
    const rem = e.target.closest('[data-remove]');
    if (rem) { classRemove(rem.dataset.remove); return; }
    if (e.target.closest('[data-printclass]')) {
      document.body.classList.add('print-class');
      const donePc = () => { document.body.classList.remove('print-class'); window.removeEventListener('afterprint', donePc); };
      window.addEventListener('afterprint', donePc);
      setTimeout(donePc, 2000);
      try { window.print(); } catch (err) {}
      return;
    }
    if (e.target.closest('[data-clearclass]')) {
      champClass = {}; saveClass(); champRestoreScroll = window.scrollY; renderChamp(); return;
    }
    if (e.target.closest('[data-emailclass]')) {
      const p = document.querySelector('[data-emailpanel]');
      if (p) p.hidden = !p.hidden;
      return;
    }
    if (e.target.closest('[data-dlimg]')) { downloadClassImage(); return; }
    if (e.target.closest('[data-shareclass]')) { shareClassImage(); return; }
    if (e.target.closest('[data-sharelink]')) { copyShareLink(e.target.closest('[data-sharelink]')); return; }
    const chip = e.target.closest('[data-hitpid]');
    if (chip && champClass[chip.dataset.hitpid]) {
      champClass[chip.dataset.hitpid].hit = parseFloat(chip.dataset.hitval);
      saveClass(); syncHitRow(chip.dataset.hitpid);
    }
  });
  $('champBody').addEventListener('change', e => {
    const reg = e.target.closest('[data-regional]');
    if (reg) { champRegional = reg.checked; champRestoreScroll = window.scrollY; renderChamp(); return; }
    const hd = e.target.closest('[data-hitdefault]');
    if (hd) { champHitDefault = parseFloat(hd.value); try { localStorage.setItem('portalHitDefault', String(champHitDefault)); } catch (err) {} }
  });
  $('champBody').addEventListener('input', e => {
    const rg = e.target.closest('[data-hitrange]');
    if (rg && champClass[rg.dataset.hitrange]) {
      champClass[rg.dataset.hitrange].hit = parseInt(rg.value, 10) / 100;
      saveClass(); syncHitRow(rg.dataset.hitrange, rg);
    }
  });
  $('champBody').addEventListener('dragstart', e => {
    const row = e.target.closest('[data-dragpid]');
    if (row) { e.dataTransfer.setData('text/plain', row.dataset.dragpid); e.dataTransfer.effectAllowed = 'copy'; }
  });
  $('champBody').addEventListener('dragover', e => {
    const board = $('classBoard');
    if (board && board.contains(e.target)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; board.classList.add('drop-on'); }
  });
  $('champBody').addEventListener('dragleave', e => {
    const board = $('classBoard');
    if (board && !board.contains(e.relatedTarget)) board.classList.remove('drop-on');
  });
  $('champBody').addEventListener('drop', e => {
    const board = $('classBoard');
    if (board && board.contains(e.target)) {
      e.preventDefault(); board.classList.remove('drop-on');
      const id = e.dataTransfer.getData('text/plain');
      if (id) classAdd(id);
    }
  });
  $('teamBody').addEventListener('click', e => {
    const b = e.target.closest('[data-torder]');
    if (b) { teamOrder = b.dataset.torder; renderTeam(); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMs(); });
  $('reset').addEventListener('click', () => {
    $('q').value = ''; clearAllFilters();
    $('f-hv').checked = false; $('f-ulm').checked = false; $('f-myteam').checked = false; applyFilters();
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
$('myTeamSel').addEventListener('change', e => setMyTeam(e.target.value));
$('printBtn').addEventListener('click', () => window.print());
$('printBtnCmp').addEventListener('click', () => window.print());
$('printBtnTeam').addEventListener('click', () => window.print());
$('printBtnChamp').addEventListener('click', () => window.print());
$('csvBtnTeam').addEventListener('click', () => {
  if (!TEAMS) return;
  const sel = teamSet.map(n => TEAMS.teams.find(x => x.name === n)).filter(Boolean);
  if (!sel.length) return;
  const blob = new Blob([buildTeamCSV(sel)], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'team-comparison.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
window.addEventListener('hashchange', route);
