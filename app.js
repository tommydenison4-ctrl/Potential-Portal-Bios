'use strict';
let UP = [], DOWN = [];
let CMP = null;             // conference comparison dataset (comparison.json)
let TEAMS = null;           // team comparison dataset (teams.json)
let CHAMP = null;           // championship path dataset (championship.json)
let CHANGES = null;         // what-changed log (changes.json), newest week first
let TRAITS_BY_ID = {};      // trait layer (traits.json): player id -> [trait percentile entries]
let TRAIT_REG = {};         // trait layer registry: trait key -> {label, groups, report, proxy, floor}
let FLASHES_BY_ID = {};     // flash layer (flashes.json): player id -> [limited-action flash entries]
let FLASH_REG = {};         // flash registry: trait key -> {label, groups, floor, flash_floor}
let OPTIMAL_SIZE = {};      // optimal size bands (optimal_size.json): group -> {ht_min, ht_max, wt_min, wt_max, ...}
let TEAM_BRANDS = {};       // team_brands.json: FBS team name -> {logo, color, accent} — the My Team skin data
let UNIVERSE_META = null;   // universe_meta.json: the honest counts (evaluated core vs standard records)
let UNIVERSE = null;        // the standard records themselves — lazy-loaded on first reach, never up front
let universePromise = null;
let champSel = null;  // selected team on the championship path page — null until My Team or an explicit pick names one; the page opens on nobody by default
let myTeam = null;          // "My Team" mode: the user's saved school (localStorage portalMyTeam), or null
let PROSPECTS = [];         // Prospect List: highlighted player ids (localStorage portalProspects)
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
const fmtN = n => Number(n).toLocaleString('en-US');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const initials = n => n.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const photo = (p, cls) => p.headshot
  ? `<img class="${cls || 'ph'}" src="headshots/${esc(String(p.headshot).replace(/^headshots\//, ''))}" alt="" loading="lazy">`
  : `<span class="${cls || 'ph-init'}">${esc(initials(p.name))}</span>`;
const eligChip = e => `<span class="chip ${e === 'Eligible' ? 'ok' : e === 'Not eligible' ? 'no' : 'un'}">${esc(e)}</span>`;

/* -------- archetype tags ("what he does best") --------
   Tagged records carry a "tags" field joined from data/tags.json
   (tags_join.py): [{tag, stat, proxy}] — the archetype name, the printed
   evidence line, and the proxy flag for the five proxy-defined tags.
   Untagged records carry no field at all. */
const tagsOf = p => (p && p.tags) || [];
const tagBadges = id => {
  const ts = tagsOf(byIdAll[id]);
  if (!ts.length) return '';
  return ' ' + ts.map(t => `<span class="tag-badge${t.proxy ? ' proxy' : ''}">${esc(t.tag)}${t.proxy ? ' · proxy' : ''}</span>`).join('');
};
const holdsAnyTag = (p, set) => tagsOf(p).some(t => set.has(t.tag));
const holdsAllTags = (p, set) => [...set].every(t => tagsOf(p).some(x => x.tag === t));

/* -------- skill traits (percentile bars + value lean) --------
   The trait layer (build_traits.py -> traits.json) carries, per player,
   one entry per trait he clears the volume floor for: {key, label, pct,
   proxy, ...} — pct is his midpoint percentile inside his level x
   position-group pool, the same pools the archetype tags use. A player
   with NO entry for a trait is below that trait's floor; a percentile
   bar on the trait therefore drops him (the honest floor). traitBars
   holds the bars the user has set; bars AND-combine. The value lean
   (Tommy, Nov 19, 2026) narrows a set trait to value-for-money carriers:
   the trait percentile must be >= 60 AND run at least 30 points ahead of
   his price percentile in his position pool — p.value.price_pct, the
   Value Board's own percentile, so the product speaks one value
   language. A player with no NIL price carries no p.value and cannot
   carry the lean: he drops out while the lean is on. */
const TRAIT_GROUP_ORDER = ['QB', 'RB', 'WR', 'TE', 'OL', 'ED', 'DI', 'LB', 'CB', 'S'];
let traitBars = {};         // trait key -> percentile bar (number)
let valueLean = false;
let traitFlash = false;     // include limited-action flashes in trait filtering (Stage 2a, default off)

const traitsOf = p => (p && TRAITS_BY_ID[p.id]) || [];
const traitEntry = (p, key) => traitsOf(p).find(e => e.key === key) || null;

/* -------- plain-language display map for the skills surfaces --------
   Presentation only (Tommy, Nov 19, 2026: the readers are coaches, not
   analysts — "these guys get confused we lose a contract"). The trait
   machinery is untouched: TRAIT_DISPLAY only renames a trait for print
   and adds a one-line plain gloss of what it measures. A percentile
   prints as a "Top X%" headline (X = 100 - pct, clamped to 1..50) with
   the exact percentile small beside it. */
const TRAIT_DISPLAY = {
  btt_rate:      { name: 'Big-time throws', gloss: 'Share of his throws that are big-time throws — the deep, tight-window completions few quarterbacks make.' },
  passer_rating: { name: 'Passer rating', gloss: 'His passer rating for the season.' },
  qb_rush_yds:   { name: 'Rushing yards', gloss: 'Yards he gained running the ball himself — designed runs and scrambles.' },
  yco_per_att:   { name: 'Yards after contact', gloss: 'Yards per carry after the first defender gets a hand on him.' },
  mtf_rate:      { name: 'Tacklers made to miss', gloss: 'How often he makes a would-be tackler miss, per carry.' },
  ypc:           { name: 'Yards per carry', gloss: 'What he averages every time he carries the ball.' },
  ybc_per_att:   { name: 'Yards before contact', gloss: 'Yards per carry before a defender touches him — the room the blocking and the play call give him.' },
  rb_catches:    { name: 'Catches', gloss: 'Balls he caught out of the backfield.' },
  rb_targets:    { name: 'Targets', gloss: 'Throws sent his way out of the backfield.' },
  drop_rate:     { name: 'Drop rate', gloss: 'How rarely he drops a catchable ball — a low drop rate ranks high here.' },
  ypr:           { name: 'Yards per catch', gloss: 'What he averages every time he catches the ball.' },
  first_down_rate: { name: 'First-down rate', gloss: 'Share of his catches that move the chains.' },
  contested_rate: { name: 'Contested-catch rate', gloss: 'How often he wins the ball with a defender right on him.' },
  contested_catches: { name: 'Contested catches', gloss: 'Catches he made with a defender right on him.' },
  catches:       { name: 'Catches', gloss: 'Balls he caught this season.' },
  yac_per_rec:   { name: 'Yards after the catch', gloss: 'Yards he adds after each catch.' },
  win_rate:      { name: 'Pass-rush win rate', gloss: 'How often he beats his blocker when he rushes the passer.' },
  pressure_rate: { name: 'Pressure rate', gloss: 'How often his rush hurries, hits or sacks the quarterback.' },
  sack_share:    { name: 'Sack finish', gloss: 'Share of his pressures that end in a sack — how often he finishes the rush.' },
  rtg_allowed:   { name: 'Passer rating allowed', gloss: 'The passer rating quarterbacks manage throwing at him — a low number ranks high here.' },
  comp_allowed:  { name: 'Completions allowed', gloss: 'Share of throws at him that get caught — a low number ranks high here.' },
  ballhawk_rate: { name: 'Plays on the ball', gloss: 'Interceptions plus pass break-ups, per throw at him.' },
  finc:          { name: 'Forced incompletions', gloss: 'Throws at him that fall incomplete because of his coverage.' },
  press_share:   { name: 'Press coverage', gloss: 'Share of his coverage snaps lined up in press, on the receiver at the snap.' },
  zone_share:    { name: 'Zone-blocking share', gloss: 'Share of his run blocks that come on zone plays — the fit read for a zone-scheme team.' },
  gap_share:     { name: 'Gap-blocking share', gloss: 'Share of his run blocks that come on gap and power plays — the fit read for a gap-scheme team.' },
  impact_rblk:   { name: 'Impact blocks', gloss: 'Share of his run blocks that take a defender out of the play.' },
  rblk_grade:    { name: 'Run-block grade', gloss: 'His overall run-blocking grade for the season.' },
  pblk_grade:    { name: 'Pass-block grade', gloss: 'His overall pass-blocking grade for the season.' },
};
const traitName = e => (TRAIT_DISPLAY[e.key] || {}).name || e.label;
const traitGloss = e => (TRAIT_DISPLAY[e.key] || {}).gloss || '';
const TAG_GLOSS = {
  'Pure Rusher': 'Beats his blocker and pressures the quarterback as well as anyone in his group.',
  'Speed Rusher': 'A lighter edge rusher who wins with speed off the edge.',
  'Power Rusher': 'A heavier rusher whose pressures turn into sacks.',
  'YAC Threat': 'Does the damage after the catch.',
  'Speed Back': 'Produces before contact — speed through the hole.',
  'Power Back': 'Gains the hard yards after contact.',
  'Third-Down Back': 'Catches the ball and holds up in pass protection on passing downs.',
  'Zone Blocker': 'His run blocking comes in a zone scheme.',
  'Gap / Power Blocker': 'His run blocking comes in a gap and power scheme.',
  'Pulling Lineman': 'A guard or tackle who pulls and lands impact blocks on gap runs.',
  'Coverage': 'Hard to throw on — quarterbacks rate poorly against him.',
  'Ballhawk': 'Gets his hands on the ball — interceptions and pass break-ups.',
  'Press / Jam': 'Lines up in press and disrupts the receiver’s release.',
  'Sure-Handed': 'Almost never drops a catchable ball.',
  'Vertical Stretch': 'Wins downfield — big yards per catch and first downs.',
  'Contested Catch': 'Wins the ball with a defender right on him.',
  'Deep Ball': 'Throws an accurate, dangerous deep ball.',
  'Dual Threat': 'Hurts teams with his legs as well as his arm.',
  'Verified Speed': 'Speed backed by an official track time — not a reported forty-yard dash.',
};
const GROUP_PLAIN = { QB: 'Quarterbacks', RB: 'Running backs', WR: 'Wide receivers', TE: 'Tight ends', OL: 'Offensive linemen', ED: 'Edge rushers', DI: 'Interior defensive linemen', LB: 'Linebackers', CB: 'Cornerbacks', S: 'Safeties' };
const groupPlural = g => (GROUP_PLAIN[g] || g).toLowerCase();
const topShare = pct => Math.min(50, Math.max(1, Math.round(100 - pct)));
const topHtml = pct => `Top ${topShare(pct)}% <span class="badge-sub">${ord(Math.round(pct))} pct</span>`;
const flashBadgeHtml = e => `<span class="flash-badge">Limited action — ${esc(traitName(e))} · ${topHtml(e.pct)} · on just ${esc(e.volume)} ${esc(e.volume_label)}</span>`;

/* -------- flash layer ("limited action" skills) --------
   The flash layer (build_flashes.py -> flashes.json) carries the same
   29 traits at roughly half the standard volume floors, strictly for
   players BELOW the standard floor, at or above the 75th percentile
   of the same pool — so a flash percentile means what a trait
   percentile means, on a sample that always prints beside the claim.
   A player never carries both a trait entry and a flash entry for
   the same trait. Flashes surface in the skills strip, as red badges
   in the directories, and in trait filtering only while the
   include-flashes toggle is on. */
const flashesOf = p => (p && FLASHES_BY_ID[p.id]) || [];
const flashEntry = (p, key) => flashesOf(p).find(e => e.key === key) || null;
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const flashBadges = id => {
  const fs = flashesOf(byIdAll[id]).slice().sort((a, b) => b.pct - a.pct);
  if (!fs.length) return '';
  return ' ' + fs.map(flashBadgeHtml).join('');
};

function passesTraits(p) {
  for (const key of Object.keys(traitBars)) {
    const bar = traitBars[key];
    let e = traitEntry(p, key);
    if ((!e || e.pct < bar) && traitFlash) {
      const fe = flashEntry(p, key);
      if (fe && fe.pct >= bar) e = fe;   // the flash satisfies the bar — the lean below reads off it too
    }
    if (!e || e.pct < bar) return false;
    if (valueLean) {
      if (e.pct < 60) return false;
      const v = p.value;
      if (!v || v.price_pct == null) return false;
      if (e.pct - v.price_pct < 30) return false;
    }
  }
  return true;
}

function buildTraitPanel() {
  const el = $('traitPanel');
  if (!el) return;
  if (!Object.keys(TRAIT_REG).length) { el.innerHTML = ''; return; }
  const counts = {};
  for (const p of PLAYERS) for (const e of traitsOf(p)) counts[e.key + '|' + e.group] = (counts[e.key + '|' + e.group] || 0) + 1;
  const fcounts = {};
  for (const p of PLAYERS) for (const e of flashesOf(p)) fcounts[e.key + '|' + e.group] = (fcounts[e.key + '|' + e.group] || 0) + 1;
  const secs = TRAIT_GROUP_ORDER.map(g => {
    const keys = Object.keys(TRAIT_REG).filter(k => (TRAIT_REG[k].groups || []).includes(g));
    if (!keys.length) return '';
    const rowsHtml = keys
      .map(k => ({ k, n: counts[k + '|' + g] || 0, fn: fcounts[k + '|' + g] || 0 }))
      .sort((a, b) => b.n - a.n || b.fn - a.fn || traitName({ key: a.k, label: TRAIT_REG[a.k].label }).localeCompare(traitName({ key: b.k, label: TRAIT_REG[b.k].label })))
      .map(({ k, n, fn }) => {
        const r = TRAIT_REG[k], d = TRAIT_DISPLAY[k] || {};
        const name = d.name || r.label;
        return `<label class="trait-row"><span class="trait-main"><span class="trait-name">${esc(name)}${r.proxy ? ' <span class="tag-proxy">stand-in stat</span>' : ''}</span>${d.gloss ? `<span class="trait-gloss">${esc(d.gloss)}</span>` : ''}</span><span class="trait-count">${n} ${groupPlural(g)} in this directory show this${fn ? ` · ${fn} more in limited action` : ''}</span><input type="number" class="trait-bar" data-trait="${esc(k)}" min="0" max="100" step="1" placeholder="75" value="${traitBars[k] != null ? traitBars[k] : ''}"${n || (traitFlash && fn) ? '' : ' disabled'} aria-label="Cut-off for ${esc(name)}"></label>`;
      }).join('');
    return `<div class="trait-group"><h3 class="trait-gh">${GROUP_PLAIN[g] || g}</h3>${rowsHtml}</div>`;
  }).join('');
  el.innerHTML = `<div class="card trait-card">
    <h2 class="sec" style="margin-top:2px">Skills — filter by what he does best</h2>
    <p class="p-sub"><b>How the bars work:</b> type a number in a bar to keep only the players in that top slice for the skill — 75 keeps the top quarter, 90 keeps the top tenth, 50 keeps the top half. A player has to clear every bar you set, and he only counts under a skill once he has enough plays on record for it. Skills marked <b>stand-in stat</b> are read off a related stat rather than measured directly.</p>
    <label class="check trait-lean"><input type="checkbox" id="t-lean"${valueLean ? ' checked' : ''}> <span><b>Value lean</b> — only keep players whose skill outruns their price: the skill has to sit in the <b>top 40%</b> at his position <b>and</b> run at least 30 points ahead of where his price ranks in his position group — a real skill, bought cheap. Players with no NIL price can’t carry the lean and drop out while it’s on.</span></label>
    <label class="check trait-lean"><input type="checkbox" id="t-flash"${traitFlash ? ' checked' : ''}> <span><b>Include limited-action flashes</b> — also count skills that showed up on a smaller run of plays; they print red, with the number of plays on them, wherever they show. A player short on plays can clear a bar this way. Off, only full-sample skills count.</span></label>
    ${secs}</div>`;
  el.querySelectorAll('.trait-bar').forEach(inp => inp.addEventListener('input', () => {
    const v = parseFloat(inp.value);
    if (inp.value.trim() === '' || !Number.isFinite(v)) delete traitBars[inp.dataset.trait];
    else traitBars[inp.dataset.trait] = v;
    // a trait spanning several groups (win rate under ED, DI and LB)
    // renders one input per group over the same bar — keep them in sync
    el.querySelectorAll(`.trait-bar[data-trait="${inp.dataset.trait}"]`).forEach(o => { if (o !== inp) o.value = inp.value; });
    applyFilters();
  }));
  const lean = $('t-lean');
  if (lean) lean.addEventListener('change', () => { valueLean = lean.checked; applyFilters(); });
  const fl = $('t-flash');
  if (fl) fl.addEventListener('change', () => { traitFlash = fl.checked; buildTraitPanel(); applyFilters(); });
}

/* -------- build filters (height / weight / build for his position) --------
   Heights on record are strings ("6-1"; the down file also carries
   "6-4--" artefacts) — heightInches parses "6-1" and plain inches alike,
   for the records and for the filter inputs. The build composite is the
   average of a player's height percentile and weight percentile inside
   his position group in the CURRENT directory (midpoint percentiles,
   screen_position groups); it is null whenever either measurement is
   missing, and a null can never pass an active build filter — the
   result count says how many were not shown for missing data. */
function heightInches(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d+)\s*[-–']\s*(\d+)/);
  if (m) return parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const numOrNull = v => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };

function midPct(sortedVals, v) {
  let below = 0, equal = 0;
  for (const x of sortedVals) { if (x < v) below++; else if (x === v) equal++; }
  return sortedVals.length ? ((below + 0.5 * equal) / sortedVals.length) * 100 : null;
}

let buildCompCache = null;  // {dir, map: player id -> composite | null}
function buildComposite(p) {
  if (!buildCompCache || buildCompCache.dir !== curDir) {
    const byGroup = {};
    for (const q of PLAYERS) (byGroup[q.screen_position || q.position] = byGroup[q.screen_position || q.position] || []).push(q);
    const map = {};
    for (const g of Object.keys(byGroup)) {
      const hs = [], ws = [];
      for (const q of byGroup[g]) {
        const h = heightInches(q.height); if (h != null) hs.push(h);
        if (q.weight != null) ws.push(q.weight);
      }
      hs.sort((a, b) => a - b); ws.sort((a, b) => a - b);
      for (const q of byGroup[g]) {
        const h = heightInches(q.height);
        map[q.id] = (h != null && q.weight != null && hs.length && ws.length)
          ? (midPct(hs, h) + midPct(ws, q.weight)) / 2 : null;
      }
    }
    buildCompCache = { dir: curDir, map };
  }
  const c = buildCompCache.map[p.id];
  return c === undefined ? null : c;
}

function buildFilterState() {
  return {
    htMin: heightInches($('b-ht-min').value), htMax: heightInches($('b-ht-max').value),
    wtMin: numOrNull($('b-wt-min').value), wtMax: numOrNull($('b-wt-max').value),
    build: $('b-build').value
  };
}
const buildFilterActive = bf => bf.htMin != null || bf.htMax != null || bf.wtMin != null || bf.wtMax != null || bf.build !== 'any';

/* 'pass' | 'fail' | 'miss-wt' | 'miss-ht' — a miss means the player was
   excluded only because a measurement the active filters need is not on
   record for him. */
function buildTest(p, bf) {
  const h = heightInches(p.height), w = p.weight == null ? null : p.weight;
  const needH = bf.htMin != null || bf.htMax != null || bf.build !== 'any';
  const needW = bf.wtMin != null || bf.wtMax != null || bf.build !== 'any';
  if (needW && w == null) return 'miss-wt';
  if (needH && h == null) return 'miss-ht';
  if (bf.htMin != null && h < bf.htMin) return 'fail';
  if (bf.htMax != null && h > bf.htMax) return 'fail';
  if (bf.wtMin != null && w < bf.wtMin) return 'fail';
  if (bf.wtMax != null && w > bf.wtMax) return 'fail';
  if (bf.build !== 'any') {
    const c = buildComposite(p);
    if (c == null) return 'fail';
    if (bf.build === 'half' && c < 50) return 'fail';
    if (bf.build === 'quartile' && c < 75) return 'fail';
  }
  return 'pass';
}

/* -------- plain-language evidence lines for the tags section --------
   Presentation only (Tommy, Nov 19, 2026 — the tags section gets the
   same treatment as the skills strip): plainTagStat rewrites the
   evidence line joined from tags.json into coach language at render
   time. The data is untouched — same tags, same numbers, same
   thresholds; only the naming changes. Stat names follow TRAIT_DISPLAY
   where the tag reads off the same stat, and a percentile headlines
   as "Top X%" with the exact percentile small beside it (topHtml),
   exactly as the skills strip prints it. Every evidence template
   build_tags.py can print has a rule below; an unmatched line returns
   null and the section falls back to the raw string — the domtest
   corpus check fails if that ever happens on real data. */
const _tp = (n, one, many) => `${n} ${Number(n) === 1 ? one : many}`;
const _wtSeg = (w, m) => `at ${w} lb — the middle weight in his group is ${m} lb`;
const TAG_STAT_RULES = [
  // Pure Rusher
  [/^Win rate ([\d.]+)% \((\d+)\w+ pct\), pressure rate ([\d.]+)%$/,
    m => `Pass-rush win rate ${m[1]}% · ${topHtml(+m[2])} · Pressure rate ${m[3]}%`],
  // Speed Rusher (stand-in stat: the win rate read against his weight)
  [/^Win rate ([\d.]+)% \((\d+)\w+ pct\) at ([\d.]+) lb \(group median ([\d.]+)\)$/,
    m => `Pass-rush win rate ${m[1]}% · ${topHtml(+m[2])} · ${_wtSeg(m[3], m[4])}`],
  // Power Rusher (stand-in stat)
  [/^Sacks are ([\d.]+)% of his pressures \((\d+)\w+ pct\) at ([\d.]+) lb \(group median ([\d.]+)\)$/,
    m => `Sack finish ${m[1]}% — that share of his pressures end in a sack · ${topHtml(+m[2])} · ${_wtSeg(m[3], m[4])}`],
  // YAC Threat
  [/^YAC\/rec ([\d.]+) \((\d+)\w+ pct\)$/,
    m => `Yards after the catch ${m[1]} per catch · ${topHtml(+m[2])}`],
  // Speed Back (stand-in stat)
  [/^([\d.]+) yds\/carry \((\d+)\w+ pct\), ([\d.]+) yds before contact\/att$/,
    m => `Yards per carry ${m[1]} · ${topHtml(+m[2])} · Yards before contact ${m[3]} per carry`],
  // Power Back (his weight prints only when the record carries it)
  [/^Yds after contact\/att ([\d.]+) \((\d+)\w+ pct\)(?:, ([\d.]+) lb)?$/,
    m => `Yards after contact ${m[1]} per carry · ${topHtml(+m[2])}${m[3] ? ` · at ${m[3]} lb` : ''}`],
  // Zone Blocker
  [/^Zone share ([\d.]+)% of run blocks \((\d+)\w+ pct\), RBLK grade ([\d.]+)$/,
    m => `Zone-blocking share ${m[1]}% of his run blocks · ${topHtml(+m[2])} · Run-block grade ${m[3]}`],
  // Gap / Power Blocker
  [/^Gap share ([\d.]+)% of run blocks \((\d+)\w+ pct\), impact blocks ([\d.]+)%$/,
    m => `Gap-blocking share ${m[1]}% of his run blocks · ${topHtml(+m[2])} · Impact blocks ${m[3]}% of his run blocks`],
  // Pulling Lineman (stand-in stat; the pool is guards and tackles)
  [/^Gap share ([\d.]+)% \((\d+)\w+ pct\) \+ impact blocks ([\d.]+)% \((\d+)\w+ pct\) among non-center OL$/,
    m => `Gap-blocking share ${m[1]}% · ${topHtml(+m[2])} · Impact blocks ${m[3]}% · ${topHtml(+m[4])} · guards and tackles only`],
  // Ballhawk
  [/^\(INT\+PBU\) per target ([\d.]+) \((\d+)\w+ pct\), (\d+) INT \+ (\d+) PBU on (\d+) targets$/,
    m => `Plays on the ball ${m[1]} per throw at him · ${topHtml(+m[2])} · ${_tp(m[3], 'interception', 'interceptions')} and ${_tp(m[4], 'pass break-up', 'pass break-ups')} on ${_tp(m[5], 'throw', 'throws')} at him`],
  // Coverage
  [/^Rating allowed ([\d.]+) \((\d+)\w+ pct\), comp% allowed ([\d.]+)%$/,
    m => `Passer rating allowed ${m[1]} · ${topHtml(+m[2])} · Completions allowed ${m[3]}% of throws at him`],
  // Press / Jam
  [/^Press share ([\d.]+)% \((\d+)\w+ pct\), (\d+) press snaps on (\d+) coverage snaps, rating allowed ([\d.]+)$/,
    m => `Press coverage ${m[1]}% of his coverage snaps · ${topHtml(+m[2])} · ${m[3]} press snaps out of ${m[4]} coverage snaps · Passer rating allowed ${m[5]}`],
  // Contested Catch
  [/^Contested catch rate ([\d.]+)% \((\d+)\w+ pct\), (\d+) contested catches$/,
    m => `Contested-catch rate ${m[1]}% · ${topHtml(+m[2])} · ${_tp(m[3], 'contested catch', 'contested catches')}`],
  // Sure-Handed
  [/^Drop rate ([\d.]+)% \((\d+)\w+ pct\), (\d+) catches on (\d+) catchable$/,
    m => `Drop rate ${m[1]}% · ${topHtml(+m[2])} · ${m[3]} catches from ${m[4]} catchable balls`],
  // Vertical Stretch (stand-in stat)
  [/^([\d.]+) yds\/catch \((\d+)\w+ pct\), first-down rate ([\d.]+)%$/,
    m => `Yards per catch ${m[1]} · ${topHtml(+m[2])} · First-down rate ${m[3]}% of his catches`],
  // Deep Ball
  [/^Big-time throw rate ([\d.]+)% \((\d+)\w+ pct\), RTG ([\d.]+)$/,
    m => `Big-time throws ${m[1]}% of his throws · ${topHtml(+m[2])} · Passer rating ${m[3]}`],
  // Dual Threat
  [/^(\d+) rushing yards \((\d+)\w+ pct\) on (\d+) carries$/,
    m => `Rushing yards ${m[1]} on ${m[3]} carries · ${topHtml(+m[2])}`],
  // Third-Down Back
  [/^Receiving: (\d+) catches \((\d+)\w+ pct among RBs\) on (\d+) targets; PBLK grade ([\d.]+) on (\d+) pass-block snaps$/,
    m => `${m[1]} catches · ${topHtml(+m[2])} of running backs · on ${m[3]} targets · Pass-block grade ${m[4]} on ${m[5]} pass-blocking snaps`],
  // Verified Speed — an official track time, never a reported forty
  [/^(\d+)m ([\d.]+)(?: \(wind ([+-][\d.]+) \(over ([+-][\d.]+) limit - wind-aided\)\))?$/,
    m => `${m[1]} metres in ${m[2]} seconds${m[3] ? ` · wind ${m[3]} — over the ${m[4]} limit, so the time is wind-aided` : ''}`],
  [/^(\d+)y ([\d.]+)$/,
    m => `${m[1]}-yard dash in ${m[2]} seconds`],
];
const plainTagStat = stat => {
  for (const [re, fn] of TAG_STAT_RULES) {
    const m = String(stat).match(re);
    if (m) return fn(m);
  }
  return null;
};

function bestSection(p) {
  const ts = tagsOf(p);
  if (!ts.length) return '';
  return `<div class="card"><h2 class="sec" style="margin-top:2px">What he does best</h2>
    <ul class="tight">${ts.map(t => {
      const ev = plainTagStat(t.stat);
      return `<li><b>${esc(t.tag)}</b>${t.proxy ? ' <span class="tag-proxy">stand-in stat</span>' : ''}${TAG_GLOSS[t.tag] ? ` — ${esc(TAG_GLOSS[t.tag])}` : ''}<span class="best-evidence">${ev != null ? ev : esc(t.stat)}</span></li>`;
    }).join('')}</ul>
    <p class="p-sub">These tags come from his 2026 numbers, each one measured against the other players at his position and his level in this library: the headline number for a tag sits in the top quarter of that group, and the supporting number is at least in the top half. A tag marked <b>stand-in stat</b> is read off a related stat, because the direct measure is not in the data.</p></div>`;
}

/* -------- hometown line --------
   Up records carry hometown as "City, Fla." / "City, Ohio" / "City, MD";
   down records carry hometown_city + hometown_state. The line prints
   "City, ST" — the state normalised to its USPS code where it is a US
   state; anything else (France, Nigeria, American Samoa) prints as the
   record carries it. Nothing prints where neither city nor state is
   known, and no city is ever invented. */
const US_STATE = (() => {
  const m = {};
  const add = (code, ...names) => names.forEach(n => { m[n.replace(/[.\s'’]/g, '').toLowerCase()] = code; });
  add('AL', 'Alabama', 'Ala'); add('AK', 'Alaska'); add('AZ', 'Arizona', 'Ariz');
  add('AR', 'Arkansas', 'Ark'); add('CA', 'California', 'Calif'); add('CO', 'Colorado', 'Colo');
  add('CT', 'Connecticut', 'Conn'); add('DE', 'Delaware', 'Del'); add('DC', 'District of Columbia');
  add('FL', 'Florida', 'Fla'); add('GA', 'Georgia', 'Ga'); add('HI', 'Hawaii');
  add('ID', 'Idaho'); add('IL', 'Illinois', 'Ill'); add('IN', 'Indiana', 'Ind');
  add('IA', 'Iowa'); add('KS', 'Kansas', 'Kan', 'Kans'); add('KY', 'Kentucky', 'Ky');
  add('LA', 'Louisiana', 'La'); add('ME', 'Maine'); add('MD', 'Maryland', 'Md');
  add('MA', 'Massachusetts', 'Mass', 'Ma'); add('MI', 'Michigan', 'Mich'); add('MN', 'Minnesota', 'Minn');
  add('MS', 'Mississippi', 'Miss'); add('MO', 'Missouri', 'Mo'); add('MT', 'Montana', 'Mont');
  add('NE', 'Nebraska', 'Neb'); add('NV', 'Nevada', 'Nev'); add('NH', 'New Hampshire');
  add('NJ', 'New Jersey'); add('NM', 'New Mexico'); add('NY', 'New York');
  add('NC', 'North Carolina'); add('ND', 'North Dakota'); add('OH', 'Ohio');
  add('OK', 'Oklahoma', 'Okla'); add('OR', 'Oregon', 'Ore'); add('PA', 'Pennsylvania', 'Pa');
  add('RI', 'Rhode Island'); add('SC', 'South Carolina'); add('SD', 'South Dakota');
  add('TN', 'Tennessee', 'Tenn'); add('TX', 'Texas', 'Tex'); add('UT', 'Utah');
  add('VT', 'Vermont'); add('VA', 'Virginia', 'Va'); add('WA', 'Washington', 'Wash');
  add('WV', 'West Virginia', 'WVa'); add('WI', 'Wisconsin', 'Wis'); add('WY', 'Wyoming', 'Wyo');
  return m;
})();
const USPS_CODES = new Set(['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY']);
function hometownLine(p) {
  if (!p) return null;
  if (p.hometown_city || p.hometown_state) {
    const city = String(p.hometown_city || '').trim(), st = String(p.hometown_state || '').trim();
    if (city && st) return `${city}, ${st}`;
    return city || st || null;
  }
  const h = String(p.hometown || '').trim();
  if (!h) return null;
  const i = h.lastIndexOf(',');
  if (i < 0) return h;
  const city = h.slice(0, i).trim(), rest = h.slice(i + 1).trim();
  if (!city) return rest || null;
  if (!rest) return city;
  const code = US_STATE[rest.replace(/[.\s'’]/g, '').toLowerCase()]
    || (/^[A-Z]{2}$/.test(rest) && USPS_CODES.has(rest) ? rest : null);
  return `${city}, ${code || rest}`;
}

/* MAP_GEO_START */
/* ==== MAP GEO — generated by build_map_geo.py from data/map_paths.json;
   simplified public-domain boundary geometry (US Census via us-atlas;
   Natural Earth via world-atlas), one Albers projection. Do not hand-edit. ==== */
const MAP_VIEWBOX = "0 0 1080 627";
const STATE_PATHS = {"AL":"M726.3 505.9L750.3 503.8L756.9 527.5L759.6 532.3L759.4 533.5L760.5 534.1L759.1 535.7L758.7 539.2L760.0 542.7L759.9 546.5L761.1 548.5L736.0 551.2L735.8 552.9L738.2 554.7L737.9 556.4L738.8 557.3L738.0 559.0L732.8 560.3L735.1 559.3L733.5 558.1L733.3 555.8L732.3 555.1L731.4 559.3L728.8 559.0L726.6 541.6L727.4 507.0L726.3 505.9Z","AK":"M279.3 24.0L300.7 31.9L304.0 35.0L299.6 35.8L300.3 37.9L308.4 45.3L311.4 44.9L313.4 46.8L312.0 43.8L310.0 42.7L311.2 41.7L309.9 36.6L311.7 37.0L312.1 43.3L313.7 43.7L312.3 40.2L315.5 39.9L306.9 31.1L307.8 25.5L301.2 11.2L304.1 12.3L306.9 10.0L315.1 16.8L319.2 17.9L322.1 17.6L325.1 15.4L332.5 16.0L337.1 19.3L346.4 21.5L352.2 26.0L359.5 26.7L362.9 31.0L359.7 32.0L363.6 33.4L365.1 32.8L366.3 34.8L365.5 36.3L367.0 37.9L371.7 39.6L375.7 43.3L373.8 44.2L377.9 49.2L386.5 53.3L393.1 60.5L401.3 65.7L404.7 69.6L413.3 72.5L422.0 81.9L381.8 160.3L386.9 164.3L389.3 163.7L392.8 165.2L390.9 167.4L396.3 179.7L395.3 183.0L401.9 183.1L403.8 180.6L405.5 180.7L405.1 179.6L411.1 180.0L411.9 181.5L411.9 186.3L413.3 187.2L414.4 192.1L417.8 198.4L419.8 213.1L418.6 214.0L420.4 215.2L419.2 216.8L420.5 218.1L420.0 220.2L421.6 220.7L427.0 228.2L429.0 229.2L426.6 237.9L423.7 240.3L419.8 241.9L418.6 240.2L419.1 236.1L420.9 235.7L422.3 231.5L421.4 227.9L421.7 232.7L420.7 235.1L420.4 234.1L418.7 235.9L418.0 235.2L419.2 233.8L417.2 234.8L415.4 231.6L417.1 230.7L418.1 227.6L417.1 227.4L414.7 230.9L413.8 229.4L413.8 227.4L415.4 227.2L417.7 224.0L414.1 226.4L413.7 223.9L412.8 224.1L412.9 221.8L414.6 221.1L415.4 222.0L416.0 220.0L417.0 221.4L414.8 214.4L415.6 212.9L411.9 210.3L412.6 209.1L414.0 209.4L413.0 208.6L413.3 204.7L415.8 207.0L412.3 200.3L413.9 197.1L412.3 198.7L409.6 197.0L410.0 190.6L409.3 191.3L408.8 184.4L409.2 187.2L407.9 184.7L408.7 187.0L406.8 196.5L405.4 193.5L402.5 192.4L403.6 186.0L402.1 187.9L401.3 185.1L399.0 184.3L401.0 187.1L400.2 188.8L401.9 188.8L401.7 192.0L397.1 191.8L393.1 185.3L392.0 180.2L384.7 170.7L387.4 170.1L388.8 166.9L386.5 168.2L382.9 167.9L377.4 163.0L378.9 162.4L378.1 160.0L378.4 161.9L376.9 161.7L370.1 156.7L362.6 153.7L359.4 154.2L363.6 153.7L359.8 149.4L360.9 149.6L359.8 148.7L361.1 147.4L358.3 147.6L355.3 144.0L357.0 143.5L353.1 142.9L354.1 144.5L350.4 143.8L352.0 141.8L356.8 143.4L355.8 142.5L356.8 142.0L354.5 141.7L356.3 140.9L352.6 139.8L356.2 139.8L352.5 138.3L355.0 136.5L356.9 137.2L355.1 136.2L352.2 136.7L352.8 134.4L351.4 136.1L349.8 135.9L349.0 135.1L349.9 133.5L348.4 135.4L347.9 134.3L347.6 135.3L345.3 134.2L349.9 131.4L343.6 133.2L343.6 134.5L345.2 134.7L342.6 136.3L344.5 136.0L344.5 137.8L343.2 139.0L341.4 138.3L343.0 140.7L342.4 142.0L340.1 141.3L340.7 139.2L339.1 140.6L335.7 138.3L336.3 137.5L333.5 138.4L334.8 135.7L332.0 139.0L332.2 136.2L330.4 138.9L329.8 136.6L329.6 137.9L325.3 139.2L327.2 137.1L325.5 137.9L325.1 136.6L324.6 137.8L321.7 138.3L319.5 136.2L317.0 136.1L316.3 134.4L317.8 133.3L322.6 134.4L324.6 133.3L321.0 132.8L319.8 130.7L326.4 127.1L327.7 123.8L334.8 124.6L335.8 127.4L337.6 127.3L340.9 131.0L337.0 124.7L342.0 124.3L341.3 123.3L337.9 124.3L334.7 121.5L327.9 121.1L326.5 121.3L326.0 122.9L324.2 122.1L321.8 122.5L321.5 123.8L317.9 123.3L317.9 125.3L316.3 126.2L312.7 125.0L314.2 125.7L313.2 126.8L311.0 126.0L311.7 124.5L308.1 126.6L305.7 125.7L303.4 128.5L306.2 129.8L307.2 133.3L300.8 133.4L297.8 135.9L292.9 134.0L289.5 135.3L288.1 133.7L286.1 135.1L284.5 133.8L283.9 135.0L280.4 133.9L281.4 135.0L278.2 136.8L276.2 135.5L273.3 136.0L272.5 134.3L271.0 136.2L267.7 134.1L268.6 135.3L267.8 135.8L264.9 133.8L263.7 134.4L264.9 136.0L263.7 136.2L265.0 136.9L262.1 136.6L261.7 137.6L261.7 135.8L260.3 137.0L259.5 135.8L255.1 135.3L255.1 134.0L252.7 136.1L252.0 135.8L254.3 134.3L253.5 133.0L249.0 132.1L247.0 133.2L247.3 132.0L246.2 131.7L246.3 132.7L245.6 131.3L242.6 131.2L241.1 129.9L243.7 128.4L242.9 127.6L238.0 129.5L237.3 128.7L236.3 130.0L236.2 128.7L234.9 129.5L233.9 128.3L234.9 125.5L232.8 128.5L231.1 127.7L230.4 124.8L230.2 126.7L227.4 126.3L228.1 128.9L227.2 126.9L217.4 123.5L217.6 121.0L222.5 120.3L228.3 123.6L228.3 125.9L230.0 123.9L232.7 125.4L243.2 124.2L249.2 127.3L247.3 128.5L247.4 129.8L248.2 130.4L248.5 128.6L250.3 131.8L251.1 131.5L250.2 128.7L253.4 127.2L264.6 128.2L265.7 129.8L270.0 127.3L275.2 127.1L275.9 128.4L276.2 126.6L280.0 123.1L281.8 123.2L281.1 121.9L282.1 120.8L288.7 118.5L280.2 116.8L279.2 113.5L280.7 112.1L278.6 112.2L277.0 113.3L276.5 115.6L274.9 115.6L274.6 108.1L272.3 108.4L271.3 105.3L272.1 104.4L261.5 102.7L260.1 100.2L262.9 100.8L264.8 95.7L268.0 95.4L269.2 87.3L267.1 88.1L259.3 83.7L257.9 73.9L259.3 73.8L257.3 72.4L260.6 72.4L262.4 71.0L261.2 69.5L263.0 69.8L262.2 67.6L260.3 66.8L260.9 63.2L262.2 63.4L260.5 61.5L261.8 60.0L261.3 60.7L263.1 61.7L262.8 59.5L265.1 61.1L266.1 59.0L274.3 58.2L276.2 56.4L279.6 55.9L281.6 57.1L284.8 62.4L291.2 61.7L291.9 63.4L296.4 66.4L300.1 65.3L301.6 61.5L300.3 58.1L301.6 57.8L303.0 59.4L305.4 58.6L304.7 55.6L303.1 56.0L298.9 53.8L293.9 54.0L294.2 50.3L293.2 50.1L293.8 52.0L292.7 52.0L290.9 48.3L284.8 44.7L280.1 37.7L281.5 36.0L281.2 32.4L282.1 33.6L284.4 33.6L280.7 28.6L279.3 24.0ZM290.1 140.4L294.9 139.9L296.1 141.0L295.7 142.6L296.8 141.4L297.7 142.2L296.7 140.7L297.3 139.7L299.3 140.2L299.2 142.1L300.8 141.7L300.5 140.0L302.2 142.4L301.9 140.5L304.9 142.7L302.8 144.4L306.5 144.0L305.6 145.3L306.5 146.3L305.2 145.6L304.0 147.1L305.9 148.0L303.7 149.1L301.2 146.3L301.5 148.9L299.2 147.2L299.4 148.3L297.6 147.7L299.1 149.5L295.8 149.3L297.0 147.5L294.4 147.1L294.5 148.3L290.6 148.9L289.7 148.2L292.5 147.6L291.9 147.0L294.1 145.9L289.5 146.8L290.1 140.4ZM405.0 221.5L407.2 220.9L407.4 218.4L410.6 219.7L413.5 230.8L411.6 228.7L410.7 229.4L412.4 230.3L411.7 230.8L413.1 232.7L412.1 233.1L413.6 233.2L411.3 235.2L412.8 235.6L411.2 238.7L408.4 236.7L409.8 236.4L408.5 234.6L409.4 232.2L407.8 233.9L406.5 230.4L406.5 234.6L408.1 235.4L406.9 237.4L405.8 236.6L405.7 230.3L404.2 229.5L407.4 228.9L407.5 226.9L405.0 223.6L407.5 224.2L406.6 223.0L407.3 221.8L405.4 222.4L405.0 221.5ZM405.0 211.2L407.1 210.8L408.6 213.4L408.0 210.4L409.3 210.1L413.7 213.0L415.5 218.6L408.9 217.6L408.1 215.9L403.2 220.2L405.0 211.2ZM396.6 195.0L399.2 192.1L399.7 193.5L402.9 193.6L404.1 195.5L402.5 196.8L404.6 196.0L406.7 198.1L406.4 199.4L404.9 198.8L405.3 203.8L403.6 203.4L400.9 199.8L401.5 201.0L400.4 202.3L398.4 201.8L396.6 195.0ZM249.7 23.1L251.8 21.9L253.8 26.9L257.2 28.7L257.3 32.2L261.4 38.1L259.6 38.4L257.4 36.2L254.8 36.6L253.8 29.9L252.0 27.1L249.6 26.4L248.9 24.8L249.7 23.1ZM399.4 202.8L402.0 201.6L404.8 204.6L404.5 205.7L403.7 205.3L403.2 211.8L400.6 217.2L399.8 212.5L400.6 212.1L398.1 208.9L401.0 204.8L399.4 202.8ZM408.3 194.7L408.8 197.7L411.9 199.0L411.9 205.0L410.7 201.5L410.5 207.6L405.3 209.2L405.2 206.9L407.0 205.7L408.3 194.7ZM245.6 65.8L248.4 68.4L253.1 69.6L252.7 70.7L254.3 72.7L252.8 75.6L248.2 74.6L245.1 67.3L245.6 65.8ZM193.3 117.5L197.8 119.5L200.3 118.2L201.3 119.7L200.8 116.8L202.3 116.4L204.7 117.7L204.2 119.2L206.4 119.7L205.9 120.7L203.1 120.6L206.3 121.7L199.9 121.8L194.0 119.1L193.3 117.5Z","AZ":"M476.8 517.5L478.7 517.5L479.5 516.6L479.4 514.4L477.8 513.4L478.5 511.4L478.1 510.9L478.3 509.8L480.5 508.5L481.2 504.2L482.8 502.4L485.7 501.2L483.8 498.6L483.6 495.5L482.4 493.4L482.8 490.8L483.7 489.8L484.1 479.5L487.7 479.6L488.6 481.2L489.4 481.3L490.7 479.5L492.4 470.4L536.9 477.8L528.0 542.3L508.5 539.4L475.5 519.9L476.8 517.5Z","CO":"M543.2 432.2L571.3 435.6L602.6 438.1L599.7 484.2L573.2 482.1L536.9 477.8L543.2 432.2Z","FL":"M761.1 548.5L762.8 551.7L788.8 549.9L789.5 552.2L790.8 551.9L790.2 547.6L790.9 546.6L796.1 547.3L796.3 549.5L799.3 557.0L803.7 564.4L808.3 569.8L809.0 571.1L808.4 572.3L809.3 575.2L817.1 588.9L818.0 600.5L817.9 601.7L817.5 600.9L816.6 602.4L816.5 606.3L818.1 603.7L816.8 607.8L814.2 611.1L815.9 607.5L815.0 607.3L809.4 609.3L808.7 608.9L808.5 606.5L806.3 603.3L802.5 601.5L801.9 602.1L799.2 596.5L797.0 594.9L796.6 595.7L795.5 593.6L796.4 593.6L796.1 590.4L795.2 591.0L795.7 592.3L794.5 593.3L788.4 584.8L788.9 585.2L790.1 583.8L791.5 581.0L791.2 580.3L790.4 580.2L790.7 581.2L789.9 581.1L789.7 579.7L788.2 579.2L788.0 580.2L789.6 581.5L788.4 584.0L786.9 581.3L786.2 577.3L787.2 579.0L786.9 577.6L787.7 574.5L786.8 569.3L785.3 566.8L783.3 566.7L782.8 567.3L782.4 565.9L778.9 563.4L778.5 561.7L777.2 561.3L776.0 559.5L771.9 557.6L769.5 557.9L768.7 559.1L769.0 560.3L767.1 560.4L764.0 562.8L763.6 562.2L762.9 563.1L761.6 563.3L762.9 564.2L765.8 562.2L762.5 564.6L760.7 563.8L759.4 564.1L758.6 562.1L758.8 561.7L759.5 563.8L759.8 562.4L758.3 560.9L753.1 558.2L749.3 557.2L744.8 557.3L737.5 559.3L738.8 557.3L737.9 556.4L738.2 554.7L735.8 552.9L736.0 551.2L761.1 548.5ZM802.8 616.6L806.2 613.3L808.5 614.6L802.8 616.6Z","GA":"M750.3 503.8L773.2 500.8L771.6 503.4L771.6 504.7L775.0 506.6L776.2 506.4L780.0 512.1L786.7 516.7L786.8 518.1L788.9 520.1L791.5 521.2L793.0 525.5L795.3 526.9L796.7 530.8L799.4 531.4L798.3 533.5L797.5 533.4L797.7 534.6L796.5 535.4L797.3 536.4L796.3 537.4L797.1 537.7L796.6 541.3L795.0 544.2L795.9 544.1L796.0 547.2L790.9 546.6L790.2 547.6L790.8 551.9L789.5 552.2L788.8 549.9L762.3 551.3L759.9 546.5L760.0 542.7L758.7 539.2L759.1 535.7L760.5 534.1L759.4 533.5L759.6 532.3L756.9 527.5L750.3 503.8Z","IN":"M725.7 428.5L728.3 429.2L731.6 427.3L748.5 425.5L751.9 455.8L751.4 456.6L751.9 458.3L752.6 458.5L752.5 459.4L749.6 460.9L747.0 461.0L747.5 462.9L745.9 464.2L745.5 465.9L744.2 466.3L743.7 469.3L742.6 470.2L740.6 469.2L739.5 467.8L740.0 468.4L738.8 468.9L738.6 470.9L737.6 472.0L737.4 471.3L735.5 470.6L733.3 473.1L730.9 471.6L729.8 472.0L728.8 471.3L728.7 473.0L728.2 472.2L726.9 472.6L726.2 472.1L726.0 473.9L724.9 473.7L724.5 472.5L725.3 472.5L724.9 470.8L725.8 469.6L725.1 468.5L726.3 468.1L729.0 462.4L728.6 460.0L727.3 457.7L728.1 455.5L725.7 428.5Z","KS":"M601.8 449.6L629.7 450.9L660.2 451.3L661.7 452.7L663.5 452.5L664.0 454.3L663.3 454.2L662.0 456.6L664.0 458.4L664.4 460.2L666.5 460.9L666.7 485.8L633.0 485.6L599.7 484.2L601.8 449.6Z","ME":"M861.3 388.4L858.1 385.5L851.6 364.4L852.1 363.8L853.6 364.8L853.6 362.4L854.9 362.6L853.8 361.4L856.2 356.3L855.1 353.1L856.1 350.1L855.8 346.9L859.2 336.9L860.6 336.9L861.1 338.7L862.5 339.3L866.9 335.9L871.1 338.0L875.7 353.1L878.6 353.1L879.4 356.7L881.1 358.1L881.2 357.2L882.3 357.2L884.9 360.6L883.4 363.5L882.7 362.5L882.1 363.0L882.6 363.5L881.2 364.8L881.9 365.3L881.4 366.0L879.7 365.4L879.5 367.0L878.3 367.4L878.3 368.4L877.0 368.1L877.4 369.8L875.8 370.1L875.0 369.2L875.6 368.5L874.7 368.2L874.7 368.9L874.6 368.3L874.1 369.0L874.8 370.3L874.4 371.6L875.0 373.2L874.6 373.4L873.6 371.8L873.5 370.6L872.2 370.4L872.0 368.4L870.5 369.6L871.2 370.2L870.8 373.3L871.4 373.5L871.4 374.7L870.6 374.9L869.8 376.6L869.8 375.7L868.7 375.7L868.5 377.2L868.0 376.8L866.1 379.4L865.3 378.8L863.7 380.4L863.7 382.1L862.5 382.9L862.7 384.5L861.7 385.2L861.3 388.4Z","MA":"M841.6 397.2L857.7 393.7L859.3 391.3L861.0 390.7L861.8 392.6L863.4 392.6L863.2 393.6L861.5 394.5L862.0 394.9L861.0 396.3L861.2 397.7L862.1 397.1L863.7 397.9L864.8 399.0L864.6 400.3L866.0 400.6L866.4 401.8L867.7 402.3L869.0 402.3L870.7 401.0L869.4 398.4L868.1 398.3L869.9 398.5L871.3 400.5L871.7 403.6L871.3 402.3L868.5 403.4L864.3 407.2L866.3 405.1L866.0 403.2L865.2 403.1L865.1 404.1L864.0 404.8L864.0 406.1L862.6 406.6L862.1 404.9L860.1 404.0L859.0 401.4L847.3 404.7L841.7 405.4L841.6 397.2ZM865.4 407.6L866.9 405.7L868.2 406.5L868.4 406.0L868.6 406.8L866.0 408.1L865.4 407.6ZM870.1 406.8L871.4 406.7L872.0 405.6L872.8 406.8L870.1 406.8Z","MN":"M644.9 348.5L660.6 348.5L660.6 344.2L662.1 344.4L663.1 345.2L664.5 351.4L670.7 352.6L671.0 353.8L673.5 353.4L674.4 352.5L677.2 352.4L679.9 353.3L679.3 354.2L680.9 354.3L682.0 356.8L682.7 356.5L682.8 355.3L684.4 355.2L685.3 356.6L688.3 357.8L688.3 358.6L690.7 358.0L693.4 356.0L694.4 357.6L699.2 357.2L701.3 358.5L704.2 358.0L694.9 363.0L684.8 372.9L685.5 373.9L684.9 373.4L683.3 374.4L683.6 381.1L680.3 383.3L679.2 385.3L679.1 386.9L680.4 387.3L681.0 388.4L680.2 390.2L680.2 396.5L682.2 398.4L684.0 398.6L684.8 399.7L686.9 400.5L687.8 402.3L691.5 404.5L693.2 407.0L693.6 410.1L650.5 411.1L650.6 390.5L648.7 389.2L647.3 387.0L649.6 384.5L649.8 381.9L649.5 378.8L648.0 375.3L647.6 364.2L645.5 358.2L645.9 352.1L644.9 348.5Z","NJ":"M830.7 436.5L831.5 434.3L833.6 432.7L833.5 432.0L836.5 429.0L833.0 426.7L832.6 425.4L831.4 425.2L831.1 422.9L831.9 421.6L830.9 420.6L832.6 416.5L833.6 415.5L841.1 418.0L840.9 421.5L839.6 422.7L839.4 424.3L840.1 424.8L841.9 424.3L842.7 432.2L841.6 436.4L839.5 439.3L838.3 442.9L837.4 443.1L837.6 440.5L835.1 440.6L831.3 438.4L830.7 436.5Z","NC":"M783.6 480.8L803.1 478.2L835.5 471.7L840.4 479.7L838.1 477.6L836.0 473.2L834.4 472.2L834.4 473.1L835.3 473.2L837.3 477.0L835.8 475.3L836.1 476.2L833.3 475.2L834.7 476.6L833.8 477.1L833.0 476.6L833.5 477.5L831.1 477.0L832.7 477.6L830.5 479.2L829.5 479.0L828.8 476.4L828.6 477.9L829.8 480.2L835.1 478.4L836.1 482.0L836.2 478.5L837.5 478.3L839.0 481.9L837.6 482.8L836.0 486.0L832.8 486.2L831.5 484.8L832.6 484.1L831.1 484.9L831.9 486.2L827.6 485.6L828.3 486.3L832.8 486.8L833.2 487.4L832.7 489.4L830.9 491.4L829.0 490.6L829.2 491.2L831.3 491.8L833.6 489.6L834.5 490.5L835.1 490.4L834.7 489.7L835.4 489.9L835.6 490.7L834.0 494.0L832.9 493.0L832.6 494.0L834.1 494.3L837.6 488.8L834.2 495.1L832.6 494.2L829.5 495.2L825.2 498.9L823.3 502.3L822.7 506.0L820.6 505.7L817.4 507.0L805.0 498.1L794.7 499.7L794.6 498.3L793.0 496.6L792.1 497.5L791.9 496.3L779.5 497.4L773.2 500.8L762.1 502.3L762.1 499.6L764.4 498.4L764.3 497.2L765.3 495.8L768.9 494.8L771.6 492.1L773.1 491.8L773.6 490.0L774.4 489.9L775.9 488.0L776.7 489.2L778.3 487.1L781.2 486.5L782.0 484.4L783.8 483.7L783.6 480.8Z","ND":"M593.3 346.0L615.4 347.5L644.9 348.5L645.9 352.1L645.5 358.2L647.6 364.2L647.9 375.0L649.5 378.8L649.7 383.3L622.4 382.5L590.4 380.5L593.3 346.0Z","OK":"M591.1 483.5L633.0 485.6L666.7 485.8L666.7 491.5L668.6 504.2L668.5 524.4L664.8 523.2L663.9 521.9L661.4 520.8L660.8 521.8L658.5 521.7L658.0 521.1L655.8 522.2L654.8 521.6L652.8 522.2L652.5 523.1L651.4 523.0L650.8 523.9L650.2 522.9L648.3 522.1L648.7 521.5L647.9 521.4L647.0 522.3L645.5 520.8L644.0 522.0L643.6 523.5L642.8 521.2L640.6 522.3L640.5 521.3L638.4 520.4L636.5 521.9L635.7 521.5L635.9 520.3L634.6 520.1L634.5 518.4L633.9 518.8L632.1 518.3L630.9 519.3L629.4 518.1L624.3 517.4L623.8 515.2L622.7 514.5L622.5 515.4L619.6 515.2L617.6 513.0L617.0 513.1L617.9 490.8L590.7 489.2L591.1 483.5Z","PA":"M783.9 418.0L789.6 413.6L790.2 416.7L826.5 409.5L827.6 410.8L829.3 411.3L829.8 413.4L830.9 414.7L833.0 414.8L833.6 415.5L830.9 420.6L831.9 421.6L831.0 423.9L833.0 426.7L836.5 429.0L833.0 433.3L831.5 434.3L829.3 434.5L828.5 435.9L788.1 443.6L783.9 418.0Z","SD":"M589.4 391.2L590.4 380.5L622.4 382.5L649.7 383.3L649.6 384.5L647.3 387.0L648.7 389.2L650.6 390.5L650.5 411.1L649.3 411.1L649.2 411.7L649.9 412.3L649.6 414.2L650.3 414.3L650.6 415.4L648.9 419.4L650.5 422.7L649.1 422.5L648.5 420.8L644.1 418.5L638.9 418.2L637.4 419.4L633.5 416.6L587.5 414.0L589.4 391.2Z","TX":"M590.7 489.2L617.9 490.8L617.0 513.1L617.6 513.0L619.6 515.2L622.5 515.4L622.7 514.5L623.8 515.2L624.3 517.4L629.4 518.1L630.9 519.3L632.1 518.3L633.9 518.8L634.5 518.4L634.6 520.1L635.9 520.3L635.7 521.5L637.0 521.8L638.7 520.3L639.6 521.4L640.5 521.3L640.6 522.3L642.8 521.2L643.6 523.5L644.0 522.0L645.5 520.8L647.0 522.3L647.9 521.4L648.7 521.5L648.3 522.1L650.2 522.9L650.8 523.9L651.4 523.0L652.5 523.1L652.8 522.2L654.8 521.6L655.8 522.2L658.0 521.1L658.5 521.7L660.8 521.8L661.4 520.8L663.9 521.9L664.8 523.2L665.7 523.1L668.2 524.6L668.7 524.3L669.4 525.4L671.3 524.9L672.6 525.3L673.0 543.2L675.2 545.6L675.1 547.7L676.1 548.5L677.5 552.5L678.2 552.3L678.4 554.2L678.1 556.4L676.3 559.7L676.9 565.1L674.7 568.3L675.6 569.6L672.7 570.0L666.8 573.3L666.3 573.2L667.4 572.0L669.1 571.5L668.6 570.9L666.4 571.2L667.1 569.6L666.5 568.6L665.4 569.8L664.7 569.6L663.9 571.2L665.0 571.8L665.2 574.0L662.6 575.4L662.5 576.2L665.9 573.6L666.8 573.7L660.4 579.1L650.8 584.2L644.1 589.9L641.0 595.4L640.2 598.5L640.4 602.5L642.2 610.6L641.0 605.4L640.1 605.2L640.8 605.0L639.9 601.4L640.3 596.2L643.3 589.9L644.9 587.8L649.8 585.0L650.0 584.3L647.3 585.3L646.5 584.2L646.1 586.4L644.8 587.5L643.7 586.8L642.6 587.4L641.9 588.0L643.6 587.7L643.9 588.4L642.2 590.8L639.1 590.1L641.5 592.3L639.8 596.5L638.8 597.1L638.8 596.1L637.5 597.1L639.7 597.2L639.4 604.6L641.0 608.5L640.8 609.8L642.3 610.8L642.3 612.1L640.2 612.3L640.0 613.3L638.4 612.8L637.2 611.2L631.5 610.7L628.8 608.8L626.8 608.6L625.4 607.1L622.5 606.6L620.7 601.5L619.0 599.4L619.1 596.8L618.2 596.1L618.5 593.2L614.9 590.4L614.5 588.3L611.0 584.7L610.7 582.2L609.1 580.4L607.6 575.3L604.0 571.0L602.1 570.2L602.2 569.0L601.8 569.6L600.7 567.4L594.4 566.7L591.5 565.6L591.1 566.7L588.3 566.8L586.7 569.2L585.7 572.7L584.6 572.9L583.2 575.1L580.2 574.2L579.3 573.0L574.4 570.5L570.0 566.5L568.6 563.1L568.6 559.5L567.4 557.7L567.0 555.2L562.6 551.9L557.8 545.5L555.5 544.1L554.2 540.9L551.9 539.1L552.2 537.6L586.3 540.8L590.7 489.2Z","WY":"M589.4 391.2L585.6 436.9L555.2 433.7L526.3 429.7L533.5 384.4L565.1 388.8L589.4 391.2Z","CT":"M841.7 405.4L847.3 404.7L855.5 402.3L857.3 409.9L851.6 412.4L848.8 413.2L848.5 412.7L847.1 414.8L843.2 417.7L842.3 416.5L844.0 414.8L843.2 414.0L841.7 405.4Z","MO":"M656.2 444.6L671.1 444.5L690.8 443.4L691.8 444.2L693.6 446.0L692.9 448.3L694.4 453.4L700.4 458.9L701.1 462.3L701.8 463.0L703.3 461.8L705.9 462.9L704.0 468.9L704.2 470.4L708.1 472.9L708.1 474.0L709.0 473.6L712.1 475.9L713.2 479.2L712.4 480.6L713.8 483.3L714.6 483.8L714.9 482.9L716.4 484.0L715.7 488.5L714.2 488.1L713.7 490.0L713.3 488.7L712.6 488.8L713.2 491.0L712.3 491.8L713.1 492.4L711.6 492.5L712.5 494.0L711.8 495.2L705.6 495.9L708.1 492.5L708.1 491.2L707.3 490.0L666.7 491.5L666.5 460.9L664.4 460.2L664.0 458.4L662.0 456.6L663.3 454.2L664.0 454.3L663.5 452.5L661.7 452.7L659.2 450.7L659.5 449.9L656.8 445.9L657.2 445.1L656.2 445.2L656.2 444.6Z","WV":"M772.4 461.1L774.7 460.5L774.8 459.0L775.8 458.3L775.1 456.4L776.3 453.5L777.8 455.1L778.7 454.3L778.1 452.6L778.9 450.2L779.9 450.2L780.5 448.5L781.4 449.1L782.8 448.3L785.2 445.2L786.3 436.9L785.5 433.6L786.4 433.2L788.1 443.6L797.1 442.1L798.0 447.9L800.8 444.3L802.1 444.4L803.2 442.1L804.5 442.9L806.1 442.8L806.2 441.6L807.5 441.3L808.2 440.3L809.9 441.1L811.4 440.8L811.0 441.4L812.7 443.1L812.4 446.1L807.3 443.2L807.4 446.7L804.2 452.0L803.0 451.2L801.1 456.7L797.8 455.1L797.2 459.0L794.1 465.5L793.9 466.3L794.7 466.9L793.8 467.8L794.2 468.4L790.3 470.6L789.4 470.1L789.1 471.6L786.5 472.8L785.1 471.8L783.6 473.6L780.8 473.1L779.3 471.4L779.8 470.6L776.3 469.3L772.5 464.4L772.4 461.1Z","IL":"M693.6 446.0L694.0 443.4L696.0 442.5L696.2 440.7L697.2 439.6L697.2 437.5L695.8 436.0L696.2 433.9L701.1 432.4L703.3 429.0L703.2 425.5L701.3 424.4L698.9 421.2L722.6 419.7L722.5 421.9L725.7 428.5L728.1 455.5L727.3 457.7L728.6 460.0L729.0 462.4L726.3 468.1L725.1 468.5L725.8 469.6L724.9 470.8L725.3 472.5L724.5 472.5L725.2 473.7L724.2 475.3L725.2 476.9L721.6 478.7L722.1 482.3L717.2 480.9L715.7 482.8L716.1 483.8L714.9 482.9L714.6 483.8L713.8 483.3L712.4 480.6L713.2 479.2L712.1 475.9L709.0 473.6L708.1 474.0L708.1 472.9L704.2 470.4L704.0 468.9L705.9 462.9L703.3 461.8L701.8 463.0L700.5 460.9L700.4 458.9L694.4 453.4L692.9 448.3L693.6 446.0Z","NM":"M536.9 477.8L562.4 481.0L591.1 483.5L586.3 540.8L552.2 537.6L551.9 539.1L552.8 540.2L536.7 538.2L536.1 543.3L528.0 542.3L536.9 477.8Z","AR":"M666.7 491.5L707.3 490.0L708.1 491.2L708.1 492.5L705.6 495.9L711.4 495.5L712.2 496.7L711.4 496.5L711.2 497.0L711.8 497.3L709.6 498.8L710.6 499.7L709.8 500.2L710.1 501.2L709.0 500.8L708.9 502.5L708.6 501.6L707.9 502.4L708.8 502.7L708.0 503.8L709.0 505.6L708.0 505.9L707.8 506.9L706.9 506.8L707.5 508.3L705.9 509.2L705.4 508.7L705.7 510.3L705.3 510.5L705.1 509.7L704.7 510.4L705.6 511.1L705.2 511.6L704.5 511.2L704.9 514.0L704.1 515.2L703.2 514.8L702.4 516.7L701.5 516.6L702.8 517.2L701.4 517.5L702.2 518.2L701.5 519.3L700.4 519.3L701.3 521.5L699.9 521.7L699.9 522.3L701.0 522.9L699.1 523.0L700.1 523.8L699.2 524.3L699.2 525.7L700.2 525.2L699.5 526.1L700.9 525.7L700.1 526.6L700.6 527.9L701.1 527.6L700.7 529.1L699.7 529.4L700.5 530.0L700.1 530.6L672.8 531.4L672.6 525.3L671.3 524.9L669.7 525.5L668.5 524.4L668.6 504.2L666.7 491.5Z","CA":"M420.3 393.4L454.4 403.0L445.8 436.4L482.7 492.0L482.4 493.4L483.6 495.5L483.8 498.6L485.7 501.2L482.5 502.6L481.2 504.2L480.5 508.5L478.3 509.8L477.8 513.4L479.4 514.4L479.6 515.8L478.7 517.5L453.9 514.8L453.9 513.2L453.1 513.1L453.5 507.8L452.5 505.1L448.1 499.4L445.2 498.5L445.6 497.5L444.8 495.0L442.3 494.8L439.6 493.0L438.7 490.8L436.6 488.5L428.4 486.0L427.4 484.4L429.0 478.1L427.2 476.6L427.5 473.8L425.1 470.7L423.9 466.3L421.5 462.1L421.5 458.8L423.3 457.9L423.9 456.7L423.6 455.1L421.6 454.2L419.7 450.8L420.6 444.1L421.7 444.0L421.4 446.5L423.7 448.8L423.3 446.1L422.2 444.5L422.7 443.1L421.9 442.2L423.6 441.8L423.5 441.0L421.9 440.4L421.9 441.9L421.2 442.4L421.6 443.1L421.1 442.8L420.6 443.6L418.3 440.4L417.1 440.4L418.3 437.7L414.0 428.0L414.8 427.0L414.7 423.3L415.8 421.3L416.0 418.1L413.2 412.1L413.4 410.0L417.9 404.3L417.9 402.9L419.6 399.9L419.8 396.3L419.2 395.6L420.3 393.4Z","DE":"M828.5 435.9L829.3 434.5L831.5 434.3L830.3 436.7L830.8 438.5L832.9 440.4L834.5 444.0L836.7 444.9L838.0 448.8L832.4 449.9L828.5 435.9Z","DC":"M819.0 447.1L819.5 446.3L820.9 447.2L820.0 448.6L819.0 447.1Z","HI":"M32.3 478.3L35.8 477.6L36.9 474.9L37.9 475.2L41.4 481.8L41.7 483.6L40.9 484.6L41.7 485.1L41.3 486.1L42.1 488.4L39.4 488.8L33.2 487.2L30.4 488.1L29.3 485.6L31.2 482.9L32.3 478.3ZM34.3 463.6L36.0 463.3L36.2 465.3L38.5 466.5L39.6 469.2L39.3 470.0L34.9 468.7L34.5 468.1L35.5 466.3L34.3 464.9L34.3 463.6ZM25.0 447.3L26.4 448.3L28.6 448.2L28.0 451.3L28.2 452.1L29.0 452.1L28.5 454.0L26.9 453.3L24.6 450.9L25.0 447.3ZM15.2 433.3L18.3 433.0L19.9 434.1L20.2 435.6L18.6 437.0L17.0 437.0L15.8 435.8L15.2 433.3ZM30.2 458.0L31.4 457.2L35.8 461.4L33.6 461.3L30.2 458.0ZM31.0 461.3L32.6 462.3L32.7 463.8L30.7 463.5L31.0 461.3ZM10.1 431.8L12.6 431.6L11.8 432.5L10.0 432.6L10.1 431.8ZM31.7 467.0L33.5 467.6L32.6 468.0L31.7 467.0Z","IA":"M650.5 411.1L693.6 410.1L693.8 411.8L695.0 412.9L694.1 414.3L695.3 418.8L698.3 419.8L698.9 421.7L700.9 423.1L701.3 424.4L703.2 425.5L703.3 429.0L701.1 432.4L696.2 433.9L695.8 436.0L697.2 437.5L697.2 439.6L696.2 440.7L696.0 442.5L694.0 443.4L693.6 446.0L690.8 443.4L671.1 444.5L656.2 444.6L655.2 443.0L655.8 441.0L655.2 439.1L655.6 437.8L654.8 437.6L654.8 434.5L654.2 434.4L654.2 433.6L653.4 433.7L653.1 428.6L651.9 427.8L650.7 424.4L650.9 422.7L649.0 420.2L650.6 415.4L650.3 414.3L649.6 414.2L649.9 412.3L649.3 411.1L650.5 411.1Z","KY":"M716.1 483.8L715.7 482.8L717.2 480.9L722.1 482.3L721.6 478.7L725.1 477.4L724.2 475.3L725.2 473.7L726.3 473.4L726.2 472.1L726.9 472.6L728.2 472.2L728.7 473.0L728.8 471.3L729.8 472.0L730.9 471.6L733.3 473.1L734.2 471.5L736.0 470.5L737.6 472.0L738.6 470.9L738.8 468.9L740.0 468.4L739.7 467.7L741.5 469.7L742.6 470.2L743.4 469.5L744.2 466.3L745.5 465.9L745.9 464.2L747.5 462.9L747.0 461.0L749.6 460.9L752.5 459.4L751.4 456.6L752.5 455.3L753.9 456.0L755.2 455.3L757.7 458.6L760.0 458.6L762.7 460.0L763.9 459.0L765.9 459.9L767.2 459.5L769.3 457.7L769.9 459.5L772.3 460.7L772.5 464.4L774.3 466.0L774.0 466.6L776.3 469.3L779.4 470.4L776.4 474.0L773.4 476.2L772.3 479.0L770.7 479.6L770.3 480.9L765.5 483.4L727.9 486.9L726.0 486.5L726.3 488.6L713.9 489.5L714.2 488.1L715.3 488.7L716.1 487.5L716.1 483.8Z","MD":"M797.1 442.1L828.5 435.9L832.4 449.9L838.0 448.8L837.4 453.9L832.0 456.4L832.0 453.8L830.9 454.1L831.7 453.0L830.9 452.5L831.2 451.4L830.5 452.8L829.9 451.5L829.8 453.2L827.8 452.5L826.8 450.7L827.4 450.1L827.0 449.3L829.2 449.3L826.9 447.8L826.2 448.6L826.5 446.6L827.2 446.8L826.6 445.5L825.6 446.8L825.5 445.7L825.8 444.7L827.0 444.7L827.0 443.6L826.3 444.5L825.7 443.3L826.1 441.2L827.5 440.3L827.4 438.1L826.3 438.5L826.9 439.5L825.7 440.8L825.2 439.8L825.3 441.6L824.4 440.6L824.9 442.1L824.2 443.0L822.9 442.5L825.0 445.0L824.2 448.0L828.0 455.9L826.6 454.7L826.5 455.4L825.2 454.3L823.3 454.5L822.8 453.3L822.9 454.3L822.2 454.1L821.0 452.5L819.1 453.6L818.8 451.7L820.9 447.2L819.5 446.3L819.0 447.1L815.7 446.1L815.1 445.7L815.4 444.4L812.6 443.7L811.0 441.4L811.4 440.8L809.9 441.1L808.2 440.3L807.5 441.3L806.2 441.6L806.1 442.8L804.5 442.9L803.2 442.1L802.1 444.4L800.8 444.3L798.0 447.9L797.1 442.1ZM829.7 454.4L829.9 453.5L830.6 454.8L829.7 454.4Z","MI":"M731.6 427.3L733.1 425.6L734.9 421.4L735.6 417.3L735.0 412.5L731.8 405.9L732.5 403.8L731.5 401.0L733.2 397.4L732.9 393.4L734.2 392.7L734.1 391.1L735.1 390.0L736.2 390.1L738.0 386.9L737.5 391.1L738.1 392.0L738.8 389.4L738.7 392.2L739.5 390.0L739.3 386.1L742.7 384.3L741.2 383.5L740.9 382.4L742.1 380.7L741.5 380.2L743.3 379.7L746.0 380.9L748.0 380.9L749.4 382.4L754.1 383.3L756.4 386.8L754.9 386.9L756.8 390.3L756.9 394.6L755.4 395.9L755.3 398.1L753.1 399.5L752.7 402.0L755.2 403.5L756.7 401.7L756.8 399.9L757.5 400.0L756.9 399.5L760.7 397.2L762.2 397.9L766.5 409.2L766.2 413.4L765.0 414.6L764.7 413.7L765.3 412.8L763.9 413.2L763.5 416.3L762.2 417.3L762.0 420.0L759.9 424.4L748.6 426.2L748.5 425.5L731.6 427.3ZM698.1 374.8L701.1 373.4L702.8 371.6L705.6 371.2L709.1 369.0L714.8 363.5L717.7 363.1L718.5 363.8L716.6 364.1L714.6 366.4L713.2 369.1L713.0 371.6L715.5 369.0L714.6 370.6L716.1 369.5L718.2 369.7L720.0 370.7L722.2 373.8L724.8 373.1L726.5 374.1L727.4 374.0L727.2 372.8L728.2 373.6L731.5 370.9L736.6 370.2L740.6 368.8L740.1 369.6L740.4 372.1L743.5 371.7L743.9 372.4L747.4 370.7L747.9 374.0L746.9 374.8L747.9 374.6L750.1 376.5L751.0 376.1L750.4 375.2L751.9 375.0L753.3 376.2L752.7 377.1L748.3 376.9L746.3 377.7L743.9 376.6L743.5 379.1L741.1 377.4L737.1 376.9L735.8 378.6L731.2 379.3L730.7 381.0L729.1 382.2L729.0 383.3L728.1 382.7L729.2 380.1L727.3 380.6L727.1 382.2L726.1 382.9L725.5 381.0L721.7 389.9L720.4 388.8L720.9 386.8L719.2 386.8L719.6 383.4L716.7 382.0L716.9 380.8L713.6 380.0L712.3 380.4L708.8 379.0L700.6 377.3L699.7 375.4L698.1 374.8ZM706.2 359.4L712.2 355.4L710.5 357.5L708.1 358.9L708.8 359.0L707.2 359.9L706.2 359.4Z","MS":"M700.1 530.6L700.5 530.0L699.7 529.4L700.7 529.1L701.1 527.6L700.6 527.9L700.2 527.3L700.7 525.4L699.8 526.3L700.2 525.2L699.2 525.7L699.2 524.3L700.1 523.8L699.2 522.7L701.0 522.9L699.9 522.3L699.9 521.7L701.3 521.5L700.4 519.3L701.5 519.3L702.2 518.2L701.4 517.5L702.8 517.2L701.5 516.6L702.4 516.7L703.2 514.8L704.1 515.2L704.9 514.0L704.5 511.2L705.2 511.6L705.6 511.1L704.7 510.4L705.1 509.7L705.3 510.5L705.7 510.3L705.4 508.7L705.9 509.2L707.5 508.3L706.9 507.3L726.3 505.9L727.4 507.0L726.6 541.6L728.7 559.3L723.1 559.2L720.1 560.4L719.8 559.6L718.6 561.8L717.4 562.0L714.3 556.7L715.0 552.7L696.7 553.8L697.4 553.0L696.5 550.7L697.7 550.5L697.0 549.2L697.3 548.8L698.1 549.4L697.5 547.7L698.6 547.2L697.7 546.3L698.7 546.6L698.6 545.5L699.9 544.9L698.9 544.8L699.1 543.9L699.9 544.3L700.5 542.6L701.4 542.1L700.7 541.4L701.3 541.5L702.2 540.2L700.6 540.6L700.6 539.8L702.3 539.6L703.3 537.9L702.1 538.0L702.1 536.9L700.9 536.6L701.0 536.1L702.1 536.4L701.2 535.7L701.7 534.6L700.6 535.3L701.3 533.7L700.3 533.5L700.3 532.8L701.1 531.5L700.8 530.8L699.7 531.6L700.1 530.6Z","MT":"M503.5 332.6L547.3 340.6L593.3 346.0L589.5 391.2L565.1 388.8L533.5 384.4L532.6 390.3L530.4 386.7L529.5 387.1L529.3 389.0L526.5 388.9L526.2 388.2L524.2 388.4L522.9 387.6L521.8 388.8L518.7 387.8L518.0 389.2L516.9 387.9L516.5 384.1L515.7 383.4L514.9 383.7L514.2 382.6L514.6 380.4L512.9 377.0L512.9 373.8L511.7 372.4L508.4 374.6L507.0 373.1L507.8 371.5L507.4 370.7L509.0 369.7L508.5 366.9L511.1 361.2L508.9 361.0L508.5 359.7L507.9 360.1L504.8 353.0L501.9 350.5L503.1 350.1L502.3 349.2L502.8 347.5L501.1 343.9L503.5 332.6Z","NH":"M849.2 368.5L849.1 366.0L850.1 364.9L851.4 365.2L851.6 364.4L858.1 385.5L861.3 388.4L861.0 390.7L859.3 391.3L857.7 393.7L848.2 395.8L847.1 394.6L847.5 392.6L846.4 386.2L847.7 379.8L847.1 377.3L848.7 376.4L850.1 374.3L849.0 371.7L849.2 368.5Z","NY":"M789.6 413.6L794.1 409.5L796.1 406.5L793.7 403.5L793.3 401.4L797.8 399.3L803.5 398.6L805.8 399.4L811.7 397.3L815.8 393.4L815.1 390.8L814.4 390.6L815.7 389.6L813.4 388.5L813.5 386.5L816.3 384.0L819.9 377.7L823.2 374.9L834.9 372.2L835.5 376.4L836.8 378.4L836.7 383.1L838.2 386.0L838.0 388.1L838.9 387.5L839.6 388.2L841.6 397.2L841.4 405.1L843.2 414.0L844.0 414.8L842.3 416.5L843.2 417.7L842.3 419.5L842.7 420.0L844.7 417.7L846.9 417.7L847.5 416.8L851.7 415.6L854.1 412.9L853.8 413.6L856.0 414.4L857.8 413.0L849.0 420.0L842.0 423.2L840.7 421.7L841.1 418.0L833.6 415.5L833.0 414.8L830.9 414.7L829.8 413.4L829.3 411.3L827.6 410.8L826.5 409.5L790.2 416.7L789.6 413.6Z","OH":"M748.6 426.2L759.9 424.4L764.6 426.3L765.3 425.3L768.6 427.3L772.3 425.2L774.6 425.1L777.9 421.5L783.9 418.0L786.4 433.2L785.3 434.1L786.3 436.9L785.1 443.7L785.5 444.1L782.8 448.3L781.4 449.1L780.5 448.5L779.9 450.2L778.9 450.2L778.1 452.6L778.7 454.3L777.8 455.1L777.1 453.8L776.3 453.5L775.9 454.2L775.1 456.4L775.8 458.3L774.8 459.0L774.7 460.5L772.4 461.1L769.9 459.5L769.3 457.7L765.9 459.9L763.9 459.0L762.7 460.0L761.8 459.9L760.0 458.6L757.7 458.6L755.2 455.3L751.9 455.8L748.6 426.2Z","OR":"M439.6 348.3L440.2 348.3L440.6 349.9L442.6 350.0L443.9 351.6L443.6 356.6L447.1 358.9L451.1 358.1L454.7 359.2L455.6 360.6L460.2 360.2L461.9 361.1L468.9 360.3L472.4 361.1L473.6 360.6L489.6 364.4L490.4 366.7L491.6 367.4L492.2 369.6L487.7 375.4L487.2 377.0L485.5 378.1L483.0 381.6L483.0 382.9L484.8 383.9L485.2 385.0L483.3 388.6L478.7 408.8L451.7 402.3L420.3 393.4L419.6 390.1L420.8 386.7L420.4 383.3L427.2 372.5L433.2 358.0L436.0 349.4L436.1 347.5L436.9 348.7L439.6 348.3Z","TN":"M711.4 495.5L712.5 494.0L711.6 492.5L713.1 492.4L712.3 491.8L713.2 491.0L712.8 489.6L726.3 488.6L726.0 486.5L727.9 486.9L760.3 484.0L783.8 480.5L783.8 483.7L782.0 484.4L781.2 486.5L778.3 487.1L776.7 489.2L775.9 488.0L774.4 489.9L773.6 490.0L773.1 491.8L771.6 492.1L768.9 494.8L765.3 495.8L764.3 497.2L764.4 498.4L762.1 499.6L762.1 502.3L706.9 507.3L709.0 505.6L708.0 503.8L708.8 502.7L707.9 502.4L708.6 501.6L708.9 502.5L709.0 500.8L710.1 501.2L709.8 500.2L710.6 499.7L709.6 498.8L711.8 497.3L711.2 497.0L711.4 496.5L712.2 496.7L711.4 495.5Z","UT":"M503.3 414.0L528.1 418.3L526.3 429.7L543.2 432.2L536.9 477.8L492.4 470.4L503.3 414.0Z","VA":"M779.4 470.4L780.0 472.4L782.5 473.8L783.6 473.6L785.1 471.8L786.5 472.8L789.1 471.6L789.4 470.1L790.3 470.6L794.2 468.4L793.8 467.8L794.7 466.9L793.9 466.3L794.1 465.5L797.2 459.0L797.8 455.1L801.1 456.7L803.0 451.2L804.2 452.0L807.4 446.7L807.3 443.2L812.4 446.1L812.9 443.8L814.3 443.7L815.4 444.4L815.1 445.7L819.8 447.7L820.1 449.4L819.6 450.5L818.5 450.7L818.5 453.7L819.1 454.2L820.8 453.0L822.0 455.0L825.1 455.1L826.3 456.3L829.1 457.4L828.6 458.4L829.2 460.3L828.6 460.7L827.2 460.6L826.3 459.3L823.0 457.6L827.0 461.0L829.3 461.2L828.9 461.9L829.8 462.0L830.1 464.0L828.6 463.2L829.5 464.5L828.3 465.0L830.4 466.0L830.6 467.5L829.5 468.1L827.0 465.6L824.3 466.1L826.3 466.6L826.7 466.0L827.4 467.7L829.2 469.0L830.7 468.8L830.4 468.0L831.0 467.8L833.5 467.8L835.5 471.7L797.6 479.1L765.6 483.2L770.3 480.9L770.7 479.6L772.3 479.0L773.4 476.2L776.4 474.0L779.4 470.4ZM833.9 455.6L837.4 453.9L836.8 455.9L835.5 457.1L834.3 464.7L833.3 465.9L832.4 464.1L832.4 460.0L833.9 455.6Z","WA":"M496.2 331.0L489.4 360.1L490.0 362.5L489.3 363.3L489.6 364.4L473.6 360.6L472.4 361.1L468.9 360.3L461.9 361.1L460.2 360.2L455.6 360.6L454.7 359.2L451.1 358.1L447.1 358.9L443.6 356.6L444.2 353.2L442.6 350.0L440.6 349.9L440.2 348.3L438.4 347.4L437.0 347.7L436.2 346.6L435.6 347.0L436.9 343.0L436.4 345.9L436.9 346.0L437.0 344.7L437.3 345.1L437.9 344.5L437.7 343.2L438.9 342.6L437.1 341.7L437.3 339.9L437.5 340.4L439.5 340.1L437.8 338.5L437.0 339.6L437.9 330.2L436.9 327.0L437.9 322.5L442.6 326.6L447.8 328.7L448.9 328.3L449.2 329.6L450.2 329.7L450.2 330.9L450.5 329.6L451.5 329.5L451.0 330.0L451.1 330.6L451.8 330.1L451.3 331.0L451.8 332.6L449.6 334.2L450.0 333.0L446.1 337.2L448.0 337.4L446.5 336.9L452.0 333.0L452.0 332.0L452.5 332.6L450.4 339.3L449.8 339.9L449.3 339.0L449.7 338.1L449.2 338.4L449.4 340.0L448.7 340.6L448.1 339.0L448.6 337.9L448.0 338.8L447.7 339.9L448.8 341.0L450.6 339.0L451.1 339.7L452.2 339.1L452.2 336.4L452.9 336.2L452.4 335.5L454.2 332.6L454.9 332.5L454.4 329.3L453.7 329.6L454.1 331.2L453.3 330.1L453.5 328.8L454.4 329.1L454.7 328.3L452.8 326.1L453.7 325.7L454.7 326.5L454.7 325.5L455.4 325.3L455.1 323.1L454.4 323.8L454.0 323.3L453.6 320.6L454.2 320.2L496.2 331.0ZM449.7 323.6L450.5 323.6L451.2 324.5L450.9 323.7L452.1 323.0L453.3 323.9L452.1 326.3L451.5 326.3L449.8 324.7L449.7 323.6ZM451.7 328.6L453.4 326.9L453.9 328.4L452.1 328.6L452.9 329.4L452.7 331.4L453.1 330.5L454.0 331.5L453.6 332.9L453.1 331.8L452.5 331.9L452.6 329.6L451.7 328.6Z","WI":"M685.5 373.9L687.0 374.0L694.5 370.6L695.3 371.3L693.9 374.7L695.5 373.5L699.7 375.4L700.6 377.3L708.8 379.0L712.3 380.4L713.6 380.0L716.9 380.8L716.7 382.0L719.6 383.4L719.2 386.8L720.9 386.8L720.4 388.8L721.7 389.9L721.5 391.2L719.9 391.9L718.9 394.4L718.6 396.2L719.2 396.6L721.8 392.8L723.6 392.3L724.5 388.8L726.4 387.2L726.1 389.5L723.3 396.0L723.2 400.2L722.3 401.2L721.8 403.8L722.2 406.1L721.0 411.3L722.6 416.3L722.6 419.7L698.9 421.2L698.3 419.8L695.3 418.8L694.1 414.3L695.0 412.9L693.8 411.8L692.9 406.3L691.5 404.5L687.8 402.3L686.9 400.5L684.8 399.7L684.0 398.6L682.2 398.4L680.0 396.2L680.2 390.2L681.0 388.4L680.4 387.3L679.1 386.9L679.2 385.3L680.3 383.3L683.6 381.1L683.3 374.4L684.9 373.4L685.5 373.9Z","NE":"M587.5 414.0L633.5 416.6L637.4 419.4L638.9 418.2L643.3 418.3L647.5 420.2L648.5 420.8L649.1 422.5L650.9 422.7L651.3 426.4L653.1 428.6L652.8 429.4L653.6 430.6L653.4 433.7L654.2 433.6L654.2 434.4L654.8 434.5L654.8 437.6L655.6 437.8L655.2 439.1L655.8 441.0L655.2 443.0L656.3 444.3L656.2 445.2L657.2 445.1L656.8 445.9L657.5 447.7L658.6 448.4L659.2 450.7L660.2 451.3L629.7 450.9L601.8 449.6L602.6 438.1L585.6 436.9L587.5 414.0Z","SC":"M773.2 500.8L779.5 497.4L791.9 496.3L792.1 497.5L793.0 496.6L794.6 498.3L794.7 499.7L805.0 498.1L817.4 507.0L814.2 510.1L812.8 513.1L812.7 515.9L811.5 517.9L809.4 518.3L809.7 519.4L807.4 521.6L806.7 521.4L807.2 522.4L806.3 523.5L803.4 525.5L802.1 525.5L802.5 527.4L800.9 528.5L799.7 528.1L800.7 529.0L798.7 531.4L796.7 530.8L795.3 526.9L793.0 525.5L791.5 521.2L788.9 520.1L786.8 518.1L786.7 516.7L780.0 512.1L776.2 506.4L775.0 506.6L771.6 504.7L771.6 503.4L773.2 500.8Z","ID":"M489.6 364.4L489.3 363.3L490.0 362.5L489.4 360.1L496.2 331.0L503.5 332.6L501.1 343.9L502.8 347.5L502.3 349.2L503.1 350.1L501.9 350.5L504.8 353.0L507.9 360.1L508.5 359.7L508.9 361.0L511.1 361.2L508.5 366.9L509.0 369.7L507.4 370.7L507.8 371.5L507.0 373.1L508.4 374.6L511.7 372.4L512.9 373.8L512.9 377.0L514.6 380.4L514.2 382.6L514.9 383.7L515.7 383.4L516.5 384.1L516.9 387.9L518.0 389.2L518.7 387.8L521.8 388.8L522.9 387.6L524.2 388.4L526.2 388.2L526.5 388.9L529.3 389.0L529.5 387.1L530.4 386.7L532.6 390.3L528.1 418.3L505.1 414.4L478.7 408.8L483.3 388.6L485.2 385.0L484.8 383.9L483.0 382.9L483.0 381.6L485.5 378.1L487.2 377.0L487.7 375.4L492.2 369.6L491.9 367.9L490.4 366.7L489.6 364.4Z","NV":"M454.4 403.0L503.3 414.0L490.7 479.5L489.4 481.3L488.6 481.2L487.7 479.6L484.1 479.5L483.7 489.8L482.7 492.0L445.8 436.4L454.4 403.0Z","VT":"M834.9 372.2L849.2 368.5L849.0 371.7L850.1 374.3L848.7 376.4L847.1 377.3L847.7 379.8L846.4 386.2L847.5 392.6L847.1 394.6L848.2 395.8L841.6 397.2L841.3 396.7L839.6 388.2L838.9 387.5L838.0 388.1L838.2 386.0L836.7 383.1L836.8 378.4L835.5 376.4L834.9 372.2Z","LA":"M672.8 531.4L700.1 530.6L700.0 531.8L700.8 530.8L701.1 531.9L700.3 533.5L701.3 533.7L700.5 534.8L700.8 535.4L701.7 534.6L701.2 535.7L702.1 536.4L701.0 536.1L700.9 536.6L702.1 536.9L702.1 538.0L703.3 537.9L702.3 539.6L700.6 539.8L700.6 540.6L702.2 540.2L701.3 541.5L700.7 541.4L701.4 542.1L700.5 542.6L699.9 544.3L699.1 543.9L698.9 544.8L699.9 544.9L698.6 545.5L698.7 546.6L697.7 546.3L698.6 547.2L697.5 547.7L698.1 549.4L697.3 548.8L697.0 549.2L697.7 550.5L696.5 550.7L697.4 553.0L696.7 553.8L715.0 552.7L714.3 556.7L716.1 558.9L717.0 561.5L717.9 561.9L716.1 563.8L715.1 563.7L715.0 564.8L716.1 564.6L716.3 565.5L717.3 565.5L718.4 563.1L719.5 563.3L718.9 564.2L719.6 564.9L720.5 563.9L721.1 564.1L720.1 565.1L720.8 565.4L719.7 565.6L720.6 566.0L720.4 566.6L719.6 566.3L719.2 567.8L718.2 567.1L718.7 568.3L716.9 568.1L717.6 568.8L716.7 568.4L716.8 569.1L718.7 571.0L720.6 570.8L721.4 571.6L721.8 571.2L722.7 572.8L723.6 572.6L722.6 575.2L721.4 574.2L719.9 576.1L721.1 573.1L720.0 573.9L717.4 572.1L715.4 572.0L711.8 574.8L710.8 572.8L710.1 572.6L709.9 573.3L709.5 572.0L709.1 572.6L708.1 572.5L708.3 573.3L705.4 575.6L704.4 574.2L700.6 573.0L701.2 572.3L702.8 573.5L701.7 571.4L700.5 572.0L700.3 570.6L699.2 571.1L698.2 569.3L697.3 569.4L697.5 568.2L695.2 568.6L695.4 567.2L691.8 568.2L692.8 568.9L692.8 569.8L693.7 569.7L690.7 570.8L682.1 568.4L675.6 569.5L674.7 568.3L676.9 565.1L676.3 559.7L678.1 556.4L678.4 554.2L678.2 552.3L677.5 552.5L676.1 548.5L675.1 547.7L675.2 545.6L673.0 543.2L672.8 531.4ZM693.7 570.0L695.3 569.5L696.7 570.3L695.7 571.3L693.7 570.0Z","RI":"M857.1 410.2L855.6 402.4L859.0 401.4L861.2 405.0L860.9 405.5L859.6 404.1L860.0 408.8L857.1 410.2ZM861.5 404.8L862.1 404.9L862.6 406.6L862.2 407.2L861.3 405.6L861.7 407.1L861.0 407.7L861.5 404.8ZM859.6 411.5L859.7 410.6L860.1 411.4L859.6 411.5ZM860.5 407.7L860.3 406.4L860.5 407.7ZM860.2 405.4L860.7 405.7L860.2 405.4Z"};
const CANADA_PATH = "M453.6 320.1L438.3 298.7L427.1 290.1L426.5 279.5L429.7 273.4L422.6 265.9L424.5 257.2L419.3 246.8L421.2 241.5L426.6 237.9L428.8 231.5L420.6 221.0L417.9 198.7L412.0 186.4L411.0 180.1L395.7 183.3L391.5 168.7L387.2 163.4L381.8 160.3L422.3 81.4L441.0 98.2L453.9 97.0L460.8 101.1L478.5 101.8L480.8 106.3L485.2 105.8L487.6 102.5L490.7 104.5L496.9 114.5L505.4 111.2L504.2 117.5L511.0 118.1L513.6 116.3L519.7 118.5L538.2 130.1L550.5 133.7L556.9 139.5L548.4 142.2L557.9 146.0L577.6 146.7L582.7 152.8L589.3 149.1L584.2 144.7L588.1 142.2L599.2 142.2L608.4 150.0L614.5 149.8L624.0 154.4L640.7 153.9L640.2 148.4L645.1 147.0L653.5 150.0L653.5 158.5L657.0 151.3L661.4 151.5L663.8 142.7L651.7 134.2L652.2 125.2L658.3 119.4L665.1 120.6L670.5 123.9L678.0 132.8L673.4 137.1L683.5 138.3L684.0 147.1L690.8 139.9L697.7 144.9L696.6 151.6L702.4 157.1L710.7 142.2L710.0 132.9L725.6 132.8L733.4 135.9L734.4 140.1L731.1 145.3L735.6 149.4L735.6 153.8L725.6 161.7L718.0 164.1L711.8 162.0L704.6 179.5L698.4 186.5L690.1 187.8L685.6 192.1L685.6 198.5L678.7 200.1L671.6 208.4L665.2 219.9L662.8 228.0L662.7 240.0L672.2 241.6L678.8 259.2L687.9 256.7L700.6 260.5L712.8 268.7L729.2 274.5L748.0 273.7L748.3 283.2L752.0 293.8L758.9 305.2L771.3 313.9L776.2 309.4L778.0 297.5L771.3 281.0L765.5 276.2L775.4 269.3L781.5 260.4L783.7 252.3L781.7 245.4L775.5 237.5L766.3 231.2L771.7 219.1L762.2 195.5L765.9 192.5L782.9 192.6L787.3 188.9L802.3 194.6L805.1 197.9L816.0 195.7L823.8 216.0L829.9 215.9L836.1 220.4L843.3 212.1L848.0 193.4L879.4 219.5L879.2 226.8L897.8 232.7L908.9 231.1L914.4 232.5L920.6 239.9L926.2 239.0L930.5 241.6L936.0 252.7L929.7 264.3L920.2 272.7L915.0 284.7L903.9 290.9L888.2 294.1L870.6 300.8L867.0 310.4L859.3 317.9L847.0 347.8L852.9 344.3L860.7 326.5L873.2 312.8L883.6 308.3L891.7 311.3L887.4 320.8L898.8 338.9L910.5 340.8L922.2 334.7L925.0 320.0L928.5 327.4L934.8 329.4L928.3 339.9L907.9 359.6L901.9 370.3L895.7 371.5L892.4 362.4L902.7 349.0L882.6 357.4L875.7 352.8L871.1 338.0L866.9 335.9L862.4 339.2L859.1 337.1L855.7 346.9L854.4 361.9L849.3 365.7L849.2 368.6L823.0 375.1L812.4 388.9L810.7 393.8L795.4 396.8L792.1 399.2L795.2 405.7L766.3 424.2L762.1 420.1L767.8 402.0L761.6 382.4L752.6 378.2L753.3 376.1L749.8 375.1L747.3 370.9L743.8 372.2L741.0 367.2L712.5 354.1L705.9 357.8L693.8 355.7L687.7 357.5L680.1 354.3L666.9 352.2L664.5 350.3L663.1 344.1L660.6 344.2L660.6 348.5L644.9 348.5L570.7 343.7L503.5 332.6L453.6 320.1ZM742.1 108.1L746.3 104.2L765.9 107.8L767.4 111.0L776.3 106.9L782.9 110.5L796.0 110.2L801.3 112.0L808.5 118.1L800.2 124.8L814.2 126.5L823.1 125.6L833.4 130.8L841.9 128.3L842.5 134.9L836.7 148.6L828.7 147.1L817.3 141.4L810.7 144.6L811.5 149.9L830.9 156.8L837.6 164.6L837.9 172.0L813.2 168.8L831.6 178.2L833.6 181.2L816.6 182.3L802.6 180.2L794.4 177.5L795.7 174.3L776.6 169.0L777.3 171.7L761.0 176.7L755.5 174.4L758.0 166.8L779.8 160.7L777.2 157.9L778.1 153.0L783.1 142.6L777.8 136.7L757.3 133.9L760.2 131.1L753.6 127.1L748.9 127.5L744.2 125.5L741.9 128.4L732.5 131.0L713.0 131.8L692.9 130.1L688.3 127.5L693.5 123.4L686.1 123.9L684.0 116.1L687.4 109.1L692.4 105.7L705.1 102.5L701.9 107.6L706.4 111.9L710.4 105.3L722.6 100.7L732.4 107.0L732.4 112.0L742.1 108.1ZM601.0 107.6L606.3 111.3L609.9 124.8L627.7 134.0L626.9 137.7L618.1 137.8L621.3 141.3L619.3 144.4L600.5 139.1L583.8 140.5L560.2 138.9L558.1 134.3L551.3 130.6L546.4 130.5L541.4 122.6L567.7 124.4L558.0 120.7L539.6 117.2L537.6 113.6L550.1 113.2L533.9 107.4L543.7 100.6L557.9 99.1L562.7 101.5L559.5 104.5L571.1 104.3L577.5 109.2L583.7 106.3L588.0 109.4L591.2 117.5L594.2 114.6L591.5 106.4L601.0 107.6ZM940.4 260.9L939.1 279.8L942.1 274.4L947.6 274.5L946.8 279.2L954.2 279.2L956.2 275.3L964.4 275.2L965.9 283.6L969.8 279.6L978.6 289.8L980.0 300.2L971.4 302.4L969.0 293.3L966.4 292.9L962.4 305.6L957.9 307.2L960.8 300.1L952.8 300.6L931.5 310.1L929.1 307.4L932.1 301.9L927.8 300.3L931.1 291.6L931.3 272.2L932.9 264.6L937.1 258.5L940.4 257.5L940.4 260.9ZM528.9 83.7L547.6 90.4L556.6 97.6L536.6 100.4L529.1 104.0L528.2 107.4L513.9 107.4L512.3 103.2L502.1 95.7L515.8 85.7L512.5 80.0L528.9 83.7ZM724.1 174.2L737.9 178.5L739.1 183.0L743.3 181.6L748.0 184.0L743.3 187.9L733.8 187.0L729.9 183.1L716.9 195.0L714.2 189.5L706.3 191.3L711.0 186.0L712.0 169.6L716.2 169.9L717.7 173.9L720.5 172.1L724.1 174.2Z";
const MAP_LABELS = {"AL":[741.4,530.2],"AK":[340.4,92.0],"AZ":[508.5,505.0],"CO":[570.6,458.6],"FL":[789.4,572.0],"GA":[773.8,527.9],"IN":[738.3,448.2],"KS":[633.2,468.3],"ME":[865.7,360.0],"MA":[854.5,399.6],"MN":[667.5,379.2],"NJ":[836.8,428.7],"NC":[806.5,489.1],"ND":[619.6,365.2],"OK":[640.4,501.8],"PA":[808.9,426.2],"SD":[619.9,399.4],"TX":[622.1,548.9],"WY":[558.6,411.0],"CT":[849.0,408.9],"MO":[685.6,469.5],"WV":[789.2,456.1],"IL":[713.0,448.7],"NM":[560.1,510.6],"AR":[687.2,509.3],"CA":[445.1,457.6],"DE":[832.8,443.7],"DC":[819.9,447.4],"HI":[36.2,483.0],"IA":[675.2,427.1],"KY":[749.8,474.4],"MD":[821.7,445.3],"MI":[747.7,405.9],"MS":[714.5,532.8],"MT":[548.1,362.9],"NH":[852.5,383.4],"NY":[823.0,399.2],"OH":[767.6,440.1],"OR":[455.5,380.3],"TN":[742.6,494.3],"UT":[517.9,447.9],"VA":[806.6,466.1],"WA":[466.5,342.6],"WI":[702.8,396.7],"NE":[622.0,432.9],"SC":[795.5,510.2],"ID":[503.8,386.6],"NV":[475.4,439.5],"VT":[842.8,381.4],"LA":[693.5,553.3],"RI":[858.1,405.5],"CANADA":[637.6,250.6]};
const MAP_CALLOUTS = {"VT":[1006,381.4],"NH":[1006,397.4],"MA":[1006,413.4],"RI":[1006,429.4],"CT":[1006,445.4],"NJ":[1006,461.4],"DE":[1006,477.4],"MD":[1006,493.4],"DC":[1006,509.4],"_x":1006};
/* ==== END MAP GEO ==== */
/* MAP_GEO_END */

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

/* -------- overpay note (Tommy's ruling, Nov 18, 2026) --------
   When the latest valuation prices a player as an overpay — his price's
   percentile inside his position pool runs at least 30 points above his
   grade's percentile (steady value at or below −30) — the player page
   says so plainly beside the band, and the Value Board flags him. The
   valuation prices his projected destination, not his play; the note
   keeps that visible wherever the dollar figure prints. */
const OVERPAY_LINE = -30;
const isOverpay = p => !!(p && p.value && p.value.steady_value <= OVERPAY_LINE);
const overpayLine = p => {
  const v = p.value;
  return `<p class="overpay-note"><b>Priced as an overpay.</b> This band prices him at the ${f1(v.price_pct)} percentile of ${esc(v.position)} prices while his grade sits at the ${f1(v.grade_pct)} percentile — a ${f1(-v.steady_value)}-point gap. The valuation prices his projected destination, not his play.</p>`;
};

/* -------- Prospect List (highlight layer) --------
   The star beside a player's name in either directory — and the
   highlight button on his page — collects him here: one shortlist
   across both directions, before any school's class or price enters
   it. Saved per browser (localStorage portalProspects), like the
   saved classes. Pricing stays on the championship path. */
function loadProspects() {
  try { const v = JSON.parse(localStorage.getItem('portalProspects') || '[]'); PROSPECTS = Array.isArray(v) ? v.filter(x => typeof x === 'string') : []; }
  catch (err) { PROSPECTS = []; }
}
function saveProspects() { try { localStorage.setItem('portalProspects', JSON.stringify(PROSPECTS)); } catch (err) {} }
const isProspect = id => PROSPECTS.includes(id);
function updateProspectLink() { const a = $('prospectLink'); if (a) a.textContent = PROSPECTS.length ? `Prospect list (${PROSPECTS.length})` : 'Prospect list'; }
function syncProspectStars() {
  document.querySelectorAll('[data-prospect]').forEach(b => {
    const on = isProspect(b.dataset.prospect);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (b.classList.contains('btn-prospect')) b.textContent = on ? '★ On your prospect list — tap to remove' : '☆ Highlight as a prospect';
  });
}
function toggleProspect(id) {
  PROSPECTS = isProspect(id) ? PROSPECTS.filter(x => x !== id) : [...PROSPECTS, id];
  saveProspects(); syncProspectStars(); updateProspectLink();
}
const prospectStar = p => `<button type="button" class="pstar${isProspect(p.id) ? ' on' : ''}" data-prospect="${esc(p.id)}" aria-pressed="${isProspect(p.id)}" aria-label="Highlight ${esc(p.name)} on your prospect list" title="Highlight as a prospect">★</button>`;

function prospectStrip(p) {
  const on = isProspect(p.id);
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Prospect list</h2>
    <p><button type="button" class="btn-prospect${on ? ' on' : ''}" data-prospect="${esc(p.id)}" aria-pressed="${on}">${on ? '★ On your prospect list — tap to remove' : '☆ Highlight as a prospect'}</button>
    <span class="p-sub">Your highlighted shortlist lives on the <a href="#/prospects">Prospect List</a> page — highlight first, price him later in a school’s saved class.</span></p></div>`;
}

function renderProspects() {
  const el = $('prospectBody');
  if (!el) return;
  const ps = PROSPECTS.map(id => byIdAll[id]).filter(Boolean);
  if (!ps.length) {
    el.innerHTML = `<div class="card"><h2 class="sec" style="margin-top:2px">No prospects highlighted yet</h2>
      <p>Tap the star beside any player’s name in either directory — or the highlight button on his page — and he collects here: one shortlist across both directions, before any school’s class or price enters it.</p>
      <p><a href="#/up">Browse the FCS — Moving Up directory →</a> · <a href="#/down">Browse the P4 — Moving Down directory →</a></p></div>`;
    return;
  }
  const rows = ps.map(p => `<tr data-id="${esc(p.id)}">
      <td>${photo(p)}</td>
      <td><a class="pname" href="#/player/${encodeURIComponent(p.id)}">${esc(p.name)}</a>${p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : ''}${p.direction === 'down' ? '<span class="down-badge">P4 Down</span>' : ''}${tagBadges(p.id)}</td>
      <td>${esc(p.position)}</td>
      <td>${esc(p.school)}</td>
      <td class="num">${p.headline_grade == null ? '—' : p.headline_grade.toFixed(1)}</td>
      <td class="num">${p.blended_score == null ? '—' : blendVal(p)}</td>
      <td>${p.band ? esc(p.band.likely) : 'Pro evaluation only'}</td>
      <td>${eligChip(p.elig_qualified)}</td>
      <td class="num">${nilRange(p) || '—'}</td>
      <td><button type="button" class="btn-remove" data-unprospect="${esc(p.id)}" aria-label="Remove ${esc(p.name)} from your prospect list">×</button></td>
    </tr>`).join('');
  el.innerHTML = `<div class="card prospect-board">
    <h2 class="sec" style="margin-top:2px">Your highlighted prospects — ${ps.length}</h2>
    <p class="p-sub">The highlight layer: one shortlist across both directories, saved in this browser. Pricing and classes live on the <a href="#/championship-path">championship path</a> — open a player’s page to save him to a school’s class.</p>
    <p class="prospect-ctl"><button type="button" class="btn-ghost" data-printprospects>Print / Save PDF</button> <button type="button" class="btn-ghost" data-clearprospects>Clear the list</button></p>
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th></th><th>Player</th><th>Pos</th><th>School</th><th class="num">Grade</th><th class="num">Blended</th><th>Likely</th><th>Eligibility</th><th class="num">NIL band</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="p-sub">${esc(NIL_LABEL)}</p></div>`;
}

function nilSection(p) {
  if (!p.nil_status) return '';
  let h = `<div class="card"><h2 class="sec" style="margin-top:2px">Estimated NIL projection</h2>`;
  if (p.nil_status === 'no_estimate') {
    h += `<p><b>No estimate</b> — ${esc(p.nil_reason || 'no destination projection to price')}.</p>`;
  } else {
    h += `<p><span class="grade-big">${fmtMoney(p.nil_floor)}–${fmtMoney(p.nil_ceiling)}</span> <span class="p-sub">a year — floor to ceiling at his projected destination</span></p>`;
    h += `<p class="p-sub">Basis: ${esc(p.nil_basis || '')}${p.nil_projection_basis ? ` (${esc(p.nil_projection_basis)})` : ''}${p.nil_band_basis ? ` · band evidence: ${esc(p.nil_band_basis.toLowerCase())}` : ''}</p>`;
    if (isOverpay(p)) h += overpayLine(p);
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
    test: (p, set) => !set.size || set.has(p.elig_qualified) },
  { id: 'f-offer', name: 'Offer',
    values: () => ['NIL', 'Scholarship only', 'Walk-on'],
    test: (p, set) => !set.size || offerMatches(p, set) },
  { id: 'f-arch', name: 'What he does best',
    /* the archetype list follows the position selection (Charlie,
       Nov 20, 2026): with positions ticked it offers only the
       archetypes players at those positions actually hold, counted
       against those positions; no position ticked = the full list */
    values: () => [...new Set(archPool().flatMap(p => tagsOf(p).map(t => t.tag)))].sort(),
    label: v => `${v} (${archPool().reduce((n, p) => n + (tagsOf(p).some(t => t.tag === v) ? 1 : 0), 0)})`,
    test: (p, set) => !set.size || (archModeAll ? holdsAllTags(p, set) : holdsAnyTag(p, set)) }
];
let archModeAll = false;    // directory archetype mode: ANY ticked tag (default) vs EVERY ticked tag
/* the pool the archetype list is built from: the players at the
   currently ticked positions, or the whole library when no
   position is ticked (Charlie's feedback round, Nov 20, 2026) */
function archPool() {
  const pos = filterSel['f-pos'];
  return pos && pos.size ? PLAYERS.filter(p => pos.has(p.position)) : PLAYERS;
}
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
      `<label class="ms-opt"><input type="checkbox" value="${esc(v)}"${filterSel[def.id].has(v) ? ' checked' : ''}> ${esc(def.label ? def.label(v) : v)}</label>`).join('');
    updateMsButton(def);
  });
  syncOfferNote();
}

function clearFilter(id) {
  filterSel[id].clear();
  msWrap(id).querySelectorAll('.ms-opt input').forEach(cb => { cb.checked = false; });
  updateMsButton(filterDef(id));
}

/* When the position selection changes, the archetype panel is
   rebuilt from the players at the selected positions (Charlie,
   Nov 20, 2026): a ticked archetype nobody at those positions
   holds is dropped from the active filter, so the result count
   reflects the drop. */
function refreshArchFilter() {
  const def = filterDef('f-arch');
  const valid = new Set(def.values());
  for (const v of [...filterSel['f-arch']]) {
    if (!valid.has(v)) filterSel['f-arch'].delete(v);
  }
  msWrap('f-arch').querySelector('.ms-opts').innerHTML = def.values().map(v =>
    `<label class="ms-opt"><input type="checkbox" value="${esc(v)}"${filterSel['f-arch'].has(v) ? ' checked' : ''}> ${esc(def.label ? def.label(v) : v)}</label>`).join('');
  updateMsButton(def);
}

function clearAllFilters() {
  FILTER_DEFS.forEach(d => clearFilter(d.id));
  archModeAll = false;
  const aa = $('f-arch-all'); if (aa) aa.checked = false;
  traitBars = {}; valueLean = false; traitFlash = false;
  dirGeoSel.clear();
  buildGeoPanel();
  ['b-ht-min', 'b-ht-max', 'b-wt-min', 'b-wt-max'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  const bs = $('b-build'); if (bs) bs.value = 'any';
  buildTraitPanel();
  buildFilterPanels();
}

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
  $('q').value = ''; clearAllFilters(); $('f-hv').checked = false; $('f-ulm').checked = false; $('f-myteam').checked = false; $('f-blend').value = '';
  syncMyTeamToggle();
  sortKey = 'name'; sortDir = 1;
  closeMs();
  buildFilterPanels();
  buildTraitPanel();
  buildGeoPanel();
  $('dirTitle').textContent = DIRS[dir].label;
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
    $('totalChip').textContent = UNIVERSE_META
      ? `${fmtN(UP.length + DOWN.length)} evaluated · ${fmtN(UNIVERSE_META.total_listed)} listed`
      : `${UP.length + DOWN.length} players`;
  }
}

function showView(name) {
  for (const v of ['splash', 'directory', 'downempty', 'player', 'compare', 'comparison', 'teamcmp', 'champ', 'changes', 'value', 'prospects', 'map', 'prototype', 'universe']) {
    $('view-' + v).hidden = v !== name;
  }
}

function setBackLinks(dir) {
  document.querySelectorAll('.back-dir').forEach(a => { a.href = '#/' + dir; });
}

/* -------- top-level menu bar --------
   The dark bar is the site's menu (Tommy, Nov 19, 2026): "Find
   players" and "Teams" are click-open menus holding every route,
   "What changed" is a plain link, and the bar is static HTML —
   identical on every view. route() closes the menus and marks the
   current page's item active; a player or compare page marks its
   own direction's directory. */
function closeTopMenus() {
  document.querySelectorAll('.tmenu-panel').forEach(p => { p.hidden = true; });
  document.querySelectorAll('.tmenu-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
}
function toggleTopMenu(btn) {
  const panel = btn.parentElement.querySelector('.tmenu-panel');
  const open = panel.hidden;
  closeTopMenus();
  if (open) { panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
}
function navRouteFor(hash) {
  if (hash === '#/up' || hash === '#/down') return hash;
  if (hash.startsWith('#/player/') || hash.startsWith('#/compare/')) {
    const seg = hash.split('/')[2] || '';
    const p = byIdAll[decodeURIComponent(seg.split(',')[0])];
    return p ? '#/' + (p.direction || 'up') : null;
  }
  if (hash.startsWith('#/championship-path')) return '#/championship-path';
  for (const r of ['#/team-comparison', '#/compare-conferences', '#/prototype', '#/map', '#/value', '#/prospects', '#/changes', '#/universe'])
    if (hash === r) return r;
  return null;
}
function markActiveNav() {
  const cur = navRouteFor(location.hash || '');
  document.querySelectorAll('[data-nav]').forEach(a => {
    const on = a.dataset.nav === cur;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

/* "Fits my team": the player's PRINTED fits include the school — the
   g6 / p4 fit rows on his record, plus the separately printed
   Louisiana-Monroe fit (ulm_fit / ulm_qualifier). A fit means he
   CLEARS THE ROOM (Tommy, Nov 20, 2026): the Will Contribute list
   does NOT count here — this filter reads the strict fits only, as it did
   before the Nov 19 depth tier briefly widened it. The fit rows
   carry full school names identical to the championship pool's team
   names (verified across all 766 records: every fits school is a
   CHAMP team name), so the match is plain string equality. */
function fitsMyTeam(p, teamName) {
  const f = p.fits;
  if (!f || !teamName) return false;
  if (f.ulm_fit && f.ulm_fit.school === teamName) return true;
  if (teamName === 'Louisiana-Monroe' && f.ulm_qualifier) return true;
  return [...(f.g6 || []), ...(f.p4 || [])].some(r => r.school === teamName);
}

/* -------- offer tiers on fits (Tommy, Nov 19, 2026) --------
   Every fit row carries move (Up / Lateral / Down, against the
   player's current level) and offer — the offer the school should
   make on that fit: "NIL" (his band applies), "Scholarship only",
   or "Walk-on" (a defined tier that activates only with FCS
   destination rooms; no FBS fit carries it yet). The stamps are
   computed by apply_fits_levels_join.py; the rule is stated in
   portal_scouting/nil_layer/VALUE_METHOD.md and on the player-page
   fits intro. No dollar amount ever attaches to Scholarship only —
   the tier's job is to be filtered on, and to price at $0 in the
   class builder and Budget Report. */
const LVL_RANK = { FCS: 0, G6: 1, P4: 2 };
function offerTierAt(p, teamName) {
  const f = p && p.fits;
  if (!f || !teamName) return null;
  if (f.ulm_fit && f.ulm_fit.school === teamName) return f.ulm_fit.offer || 'NIL';
  for (const r of [...(f.g6 || []), ...(f.p4 || [])])
    if (r.school === teamName) return r.offer || 'NIL';
  for (const r of [...(f.depth_g6 || []), ...(f.depth_p4 || [])])
    if (r.school === teamName) return r.offer || null;
  return null;
}
/* The Offer filter (directories + Prototype): with My Team set, the
   tier AT that school decides; without it, any fit at a ticked tier
   anywhere matches. syncOfferNote keeps the active reading printed
   beside the control so the list is never misread. */
function offerMatches(p, set) {
  if (!set.size) return true;
  if (myTeam) {
    const t = offerTierAt(p, myTeam);
    return t != null && set.has(t);
  }
  const f = p.fits || {};
  const rows = [...(f.g6 || []), ...(f.p4 || []), ...(f.depth_g6 || []), ...(f.depth_p4 || [])];
  if (f.ulm_fit) rows.push(f.ulm_fit);
  return rows.some(r => r.offer && set.has(r.offer));
}
function syncOfferNote() {
  const txt = myTeam
    ? `Offer reads at ${myTeam} — the offer your school would make him on his fit there.`
    : 'Offer reads anywhere — a player matches when any school he fits would make him that offer. Set “My team” in the bar above to read the offer at your school.';
  const n = $('offerModeNote'); if (n) n.textContent = txt;
  const pn = $('p-offer-note'); if (pn) pn.textContent = txt;
}
/* The offer tier of a championship avail/getable entry at a team,
   read off the player's fit rows at that school. Where he carries
   no fit row there: a getable entry's starter flag marks the
   starter tier ("NIL") and a depth entry falls back to the stamped
   rule applied from his band; an entry with neither prices from his
   band as before (null tier). */
function offerTierForEntry(e, teamName) {
  const p = byIdAll[e.id];
  const t = p ? offerTierAt(p, teamName) : null;
  if (t) return t;
  if (e.nil_status !== 'priced') return null;
  if (e.starter) return 'NIL';
  if (e.starter == null) return null;
  const team = (CHAMP && CHAMP.teams.find(x => x.name === teamName))
    || (TEAMS && TEAMS.teams.find(x => x.name === teamName));
  const dest = team && team.level;
  const bandLvl = p && p.nil_level;
  if (e.nil_floor === 0) return 'Scholarship only';
  if (bandLvl && dest && LVL_RANK[dest] < LVL_RANK[bandLvl]) return 'Scholarship only';
  return 'NIL';
}
const isScholarshipTier = t => t === 'Scholarship only' || t === 'Walk-on';
/* Price of an avail/getable entry at a team and mark: a
   scholarship-tier add is not an NIL spend — $0 at every mark. */
function tierPrice(e, hit, teamName) {
  const tier = offerTierForEntry(e, teamName);
  if (isScholarshipTier(tier)) return { price: 0, tier };
  return { price: hitPrice(e, hit), tier };
}

function currentFilters() {
  return {
    q: $('q').value.trim().toLowerCase(),
    hv: $('f-hv').checked, ulm: $('f-ulm').checked, mt: $('f-myteam').checked,
    blend: $('f-blend') ? $('f-blend').value : ''
  };
}

/* -------- directory hometown filter + the filter ribbon --------
   Stage 4 (Tommy, Nov 19, 2026): the directory's controls live in a
   ribbon — a slim tab strip (Search / Size / Hometown / Archetypes /
   Skills, one tab per search dimension) over an expandable panel,
   collapsed on load so the player list owns the page. The strip
   always carries the result count, a "filter groups active"
   indicator and Clear all, so a collapsed ribbon never hides that
   the list is filtered. Containment only: every control keeps its
   id, behaviour and filter logic.
   The Hometown tab is a real filter group of its own: the map view's
   buckets (states + Canada / International / Hometown not on record)
   as a multi-select over the home_state / home_country fields every
   record carries, counted in the current directory. A player with no
   hometown on record matches only the not-on-record bucket. */
let dirGeoSel = new Set();   // directory hometown selection (map keys)
let ribbonTab = null;        // the open ribbon tab, or null (collapsed)

function buildGeoPanel() {
  const el = $('geoPanel');
  if (!el) return;
  const counts = {};
  for (const p of PLAYERS) { const k = mapKeyOf(p); counts[k] = (counts[k] || 0) + 1; }
  const row = k => `<label class="map-opt"><input type="checkbox" data-geocheck="${k}"${dirGeoSel.has(k) ? ' checked' : ''}> <span class="map-opt-name">${esc(mapKeyLabel(k))}</span> <span class="map-opt-n">${counts[k] || 0}</span></label>`;
  const stateCodes = Object.keys(STATE_PATHS).sort((a, b) => (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b));
  el.innerHTML = `<p class="p-sub" style="margin-top:0">Filter this directory by the hometown on each player’s record — the same buckets as the map view, counted in this directory. Tick as many as you like; a player matches when his hometown bucket is ticked. A player with no hometown on record matches only “Hometown not on record”.</p><div class="geo-list">${stateCodes.map(row).join('')}<div class="map-opt-sep"></div>${['CANADA', 'INTL', 'UNKNOWN'].map(row).join('')}</div>`;
  buildGeoMap();
}

/* The Hometown tab's map projection (Tommy, Nov 19, 2026): the state
   list projects onto a compact rendering of the site's own map — the
   same geometry, Canada block and globe block as the Map view, drawn
   smaller beside the list. List and map are ONE selection (dirGeoSel):
   ticking a state lights it on the map, clicking a state on the map
   ticks its box, and the filtering is live either way. "Done" at the
   panel's foot collapses the ribbon back to the strip, which then
   shows the Hometown group active with the number of places selected.
   Scope: the ribbon's Hometown tab on the directory views only — the
   standalone Map page keeps its own selection and behaviour. */
function buildGeoMap() {
  const el = $('geoMap');
  if (!el) return;
  const counts = {};
  for (const p of PLAYERS) { const k = mapKeyOf(p); counts[k] = (counts[k] || 0) + 1; }
  let svg = `<svg class="map-svg geo-svg" viewBox="${MAP_VIEWBOX}" role="group" aria-label="Map of Canada and the United States — click a state to tick it in the list">`;
  svg += `<path class="map-region${dirGeoSel.has('CANADA') ? ' sel' : ''}" data-geokey="CANADA" d="${CANADA_PATH}"><title>Canada — ${counts.CANADA || 0} players in this directory</title></path>`;
  for (const code of Object.keys(STATE_PATHS))
    svg += `<path class="map-region${dirGeoSel.has(code) ? ' sel' : ''}" data-geokey="${code}" d="${STATE_PATHS[code]}"><title>${esc(STATE_NAMES[code] || code)} — ${counts[code] || 0} players in this directory</title></path>`;
  for (const [code, pt] of Object.entries(MAP_LABELS)) {
    if (MAP_CALLOUTS[code]) continue;
    svg += code === 'CANADA'
      ? `<text class="map-lab map-lab-can" x="${pt[0]}" y="${pt[1]}">CANADA</text>`
      : `<text class="map-lab" x="${pt[0]}" y="${pt[1]}">${code}</text>`;
  }
  for (const [code, pt] of Object.entries(MAP_CALLOUTS)) {
    if (code === '_x') continue;
    const lp = MAP_LABELS[code] || [0, 0];
    svg += `<line class="map-leader" x1="${lp[0]}" y1="${lp[1]}" x2="${pt[0] - 4}" y2="${pt[1]}"/><text class="map-callout${dirGeoSel.has(code) ? ' sel' : ''}" data-geokey="${code}" x="${pt[0]}" y="${pt[1]}">${code}</text>`;
  }
  svg += '</svg>';
  el.innerHTML = `${svg}
    <div class="geo-blocks">
      <button type="button" class="geo-block${dirGeoSel.has('INTL') ? ' sel' : ''}" data-geokey="INTL" aria-pressed="${dirGeoSel.has('INTL')}">${GLOBE_SVG}<span>International · ${counts.INTL || 0}</span></button>
      <button type="button" class="geo-block${dirGeoSel.has('UNKNOWN') ? ' sel' : ''}" data-geokey="UNKNOWN" aria-pressed="${dirGeoSel.has('UNKNOWN')}"><span>Hometown not on record · ${counts.UNKNOWN || 0}</span></button>
    </div>
    <p class="p-sub geo-mapnote">The map and the list are the same selection — tick a place in either one and it lights up in both. When you are done selecting, press <b>Done</b> and the map goes away; the strip keeps the count.</p>`;
  syncGeoNote();
}

function syncGeoNote() {
  const n = $('geoSelNote');
  if (!n) return;
  n.textContent = dirGeoSel.size
    ? `${dirGeoSel.size} place${dirGeoSel.size === 1 ? '' : 's'} selected — the directory below is filtered to ${dirGeoSel.size === 1 ? 'it' : 'them'}.`
    : 'No places selected — the whole directory shows.';
}

/* Keep the list, the mini-map and the foot note in step after a toggle
   from either side, without rebuilding (a rebuild would lose the
   list's scroll position). */
function syncGeoUI() {
  document.querySelectorAll('#geoPanel [data-geocheck]').forEach(cb => { cb.checked = dirGeoSel.has(cb.dataset.geocheck); });
  document.querySelectorAll('#geoMap [data-geokey]').forEach(k => {
    k.classList.toggle('sel', dirGeoSel.has(k.dataset.geokey));
    if (k.hasAttribute('aria-pressed')) k.setAttribute('aria-pressed', dirGeoSel.has(k.dataset.geokey) ? 'true' : 'false');
  });
  syncGeoNote();
}

function activeFilterGroups() {
  const f = currentFilters();
  const groups = [];
  if (f.q || f.hv || f.blend || f.ulm || f.mt || FILTER_DEFS.some(d => d.id !== 'f-arch' && filterSel[d.id].size)) groups.push('search');
  if (buildFilterActive(buildFilterState())) groups.push('size');
  if (dirGeoSel.size) groups.push('hometown');
  if (filterSel['f-arch'].size || archModeAll) groups.push('archetypes');
  if (Object.keys(traitBars).length || valueLean || traitFlash) groups.push('skills');
  return groups;
}

function syncRibbon() {
  const ind = $('ribbonActive');
  if (!ind) return;
  const groups = activeFilterGroups();
  ind.hidden = !groups.length;
  ind.textContent = groups.length ? `${groups.length} filter group${groups.length === 1 ? '' : 's'} active${groups.includes('hometown') ? ` — Hometown: ${dirGeoSel.size} place${dirGeoSel.size === 1 ? '' : 's'} selected` : ''}` : '';
  document.querySelectorAll('.ribbon-tab').forEach(b => {
    b.classList.toggle('open', ribbonTab === b.dataset.rtab);
    b.classList.toggle('has-active', groups.includes(b.dataset.rtab));
    b.setAttribute('aria-expanded', ribbonTab === b.dataset.rtab ? 'true' : 'false');
  });
  const chev = $('ribbonChev');
  if (chev) chev.hidden = !ribbonTab;
}

function setRibbonTab(tab) {
  ribbonTab = tab;
  document.querySelectorAll('.ribbon-panel').forEach(pn => { pn.hidden = pn.dataset.rpanel !== tab; });
  syncRibbon();
}

function applyFilters() {
  const f = currentFilters();
  let rows = PLAYERS.filter(p => {
    if (f.q && !(p.name.toLowerCase().includes(f.q) || (p.school || '').toLowerCase().includes(f.q))) return false;
    for (const def of FILTER_DEFS) if (!def.test(p, filterSel[def.id])) return false;
    if (dirGeoSel.size && !dirGeoSel.has(mapKeyOf(p))) return false;
    if (!passesTraits(p)) return false;
    if (f.hv && !p.hidden_value) return false;
    if (f.blend && !(p.blended_score != null && p.blended_score >= Number(f.blend))) return false;
    if (f.ulm && !(p.fits && p.fits.ulm_qualifier)) return false;
    if (f.mt && myTeam && !fitsMyTeam(p, myTeam)) return false;
    return true;
  });
  // Build filters apply LAST, over the players every other filter kept,
  // so the not-shown count below is honest: it names only the players
  // excluded here, and only because a measurement is not on record.
  let missingNote = '';
  const bf = buildFilterState();
  if (buildFilterActive(bf)) {
    let missWt = 0, missHt = 0;
    rows = rows.filter(p => {
      const r = buildTest(p, bf);
      if (r === 'pass') return true;
      if (r === 'miss-wt') missWt++;
      else if (r === 'miss-ht') missHt++;
      return false;
    });
    if (missWt) missingNote += ` · ${missWt} not shown — no verified weight on record`;
    if (missHt) missingNote += ` · ${missHt} not shown — no verified height on record`;
  }
  const keyFns = {
    name: p => p.name.toLowerCase(),
    position: p => p.position,
    school: p => (p.school || '').toLowerCase(),
    grade: p => (p.headline_grade == null ? -1 : p.headline_grade),
    blended: p => (p.blended_score == null ? -1 : p.blended_score),
    rung: p => (p.band && p.band.likely_rung != null ? p.band.likely_rung : -1)
  };
  const fn = keyFns[sortKey] || keyFns.name;
  rows.sort((a, b) => { const x = fn(a), y = fn(b); return (x < y ? -1 : x > y ? 1 : 0) * sortDir; });
  document.querySelectorAll('th[data-sort] .arrow').forEach(a => a.textContent = '');
  const th = document.querySelector(`th[data-sort="${sortKey}"] .arrow`);
  if (th) th.textContent = sortDir === 1 ? '▲' : '▼';
  $('resultCount').textContent = `${rows.length} of ${PLAYERS.length} players${missingNote}`;
  syncRibbon();
  $('dirEmpty').hidden = rows.length > 0;
  $('dirBody').innerHTML = rows.map(p => `
    <tr data-id="${esc(p.id)}">
      <td class="cmp-cell"><input type="checkbox" class="cmp-check" data-cmp="${esc(p.id)}" ${cmpSel.includes(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)} to compare"></td>
      <td>${photo(p)}</td>
      <td>${prospectStar(p)}<span class="pname">${esc(p.name)}</span>${p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : ''}${p.fits && p.fits.ulm_qualifier ? '<span class="ulm-badge">LM QUALIFIER</span>' : ''}${tagBadges(p.id)}${flashBadges(p.id)}</td>
      <td>${esc(p.position)}</td>
      <td>${esc(p.school)}</td>
      <td>${esc(p.conference_book)}</td>
      <td class="num">${p.headline_grade == null ? '—' : p.headline_grade.toFixed(1)}</td>
      <td class="num">${p.blended_score == null ? '—' : blendVal(p)}</td>
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

/* The offer on a fit row: NIL prints plain (his band applies);
   Scholarship only and Walk-on print bold — they are the tiers a
   coach filters for, and neither ever carries a dollar figure. */
const offerCell = r => r.offer === 'Scholarship only' ? '<b>Scholarship only</b>'
  : r.offer === 'Walk-on' ? '<b>Walk-on</b>'
  : r.offer ? esc(r.offer) : '';
const moveCell = r => r.move ? esc(r.move) : '';

function fitsTable(title, rows) {
  if (!rows || !rows.length) return '';
  return `<p class="kv">${esc(title)}</p><div class="fits-scroll"><table class="fits"><tr><th>School</th><th>Conference</th><th>Incumbent</th><th class="num">Inc. grade</th><th>Move</th><th>Offer</th></tr>
    ${rows.map(r => `<tr><td>${logoImg(r)}${esc(r.school)}</td><td>${esc(r.conf || '')}</td><td>${esc(r.incumbent || '')}</td><td class="num">${r.inc_grade == null ? '—' : Number(r.inc_grade).toFixed(1)}</td><td>${moveCell(r)}</td><td>${offerCell(r)}</td></tr>`).join('')}</table></div>`;
}

/* WILL CONTRIBUTE (Tommy, Nov 20, 2026) — the secondary list on the
   player page, replacing the Nov 19 depth-tier tables ("Also
   improves the depth at"). A fit clears the room; the Will
   Contribute list names the schools where he is NOT a fit but would
   land at a set depth-chart spot or better in the room (QB 3, RB 3,
   WR 7, TE 3, OL 10, DL 6, LB 4, CB 4, S 4 — the table lives in
   help_fits.py). His spot = 1 + the room's graded men above his
   grade; ungraded men count as below him. Stamped onto the records
   by apply_help_join.py as `help` (the display set: top 5 G6 + top
   5 P4, Louisiana-Monroe always included when he qualifies there)
   and `help_counts` (the full list's totals). The depth-tier data
   fields stay on the records — the team and championship machinery
   still reads them — but they no longer print on this page. */
function helpSection(p) {
  if (!p.help || !p.help.length) return '';
  const total = p.help_counts ? (p.help_counts.g6 || 0) + (p.help_counts.p4 || 0) : p.help.length;
  const more = total - p.help.length;
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Will contribute</h2>
    <p class="p-sub">Schools where he wouldn’t start but would land in the rotation and contribute — his spot in the room shown.</p>
    <div class="fits-scroll"><table class="fits"><tr><th>School</th><th>Conference</th><th>Level</th><th class="num">His spot</th></tr>
    ${p.help.map(r => `<tr><td>${esc(r.school)}${r.ulm ? ' <span class="ulm-badge">ULM</span>' : ''}</td><td>${esc(r.conf || '')}</td><td>${esc(r.level || '')}</td><td class="num">${esc(r.spot_label || '')}</td></tr>`).join('')}</table></div>
    ${more > 0 ? `<p class="p-sub">…and ${more} more school${more === 1 ? '' : 's'} where he would land in the rotation and contribute.</p>` : ''}
  </div>`;
}

/* SCHEME FIT (Charlie's feedback round, Nov 20, 2026) — directly
   under the fits section: his own scheme headline set beside the
   conferences his printed fits play in. The scheme claim comes
   only from his own data — his scheme-split headline (scheme_line,
   stamped by apply_scheme_join.py from the deep-dive splits) or,
   where he has no splits, his top "What he does best" tag — and
   the conferences come only from the fit and Will Contribute rows
   actually printed on this page. No team scheme tendencies are
   claimed: the library holds no team scheme data. No block when he
   has neither a scheme claim nor a printed school list. */
function schemeFitSection(p) {
  const claim = p.scheme_line
    || (tagsOf(p).length ? `What he does best: ${tagsOf(p)[0].tag}` : null);
  if (!claim) return '';
  const confsOf = rows => {
    const out = [];
    for (const r of rows || []) {
      if (r.conf && !out.includes(r.conf)) out.push(r.conf);
    }
    return out;
  };
  let confs = [], whose = 'His top fits play in';
  if (p.fits) {
    confs = confsOf([...(p.fits.g6 || []), ...(p.fits.p4 || []),
                     ...(p.fits.ulm_fit ? [p.fits.ulm_fit] : [])]);
  }
  if (!confs.length && p.help && p.help.length) {
    confs = confsOf(p.help);
    whose = 'The schools where he would contribute play in';
  }
  if (!confs.length) return '';
  const named = confs.map(c => `the ${c}`);
  const confLine = named.length <= 5
    ? `${whose} ${named.length === 1 ? named[0]
        : `${named.slice(0, -1).join(', ')} and ${named[named.length - 1]}`}.`
    : `${whose.replace(' play in', '')} span ${confs.length} conferences, including ${named.slice(0, 3).join(', ')}.`;
  return `<div class="card"><h2 class="sec" style="margin-top:2px">Scheme fit</h2>
    <p>${esc(claim)}. ${esc(confLine)}</p></div>`;
}

/* Skills at the top of the bio (Tommy, Nov 19, 2026): the player's
   archetype tags and his strongest standard traits in the standard
   styling, his flashes beside them in red — each flash labelled
   "Limited action" with its sample volume printed. Plain-language
   pass (Nov 19, 2026): one explainer line up top, percentiles print
   as "Top X%" headlines with the exact percentile small beside them,
   and every pill shown gets a one-line plain gloss underneath. */
function skillsStrip(p) {
  const tags = tagsOf(p);
  const traits = traitsOf(p).slice().sort((a, b) => b.pct - a.pct).slice(0, 4);
  const flashes = flashesOf(p).slice().sort((a, b) => b.pct - a.pct);
  if (!tags.length && !traits.length && !flashes.length) return '';
  const tagHtml = tags.map(t => `<span class="tag-badge${t.proxy ? ' proxy' : ''}">${esc(t.tag)}${t.proxy ? ' · stand-in' : ''}</span>`).join('');
  const traitHtml = traits.map(e => `<span class="trait-badge">${esc(traitName(e))} · ${topHtml(e.pct)}</span>`).join('');
  const flashHtml = flashes.map(flashBadgeHtml).join('');
  const glossLine = (name, gloss) => gloss ? `<span class="skills-gloss"><b>${esc(name)}</b> — ${esc(gloss)}</span>` : '';
  const glosses = [
    ...tags.map(t => glossLine(t.tag, TAG_GLOSS[t.tag])),
    ...traits.map(e => glossLine(traitName(e), traitGloss(e))),
    ...flashes.map(e => glossLine(traitName(e), traitGloss(e))),
  ].filter(Boolean).join('');
  return `<div class="skills-strip"><span class="skills-label">Skills — what he does best</span><p class="skills-explainer">Every skill is measured against the other players at his position and his level in this library — “Top 10%” means he sits in the best tenth of that group. Red skills showed up in limited action: the number is real, the sample is small, and the sample is printed on the pill.</p><div class="skills-pills">${tagHtml}${traitHtml}${flashHtml}</div>${glosses ? `<div class="skills-glosses">${glosses}</div>` : ''}</div>`;
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
  if (wrap && cb) {
    const on = !!myTeam;
    wrap.hidden = !on;
    if (hint) hint.hidden = on;
    if (nm) nm.textContent = on ? `— ${myTeam}` : '';
    if (!on && cb.checked) { cb.checked = false; if (curDir) applyFilters(); }
  }
  syncSplashTeam();
}
/* the landing page's slim My Team line: names the school when one is
   set (with its championship path), otherwise invites setting it */
function syncSplashTeam() {
  const nm = $('splashTeamName'), link = $('splashTeamLink');
  if (!nm || !link) return;
  if (myTeam) {
    nm.textContent = `Your team — ${myTeam}.`;
    link.hidden = false;
  } else {
    nm.textContent = 'Set “My team” in the bar above and the site frames itself around your school.';
    link.hidden = true;
  }
}
/* the team skin: while My Team is active, the team's colour drives
   the --accent variable and its mark sits in the top bar on a light
   chip (so black marks read on black). Unselecting removes the inline
   accent entirely — the site is full black neutral again, and every
   team-framed default switches off with it. Saved classes are
   per-team data in localStorage; they are not touched here. */
function applyTeamSkin() {
  const logoEl = $('myTeamLogo'), clearBtn = $('myTeamClear');
  if (!logoEl || !clearBtn) return;
  if (myTeam) {
    const brand = TEAM_BRANDS[myTeam] || null;
    if (brand && brand.accent) document.documentElement.style.setProperty('--accent', brand.accent);
    else document.documentElement.style.removeProperty('--accent');
    const t = myTeamObj();
    const logo = (t && t.logo) || (brand && brand.logo);
    if (logo) { logoEl.src = 'logos/' + logo; logoEl.alt = `${myTeam} logo`; logoEl.hidden = false; }
    else logoEl.hidden = true;
    clearBtn.hidden = false;
    document.body.classList.add('team-on');
  } else {
    document.documentElement.style.removeProperty('--accent');
    logoEl.hidden = true;
    logoEl.removeAttribute('src');
    logoEl.alt = '';
    clearBtn.hidden = true;
    document.body.classList.remove('team-on');
  }
}

function setMyTeam(name) {
  myTeam = name && CHAMP && CHAMP.teams.some(t => t.name === name) ? name : null;
  // Unselecting switches the personalisation off entirely: unless the
  // user picked a team on the championship page itself (champPicked),
  // the path goes back to opening on nobody.
  if (!myTeam && !champPicked) champSel = null;
  try { if (myTeam) localStorage.setItem('portalMyTeam', myTeam); else localStorage.removeItem('portalMyTeam'); } catch (err) {}
  const sel = $('myTeamSel');
  if (sel) sel.value = myTeam || '';
  syncMyTeamToggle();
  applyTeamSkin();
  syncOfferNote();
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
        const s = slotIn((room.roster || []).filter(x => x.name !== p.name), grade);
        h += `<p class="p-sub">His grade (${f1(grade)}) ranks <b>#${s.rank} of ${s.of}</b> against the ${esc(g)} room’s full roster.</p>`;
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
    const ge = (room.getable || []).find(x => x.id === p.id);
    h += ge
      ? ge.starter
        ? `<p><b>Getable for ${esc(t.name)}</b> — he beats your room’s top man: he clears your starter.</p>`
        : ge.depth_ungraded
          ? `<p><b>Getable for ${esc(t.name)}</b> — he slots into your room above a man with no grade on record under the depth test; he improves your depth without clearing your top man.</p>`
          : `<p><b>Getable for ${esc(t.name)}</b> — he beats the lowest graded man in your room under the depth test; he improves your depth without clearing your top man.</p>`
      : `<p>Not getable for ${esc(t.name)} — he does not beat the lowest graded man in your room under the depth test, and your room’s bottom carries no ungraded man for him to replace.</p>`;
    const s = slotIn(room.roster || [], e.benchmark);
    h += `<p class="p-sub">Slots <b>#${s.rank} of ${s.of}</b> in your ${esc(g)} room — his benchmark against the room’s full roster${s.above ? `, behind ${esc(s.above.name)} ${f1(s.above.grade)}` : ' — the room’s top grade'}${s.below ? `, ahead of ${esc(s.below.name)} ${f1(s.below.grade)}` : ''}.</p>`;
  } else {
    h += `<p class="p-sub">No ${esc(g)} room for ${esc(t.name)} in the championship pool.</p>`;
  }
  h += `<p class="p-sub">Benchmark <b>${f1(e.benchmark)}</b> — his grade after the level-translation adjustment, the number the fits and the depth test are read from.</p>`;
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

/* Published portal rankings (Tommy, Nov 18, 2026): the handful of
   players who carry a national ranking from a published transfer-
   portal list wear it at the top of the page, with the cycle year —
   market evidence, printed as the lists printed it. */
function portalRankLine(p) {
  const pr = p.portal_rank;
  if (!pr || !Array.isArray(pr.source_ranks) || !pr.source_ranks.length) return '';
  const parts = pr.source_ranks.map((r, i) => i === 0
    ? `#${r.rank} NATIONALLY — ${esc(String(r.source).toUpperCase())}`
    : `#${r.rank} — ${esc(String(r.source).toUpperCase())}`);
  return `<p class="portal-rank">${esc(pr.cycle)} TRANSFER PORTAL: ${parts.join(' · ')}</p>`;
}

/* -------- the universe: standard records --------
   Every graded P4, G6 and FCS player who is not in the evaluated
   core, listed with only what the source files carry: name, school,
   level, conference, position, 2026 headline grade and volume. No
   Call, no band, no fits, no NIL — the page and the row say plainly
   that the full evaluation has not been run on him. The data loads
   lazily, the first time anything reaches for it; the landing and
   the core directories never pay for it. */
const UNI_PAGE = 150;
let uniShown = UNI_PAGE, uniSortKey = 'grade', uniSortDir = -1;

function ensureUniverse() {
  if (UNIVERSE) return Promise.resolve(UNIVERSE);
  if (!universePromise) {
    universePromise = Promise.all([loadJson('universe_fbs.json'), loadJson('universe_fcs.json')]).then(([fbs, fcs]) => {
      UNIVERSE = [...(Array.isArray(fbs) ? fbs : []), ...(Array.isArray(fcs) ? fcs : [])]
        .map(p => ({ ...p, universe: true }));
      UNIVERSE.forEach(p => { if (!byIdAll[p.id]) byIdAll[p.id] = p; });
      buildUniverseFilters();
      return UNIVERSE;
    });
  }
  return universePromise;
}

function buildUniverseFilters() {
  const confSel = $('uconf'), posSel = $('upos');
  if (confSel && confSel.options.length <= 1 && UNIVERSE) {
    const confs = [...new Set(UNIVERSE.map(p => p.conference))].sort();
    confSel.innerHTML = '<option value="">All conferences</option>' + confs.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  }
  if (posSel && posSel.options.length <= 1) {
    posSel.innerHTML = '<option value="">All positions</option>' + TRAIT_GROUP_ORDER.map(g => `<option value="${g}">${g}</option>`).join('');
  }
}

function universeFiltered() {
  const q = ($('uq').value || '').trim().toLowerCase();
  const lvl = $('ulevel').value, conf = $('uconf').value, pos = $('upos').value;
  const gmin = numOrNull($('ugrade').value);
  const rows = UNIVERSE.filter(p =>
    (!q || p.name.toLowerCase().includes(q) || p.school.toLowerCase().includes(q)) &&
    (!lvl || p.level === lvl) && (!conf || p.conference === conf) &&
    (!pos || p.position === pos) && (gmin == null || p.grade >= gmin));
  const k = uniSortKey, d = uniSortDir;
  rows.sort((a, b) => {
    const x = a[k], y = b[k];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * d;
    return String(x).localeCompare(String(y)) * d || (b.grade - a.grade);
  });
  return rows;
}

function uniRowHtml(p) {
  return `<tr><td class="cmp-cell"><input type="checkbox" class="cmp-check" data-cmp="${esc(p.id)}" ${cmpSel.includes(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)} to compare"></td><td><a href="#/player/${esc(encodeURIComponent(p.id))}"><span class="pname">${esc(p.name)}</span></a><span class="uni-badge">Standard record</span></td><td>${esc(p.school)}</td><td>${esc(p.conference)}</td><td>${esc(p.position)}</td><td class="num"><b>${f1(p.grade)}</b></td><td class="num">${fmtN(p.volume)} ${esc(p.volume_label)}</td></tr>`;
}

function renderUniverseRows(reset) {
  if (!UNIVERSE) return;
  if (reset) uniShown = UNI_PAGE;
  const rows = universeFiltered();
  $('uniCount').textContent = `${fmtN(rows.length)} of ${fmtN(UNIVERSE.length)} standard records`;
  $('uniBody').innerHTML = rows.length
    ? rows.slice(0, uniShown).map(uniRowHtml).join('')
    : '<tr><td colspan="7"><p class="empty">No standard records match — loosen a filter.</p></td></tr>';
  $('uniMore').innerHTML = rows.length > uniShown
    ? `<div class="showmore-row"><button type="button" class="btn-more" id="uniMoreBtn">Show more — ${fmtN(rows.length - uniShown)} more</button></div>` : '';
  const b = $('uniMoreBtn');
  if (b) b.addEventListener('click', () => { uniShown += UNI_PAGE; renderUniverseRows(false); });
}

function renderUniverseView() {
  if (!UNIVERSE) {
    $('uniSub').textContent = 'Loading the full list…';
    ensureUniverse().then(() => { if ((location.hash || '') === '#/universe') renderUniverseView(); });
    return;
  }
  buildUniverseFilters();
  $('uniSub').textContent = `${fmtN(UNIVERSE.length)} standard records — every graded P4, G6 and FCS player who is not in the evaluated core. The ${fmtN(UP.length + DOWN.length)} fully evaluated players live in the two directories; nobody on this page has been through the full evaluation. Sorted by grade — his playing time is printed beside it, and a big grade on a small sample should be read that way.`;
  $('uniFoot').textContent = 'A standard record carries only what the source files carry: name, school, level, conference, position, his 2026 headline grade and his playing time. No band, no fits, no Call — the full evaluation has not been run on these players. Tick the box beside any player to compare him — against an evaluated player or another standard record — on the numbers both sides honestly have.'
    + (UNIVERSE_META && Array.isArray(UNIVERSE_META.fcs_conferences) && !UNIVERSE_META.fcs_conferences.includes('MEAC') ? ' The MEAC joins this list when its 2026 pulls finish landing.' : '');
  renderUniverseRows(true);
}

/* a standard record's page: a smaller, perfect object — the grade
   and the volume set like they matter, the honest statement, and
   nothing else. No empty sections, no placeholder furniture. */
function renderUniversePlayer(p) {
  const peers = UNIVERSE ? UNIVERSE.filter(x => x.conference === p.conference && x.position === p.position) : [];
  let rank = '';
  if (peers.length >= 5) {
    const r = peers.filter(x => x.grade > p.grade).length + 1;
    rank = `<p class="u-note" style="margin-top:22px">His grade ranks <b style="color:var(--ink)">#${r} of ${peers.length}</b> ${esc(p.position)}s in the ${esc(p.conference)} on this list.</p>`;
  }
  return `<p style="margin:14px 0 0"><a class="back" href="#/universe">← Every player</a></p>
  <div class="u-page">
    <p class="u-kicker">Standard record — not yet evaluated</p>
    <h1 class="u-name">${esc(p.name)}</h1>
    <p class="u-school">${esc(p.school)} · ${esc(p.conference)} · ${esc(p.level)}</p>
    <div class="u-stats">
      <div class="u-stat"><span class="u-stat-n">${f1(p.grade)}</span><span class="u-stat-l">${esc(p.grade_col)} — 2026</span></div>
      <div class="u-stat"><span class="u-stat-n">${fmtN(p.volume)}</span><span class="u-stat-l">${esc(p.volume_label)} — 2026</span></div>
    </div>
    <div class="u-facts"><span>Position <b>${esc(p.position)}</b></span><span>Level <b>${esc(p.level)}</b></span><span>Conference <b>${esc(p.conference)}</b></span></div>
    ${rank}
    <p class="u-note">This is a standard record: he is listed with the grade and the playing time on his 2026 record, and nothing more is claimed for him. The full evaluation — band, fits, The Call — has not been run on him. The ${fmtN(UP.length + DOWN.length)} players in the two directories carry it.</p>
    <a class="u-back" href="#/universe">Browse the full list →</a>
  </div>`;
}

function renderPlayer(p) {
  const vitals = [
    ['Position', p.position], ['School', p.school], ['Book', p.conference_book],
    ['Class', p.listed_class], ['Height', p.height], ['Weight', p.weight]
  ].filter(v => v[1] !== null && v[1] !== undefined && v[1] !== '');
  const home = hometownLine(p);
  let h = `<div class="card">
    <div class="p-head">${photo(p)}
      <div>
        <p class="p-name">${esc(p.name)}${p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : ''}${p.fits && p.fits.ulm_qualifier ? '<span class="ulm-badge">LOUISIANA-MONROE QUALIFIER</span>' : ''}</p>
        ${portalRankLine(p)}
        ${home ? `<p class="p-home">Hometown: <b>${esc(home)}</b></p>` : ''}
        <p class="p-sub">${vitals.map(v => `${esc(v[0])}: <b>${esc(v[1])}</b>`).join(' &nbsp;·&nbsp; ')}</p>
        ${skillsStrip(p)}
        <p><span class="grade-big">${p.headline_grade == null ? '—' : p.headline_grade.toFixed(1)}</span> <span class="p-sub">${esc(p.headline_grade_col || 'grade')}</span></p>
        ${p.blended_score != null ? `<p class="p-sub">Second score — Blended ${blendVal(p)}: grades, production, honours and market combined, where that data exists.</p>` : ''}
        ${p.stat_line ? `<p class="p-sub">${esc(p.stat_line)}</p>` : ''}
        ${p.screen_label ? `<p class="p-sub">${esc(p.screen_label)}</p>` : ''}
        <p>${eligChip(p.elig_qualified)} <span class="p-sub">eligibility — qualified determination</span></p>
        ${p.pff_id ? `<p><a href="https://premium.pff.com/ncaa/players/2026/REGPO/player/${esc(p.pff_id)}" target="_blank" rel="noopener"><b>Key plays to watch — on PFF ↗</b></a> <span class="p-sub">His key plays and film live on his PFF page — the link opens PFF in a new tab, on your own PFF login.</span></p>` : ''}
      </div>
    </div></div>`;

  h += saveStrip(p);

  h += prospectStrip(p);

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

  h += bestSection(p);

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
      ${p.fits.benchmark != null ? `<p class="p-sub">Benchmark (his grade after the level-translation adjustment): ${Number(p.fits.benchmark).toFixed(1)}. A fit = he clears the room: his benchmark beats the room's top-graded volume-qualified incumbent. The schools where he wouldn't clear the room but would still land in the rotation are listed under <b>Will contribute</b>, below.</p>
      <p class="p-sub">Every row also carries the <b>move</b> it is from where he plays now — Up, Lateral or Down — and the <b>offer</b> the school should make on that fit: on a fit, his NIL band applies.</p>
      ${p.direction === 'down' ? `<p class="p-sub">His P4 fits are read off his headline grade, ${Number(p.headline_grade).toFixed(1)} — same level, no translation adjustment.</p>` : ''}` : ''}
      ${fitsTable('Top G6 fits', p.fits.g6)}
      ${fitsTable(p.conference_book === 'ULM' ? 'P4 fits (as printed)' : 'Top P4 fits', p.fits.p4)}
      ${p.fits.ulm_fit ? `<p class="kv">Louisiana-Monroe</p><div class="fits-scroll"><table class="fits"><tr><th>School</th><th>Conference</th><th>Incumbent</th><th class="num">Inc. grade</th><th>Move</th><th>Offer</th></tr><tr><td>${logoImg(p.fits.ulm_fit)}${esc(p.fits.ulm_fit.school)} <span class="ulm-badge">QUALIFIES</span></td><td>${esc(p.fits.ulm_fit.conf || '')}</td><td>${esc(p.fits.ulm_fit.incumbent || '')}</td><td class="num">${p.fits.ulm_fit.inc_grade == null ? '—' : Number(p.fits.ulm_fit.inc_grade).toFixed(1)}</td><td>${moveCell(p.fits.ulm_fit)}</td><td>${offerCell(p.fits.ulm_fit)}</td></tr></table></div>` : ''}
    </div>`;
  }

  h += schemeFitSection(p);

  h += helpSection(p);

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
    const p = byIdAll[id];
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

/* A Blended Score is a percentile composite inside the player's own
   level (Tommy, Nov 19, 2026) — stamp the level wherever it prints,
   the same way fits are stamped, so an FCS number is never read as
   the same claim as a P4 number. Level derives from the book: the
   P4 Down book is P4, the ULM and UTEP roster books are G6, and
   every other book is an FCS conference. */
const blendLevel = p => p.conference_book === 'P4 Down' ? 'P4'
  : (p.conference_book === 'ULM' || p.conference_book === 'UTEP') ? 'G6' : 'FCS';
const blendVal = p => `<b>${p.blended_score.toFixed(1)}</b> <span class="p-sub">${blendLevel(p)}</span>`;

function renderCompare(players) {
  /* Apples to apples (Tommy, Nov 19, 2026): a Blended Score is only ever
     compared against another Blended Score. If any player shown lacks
     one, the row shows no numbers at all — a blend is never set beside
     a base grade or a dash and read as a comparison. */
  const allBlended = players.every(p => p.blended_score != null);
  const anyBlended = players.some(p => p.blended_score != null);
  const rows = [
    ['', p => photo(p, 'ph cmp-ph')],
    ['Player', p => `<span class="cmp-name">${esc(p.name)}</span>${p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : ''}${p.universe ? '<span class="uni-badge">Standard record</span>' : ''}`],
    ['Position', p => esc(p.position)],
    ['School', p => esc(p.school)],
    ['Book', p => p.universe ? `Standard record — ${esc(p.level)}` : esc(p.conference_book)],
    ['Class', p => esc(p.listed_class || '—')],
    ['Height', p => esc(p.height || '—')],
    ['Weight', p => esc(p.weight == null ? '—' : p.weight)],
    ['Hometown', p => esc(p.hometown || '—')],
    ['Headline grade', p => p.universe
      ? (p.grade == null ? '—' : `<b>${f1(p.grade)}</b> <span class="p-sub">${esc(p.grade_col)}</span>`)
      : (p.headline_grade == null ? '—' : `<b>${p.headline_grade.toFixed(1)}</b> <span class="p-sub">${esc(p.headline_grade_col || 'grade')}</span>`)],
    ['Blended Score', p => !allBlended ? '—' : blendVal(p)],
    ['Stat line', p => esc(p.stat_line || '—')],
    ['Eligibility', p => p.universe ? '—' : `${eligChip(p.elig_qualified)}${p.elig_track ? `<br><span class="p-sub">${esc(p.elig_track)}</span>` : ''}`],
    ['Hidden Value', p => p.hidden_value ? '<span class="hv">HIDDEN VALUE</span>' : '—'],
    ['College band', p => bandCell(p.band)],
    ['Pro band', proBandCell],
    ['Best game', p => esc((p.best_game && p.best_game.line) || '—')],
    ['Strengths', p => (p.strengths && p.strengths.length) ? `<ul>${p.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '—'],
    ['Weaknesses', p => (p.weaknesses && p.weaknesses.length) ? `<ul>${p.weaknesses.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '—'],
    ['Bio', p => esc(p.bio || '—')]
  ];
  const notes = [];
  if (anyBlended && !allBlended)
    notes.push('Blended Scores are compared only where every player shown has one — a blend is never set against a base grade.');
  if (players.some(p => p.universe))
    notes.push('A standard record is compared on his headline grade only — the full evaluation has not been run on him.');
  return `<div class="cmp-grid" style="--cols:${players.length}">` +
    rows.map(([label, fn]) =>
      `<div class="cmp-label">${esc(label)}</div>` + players.map(p => `<div class="cmp-v">${fn(p)}</div>`).join('')
    ).join('') + '</div>' + notes.map(cmpNote).join('');
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
  return `<div class="card"><h2 class="sec" style="margin-top:2px">The fourteen books side by side</h2>
    ${cmpNote('The FCS rows are <b>evaluated cores</b> — the screened, deep-dived players from each Player Book — <b>not full rosters</b>; a conference’s full roster is roughly ten times its core. <b>ULM</b> and <b>UTEP</b> are full evaluated rosters. <b>Grade mass</b> is the sum of headline grades in a group — a concentration proxy that shows where a group’s graded weight sits; it is not a production total.')}
    <div class="tbl-scroll"><table class="ctable">
      <thead><tr><th>Book</th><th class="num">Players</th><th class="num">Median grade</th><th class="num">P4 at likely</th><th class="num">P4 starters</th><th class="num">Eligibility remaining</th><th class="num">Final-year grade mass</th><th class="num">Hidden Value</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="p-sub">P4 at likely: the band’s likely rung is P4 depth or P4 starter — ${CMP.meta.p4_likely_total} of the 943 banded players, ${CMP.meta.p4_starter_likely_total} of them as P4 starters. The two full rosters sit 8–14 median-grade points below every FCS core; the cores are each conference’s screened top and the rosters are everybody who was evaluated, so the gap measures the screen, not a talent ordering. Eligibility is the qualified determination as printed in the re-issued books.</p></div>`;
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
      return `<td class="ctr" style="background:rgba(45,212,191,${a})"><span class="grid-n">${c.n}</span><span class="grid-sub">P4 ${c.p4_likely} · med ${f1(c.median_grade)}</span></td>`;
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
    <p class="p-sub">Every school with an evaluated player, across all fourteen books. The cores are not spread evenly: South Carolina State holds 29 of the MEAC’s 59; Butler (27) and Marist (21) together hold 48 of Pioneer’s 179. “Remaining / Final” counts eligibility remaining against final-year players.</p>
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

/* ---------------- what changed ---------------- */
function renderChanges() {
  // a missing or malformed changes.json (CHANGES null) degrades to one
  // honest line — no changes posted yet — never an error
  if (!CHANGES || !CHANGES.weeks.length) {
    return `<div class="card empty-state"><h2 class="empty-title">What changed</h2>
      <p>No changes are posted yet. When the pool or the library changes, the week's entries are posted here.</p>
      <p><a href="#/up">Browse the FCS — Moving Up directory instead →</a></p></div>`;
  }
  return CHANGES.weeks.map(w => `<div class="card">
    <h2 class="sec" style="margin-top:2px">${esc(w.week)}</h2>
    <ul class="changes-list">${(Array.isArray(w.entries) ? w.entries : []).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
  </div>`).join('');
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
    return `<div class="cand-block">${head}<p>No evaluated player beats the lowest graded man in this room under the depth test — the incumbent is ${esc(r.incumbent)} at ${f1(r.inc_grade)}.</p></div>`;
  }
  const rows = r.cand.map(c => `<tr>
    <td><a href="#/player/${esc(encodeURIComponent(c.id))}"><span class="pname">${esc(c.name)}</span></a>${c.starter ? '<span class="starter-badge">Beats your starter</span>' : ''}${c.depth_ungraded ? '<span class="p-sub">replaces an ungraded man</span>' : ''}</td>
    <td>${esc(c.book)}</td><td>${esc(c.school)}</td>
    <td class="num">${f1(c.grade)}</td><td class="num"><b>${f1(c.benchmark)}</b></td></tr>`).join('');
  const more = r.cand_total > r.cand.length
    ? `<p class="p-sub">Top ${r.cand.length} shown by benchmark — ${r.cand_total - r.cand.length} more evaluated player${r.cand_total - r.cand.length === 1 ? '' : 's'} also beat${r.cand_total - r.cand.length === 1 ? 's' : ''} the room’s lowest graded man.</p>` : '';
  return `<div class="cand-block">${head}
    <p class="p-sub">${r.cand_total} evaluated player${r.cand_total === 1 ? '' : 's'} beat the lowest graded man in this room under the depth test — the bottom player is replaceable whatever his snap count; a player flagged “Beats your starter” also clears the incumbent (${esc(r.incumbent)}, ${f1(r.inc_grade)}).</p>
    <div class="fits-scroll"><table class="fits"><tr><th>Player</th><th>Book</th><th>School</th><th class="num">Grade</th><th class="num">Benchmark</th></tr>${rows}</table></div>${more}</div>`;
}

/* ---------------- team comparison charts ---------------- */
const TEAM_COLORS = ['#3b82f6', '#f59e0b', '#34d399', '#f87171'];

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
    const fill = r.v >= 0 ? '#4ade80' : '#f87171';
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
    s += `<line x1="${L}" y1="${y}" x2="${R}" y2="${y}" stroke="#1e2a3f" stroke-width="1"/>`;
    vals.forEach((v, i) => {
      const jy = y + (((i * 7) % 9) - 4);
      s += `<circle cx="${X(v).toFixed(1)}" cy="${jy}" r="2.4" fill="#5b6a82"/>`;
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
   eligibility remaining whose benchmark beats the lowest-graded man
   in the room (the depth test under the path replacement doctrine,
   Tommy, Nov 19, 2026: the path works from the bottom of the room up
   toward its median, the bottom player is replaceable whatever his
   snap count, and a man with no grade on record is the first to fall
   off — a player who slots in only above an ungraded bottom man is
   getable too, flagged depth_ungraded), and not already on the team. A
   getable entry with starter set also beats the room's top man — the
   old strict test, kept as the flagged top tier. The path player is
   the best getable player; the projected room grade after the path is
   the better of the incumbent and his benchmark. Each getable entry also carries his NIL
   projection (nil_floor / nil_ceiling or a no-estimate status), and the
   header totals the path players' estimated NIL cost — unpriced path
   players are counted and named as unpriced, never as $0. */
/* champ-model-begin */
function champModel(t, groups) {
  const EPS = 1e-9;
  const archOn = champArchSel.size > 0;
  const rooms = groups.map(g => {
    const r = t.rooms[g];
    const inc = r.inc_grade, bar = r.bar_grade, bb = !!r.below_bar;
    const gap = (inc != null && bar != null) ? Math.round((inc - bar) * 10) / 10 : null;
    const atBar = !bb && inc != null && bar != null && inc >= bar - EPS;
    /* with archetypes ticked, the room's getable list is cut to the
       players holding one — the path player is the best of those */
    const getableShown = archOn ? (r.getable || []).filter(c => archMatchId(c.id)) : (r.getable || []);
    const path = getableShown.length ? getableShown[0] : null;
    /* Statuses under the depth test: a path player who beats the
       room's top man is PARTIAL (or CLOSES THE GAP when his benchmark
       reaches the standard); one who beats only the room's bottom
       man is DEPTH — he improves the room without moving its top
       grade, so the projection stays the incumbent's. A below-bar
       room never counts at the standard, so its path caps at PARTIAL. */
    let status;
    if (atBar) status = 'AT STANDARD';
    else if (!path) status = 'NO GETABLE PLAYER';
    else if (!bb && bar != null && path.benchmark >= bar - EPS) status = 'CLOSES THE GAP';
    else if (path.starter) status = 'PARTIAL';
    else status = 'DEPTH';
    return { g, r, inc, bar, bb, gap, atBar, path, status, getableShown, archOn,
             projected: path ? (inc != null ? Math.max(inc, path.benchmark) : path.benchmark) : inc,
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
    improved: rooms.filter(x => x.status === 'PARTIAL' || x.status === 'DEPTH').length,
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

const CHAMP_STATUS_CLS = { 'AT STANDARD': 'ok', 'CLOSES THE GAP': 'ok', 'PARTIAL': 'un', 'DEPTH': 'un', 'NO GETABLE PLAYER': 'no' };

/* the path's archetype panel: the same 19 tags as the directory filter,
   counted over the available (getable-universe) players */
function champArchBtnLabel() {
  const btn = $('c-arch');
  if (!btn) return;
  const n = champArchSel.size;
  btn.innerHTML = `What he does best${n ? ` · ${n}` : ''} <span class="ms-caret">▾</span>`;
  btn.classList.toggle('ms-on', n > 0);
}

function buildChampArchPanel() {
  const box = $('champArchOpts');
  if (!box) return;
  const counts = {};
  const seen = new Set();
  if (CHAMP && CHAMP.avail) for (const g of Object.keys(CHAMP.avail)) {
    for (const e of CHAMP.avail[g]) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      for (const t of tagsOf(byIdAll[e.id])) counts[t.tag] = (counts[t.tag] || 0) + 1;
    }
  }
  const names = Object.keys(counts).sort();
  box.innerHTML = names.length ? names.map(n =>
    `<label class="ms-opt"><input type="checkbox" value="${esc(n)}"${champArchSel.has(n) ? ' checked' : ''}> ${esc(n)} (${counts[n]})</label>`).join('')
    : '<p class="p-sub" style="padding:6px 8px">No archetype tags in this build.</p>';
  champArchBtnLabel();
}

function champPlayerLine(c) {
  return `<div class="path-cell">${photo(c)}
    <div><a href="#/player/${esc(encodeURIComponent(c.id))}"><span class="pname">${esc(c.name)}</span></a>${c.hv ? '<span class="hv">Hidden Value</span>' : ''}${c.starter ? '<span class="starter-badge">Beats your starter</span>' : ''}${tagBadges(c.id)}
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
    pathCell = `<span class="chip ok">AT STANDARD</span><br><span class="p-sub">The incumbent already meets the conference-best standard, and no getable player beats the bottom of its room.</span>`;
  } else if (x.status === 'NO GETABLE PLAYER') {
    pathCell = `<span class="chip no">NO GETABLE PLAYER</span><br><span class="p-sub">${r.depth_grade == null && !r.depth_ungraded_name
      ? 'No rostered player in this room in the pool snapshot — the depth test has no man for an add to beat.'
      : x.archOn && r.getable_total > 0
        ? 'Getable players improve this room’s depth, but none of them holds a ticked archetype — untick “What he does best” above to see them all.'
        : 'No evaluated player with eligibility remaining beats the lowest graded man in this room, and the room’s bottom carries no ungraded man for an add to replace.'}</span>`;
  } else {
    const c = x.path;
    const shownGet = x.getableShown || r.getable || [];
    const more = shownGet.length > 1 || (x.archOn && r.getable_total > 0) ? `<details class="getable-more"><summary>${x.archOn ? `Getable players holding a ticked archetype (${shownGet.length} of ${r.getable_total})` : `All getable players (${r.getable_total})`}</summary>
      <div class="fits-scroll"><table class="fits"><tr><th>Player</th><th>School</th><th class="num">Grade</th><th class="num">Benchmark</th><th>Est. NIL</th><th>Eligibility</th></tr>
      ${shownGet.map(o => `<tr draggable="true" data-dragpid="${esc(o.id)}"><td><a href="#/player/${esc(encodeURIComponent(o.id))}"><span class="pname">${esc(o.name)}</span></a>${o.hv ? '<span class="hv">Hidden Value</span>' : ''}${o.starter ? '<span class="starter-badge">Beats your starter</span>' : ''}${o.depth_ungraded ? '<span class="p-sub">replaces an ungraded man</span>' : ''}${tagBadges(o.id)}</td><td>${esc(o.school)}</td><td class="num">${f1(o.grade)}</td><td class="num"><b>${f1(o.benchmark)}</b></td><td>${nilRange(o) || 'no estimate'}</td><td>${eligChip(o.elig)}</td></tr>`).join('')}
      </table></div></details>` : '';
    pathCell = `${champPlayerLine(c)}<p class="path-status"><span class="chip ${CHAMP_STATUS_CLS[x.status]}">${x.status}</span>${
      x.status === 'PARTIAL' ? (x.bar != null && c.benchmark >= x.bar - 1e-9
        ? `<span class="p-sub"> benchmark ${f1(c.benchmark)} — past the standard’s grade, but this room is carried below the volume bar and does not count at the standard</span>`
        : `<span class="p-sub"> projected ${f1(c.benchmark)} — ${f1(Math.round((x.bar - c.benchmark) * 10) / 10)} short of the standard</span>`)
      : x.status === 'CLOSES THE GAP' ? `<span class="p-sub"> projected ${f1(c.benchmark)} — reaches the standard</span>`
      : x.status === 'DEPTH' ? (c.depth_ungraded
        ? `<span class="p-sub"> benchmark ${f1(c.benchmark)} — he slots into the room above ${esc(r.depth_ungraded_name || r.depth_name || 'a man with no grade on record')} (no grade on record), the room’s bottom man; the top of the room is unchanged</span>`
        : `<span class="p-sub"> benchmark ${f1(c.benchmark)} — beats ${esc(r.depth_name)} (${f1(r.depth_grade)}), the lowest graded man in the room; the top of the room is unchanged</span>`)
      : `<span class="p-sub"> the room already meets the standard; ${c.starter ? 'he clears its top man too' : 'he improves its depth'}</span>`}</p>${more}`;
  }
  return `<tr><td><span class="pname">${esc(x.g)}</span></td>
    <td>${incCell}</td>${incGrade}${barCell}${gapCell(x.gap)}
    <td>${pathCell}</td></tr>`;
}

/* Grouped horizontal bars per room: incumbent vs the conference-best
   standard vs the projected grade after the path, on one grade scale. */
function champChart(t, m) {
  const vals = [];
  m.rooms.forEach(x => { if (x.inc != null) vals.push(x.inc); if (x.bar != null) vals.push(x.bar); if (x.path) vals.push(x.projected); });
  if (!vals.length) return '';
  let lo = Math.max(0, Math.floor(Math.min(...vals) - 3));
  let hi = Math.min(100, Math.ceil(Math.max(...vals) + 3));
  if (hi - lo < 20) { lo = Math.max(0, lo - 5); hi = Math.min(100, hi + 5); }
  const W = 660, L = 200, R = 646, top = 30, blockH = 37, barH = 8, barGap = 3;
  const H = top + m.rooms.length * blockH + 22;
  const X = v => L + ((v - lo) / (hi - lo)) * (R - L);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t.name)} — incumbent, conference-best standard and projected grade after the path, room by room">`;
  s += `<rect x="${L}" y="6" width="10" height="10" fill="#94a3b8"/><text x="${L + 15}" y="15" class="ch-leg">Incumbent</text>`;
  s += `<rect x="${L + 96}" y="6" width="10" height="10" fill="#e2e8f0"/><text x="${L + 111}" y="15" class="ch-leg">Conference-best standard</text>`;
  s += `<rect x="${L + 268}" y="6" width="10" height="10" fill="#4ade80"/><text x="${L + 283}" y="15" class="ch-leg">Projected after the path</text>`;
  m.rooms.forEach((x, i) => {
    const y0 = top + i * blockH;
    s += `<text x="0" y="${y0 + 16}" class="ch-room">${esc(x.g)}${x.bb ? '*' : ''}</text>`;
    const bars = [
      { v: x.inc, fill: '#94a3b8', faded: x.bb, label: x.inc != null ? f1(x.inc) + (x.bb ? '*' : '') : null },
      { v: x.bar, fill: '#e2e8f0', faded: false, label: x.bar != null ? f1(x.bar) : null },
      { v: x.path ? x.projected : null, fill: '#4ade80', faded: false, label: x.path ? f1(x.projected) : null }
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
    <p class="p-sub">Per room: the incumbent’s grade, the conference-best standard, and the projected grade after the path (the better of the incumbent and the path player’s benchmark — a depth-only add leaves the top grade where it stands). A faded, asterisked incumbent bar is a below-bar room — its top player by volume, carried flagged; no projected bar is drawn where no player is getable.</p>${s}</div>`;
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
  const t = CHAMP.teams.find(x => x.name === champSel);
  if (!t) {
    // No team chosen — My Team unset and no pick made on this page.
    // The path opens on nobody: choosing a school is the user's act,
    // never a silent default.
    champBtnLabel();
    const ph0 = $('champPrintHead');
    if (ph0) ph0.innerHTML = '';
    body.innerHTML = `<div class="card empty-state"><h2 class="empty-title">Path to a conference championship</h2>
      <p class="empty-lede">Pick your team to see its path.</p>
      <p>Choose a school in the Team picker above — or set “My team” in the top bar and this page opens on your school. Until a team is chosen, no school is assumed.</p></div>`;
    return;
  }
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
      ${t.state ? `<p class="p-sub">Regional: <b>${esc(STATE_NAMES[t.state] || t.state)}</b>${(STATE_ADJ[t.state] || []).length ? ` + ${(STATE_ADJ[t.state] || []).map(esc).join(' · ')}` : ' — no bordering states'} — the regional view below counts a player as regional when his home state is ${esc(STATE_NAMES[t.state] || t.state)} or one of those bordering states.</p>` : ''}
      <p class="p-sub">Rooms at the conference-best standard today: <b>${m.atNow} of ${m.rooms.length}</b> · after the path: <b>${m.atAfter} of ${m.rooms.length}</b> · improved but still short: <b>${m.improved}</b> · no getable player: <b>${m.noGet}</b></p>
      <p class="p-sub">Total grade points to the standard across the ten rooms: <b>${f1(m.points)}</b></p>
      <p class="p-sub">${m.cost.total === 0
        ? 'Estimated path cost: <b>—</b> (no path players named)'
        : `Estimated path cost: <b>${fmtMoney(m.cost.floor)}–${fmtMoney(m.cost.ceiling)}</b> a year · ${m.cost.priced} of ${m.cost.total} path players priced${m.cost.unpriced ? ` · <b>${m.cost.unpriced} path player${m.cost.unpriced > 1 ? 's carry' : ' carries'} no estimate and ${m.cost.unpriced > 1 ? 'are' : 'is'} not counted in the total — never as $0</b>` : ''}`}</p>
    </div></div>
    ${cmpNote('How to read this page: the <b>conference-best standard</b> is the highest <b>volume-qualified</b> incumbent grade at the room among the teams in ' + esc(t.conf) + ' — the championship bar for that room. The <b>path</b> names, per room, the single best <b>getable</b> player: an evaluated player from the Player Books who has eligibility remaining, whose benchmark beats the lowest-graded man in this room — the <b>depth test</b> — and who is not already on ' + esc(t.name) + '. The path works from the bottom of the room up toward its median: the bottom player is replaceable whatever his snap count, and a man with no grade on record is the first to fall off — a player who slots into the room only above an ungraded bottom man is getable too. A getable player marked <b>“Beats your starter”</b> also clears the room’s top man. The room’s <b>projected</b> grade after the path is the better of the incumbent and his benchmark. <b>Closes the gap</b> — his benchmark reaches the standard. <b>Partial</b> — he beats the room’s top man but not the standard. <b>Depth</b> — he beats the room’s bottom man only; the room gets deeper and its top grade does not move. “Improved but still short” above counts the Partial and Depth rooms.')}
  </div>`;
  h += renderClassBoard(t, m);
  h += champChart(t, m);
  h += `<div class="card"><h2 class="sec" style="margin-top:2px">The path, room by room</h2>
    <div class="tbl-scroll"><table class="ctable champ-table">
      <thead><tr><th>Room</th><th>Incumbent</th><th class="num">Inc. grade</th><th class="num">Conference-best standard</th><th class="num">Gap</th><th>The path — best getable player</th></tr></thead>
      <tbody>${m.rooms.map(x => champRoomRow(x, t.conf)).join('')}</tbody></table></div>
    <p class="foot-note">Method, in plain terms. <b>The standard:</b> the highest volume-qualified incumbent grade at the group among all teams in the conference; a room carried below the volume bar never sets it, and if no team in the conference has a qualified incumbent at the group, the standard is the best qualified incumbent grade at the team’s level (G6 or P4) and the table says so. <b>Getable:</b> eligibility remaining under the qualified determination — Unsettled players are shown and flagged “eligibility unsettled” — a benchmark that beats the lowest-graded man in the room, and not already on this team. That is the depth test under the path replacement doctrine: the path works from the bottom of the room up toward its median; the bottom player is replaceable whatever his snap count, so every rostered man counts, zero-volume men included; and a man with no grade on record is the first to fall off — a player who slots into the room only above an ungraded bottom man is getable, flagged, and no point-worth is claimed for that pairing. The books’ own fits still use the stricter test against the room’s top man, and a getable player who passes that too is marked “Beats your starter”. <b>Projected</b> is the better of the incumbent’s grade and his benchmark from the Player Book method — headline grade plus the position’s translation delta. <b>NIL:</b> getable is a field test — it means he improves your room and has eligibility; it does not price him. Separately, each path and getable player carries his estimated NIL projection where priced, and the header’s estimated path cost sums the path players’ floors and ceilings; a path player with no estimate is named as unpriced in that count and is never counted as $0. ${esc(NIL_LABEL)} An asterisked incumbent is a room with no volume-qualified player, carried by its top player by volume under the team-comparison ruling; the depth test still applies to the room, so getable players are named for it. Pool: Nov 17, 2026 in-season snapshot of PFF Ultimate exports; grades are PFF headline grades.</p>
  </div>`;
  h += renderBudgetReport(t, m);
  h += renderFullRooms(t, m);
  body.innerHTML = h;
  if (champRestoreScroll === 'board') { const b = $('classBoard'); if (b) b.scrollIntoView({ block: 'start' }); }
  else if (typeof champRestoreScroll === 'number') window.scrollTo(0, champRestoreScroll);
  champRestoreScroll = null;
}

/* ---------------- championship path: Budget Report ----------------
   Tommy's approved design (Nov 18, 2026): a per-team report on this
   page — the rooms ranked by gap to the conference-best standard, the
   cheapest getable fix per room, and three classes auto-built at set
   budgets ($500K / $1M / $2M). Everything is priced at the class
   builder's current mark (champHitDefault — the saved-class board's
   "Price new saves at" setting) via the same hitPrice the builder
   uses, and a built class opens in the builder with share-link
   semantics: in memory only, the team's saved class untouched until
   the user changes something in it. Built entirely from the data this
   page already loads — a room's getable list IS the depth-test set,
   in benchmark order, and every getable entry in this snapshot
   carries an NIL band (the unpriced branch below is defensive). */
const BUDGET_LEVELS = [500000, 1000000, 2000000];

function budgetModel(t, m) {
  const hit = champHitDefault;
  const rooms = m.rooms.map(x => {
    const getable = (x.r.getable || []).filter(c => c.nil_status === 'priced');
    const gapPts = (x.inc != null && x.bar != null)
      ? Math.round(Math.max(0, x.bar - x.inc) * 10) / 10 : null;
    let cheapest = null;
    for (const c of getable) {
      const tp = tierPrice(c, hit, t.name);
      if (tp.price != null && (!cheapest || tp.price < cheapest.price)) cheapest = { c, price: tp.price, tier: tp.tier };
    }
    return { g: x.g, x, gapPts, getable, cheapest,
             fixable: gapPts != null && gapPts > 0 && getable.length > 0 };
  });
  /* biggest gap first — the sort is stable, so tied rooms keep the
     book's room order */
  const ranked = [...rooms].sort((a, b) => (b.gapPts ?? -1) - (a.gapPts ?? -1));
  const classes = BUDGET_LEVELS.map(budget => {
    let remaining = budget;
    const usedIds = new Set(), doneRooms = new Set();
    const picks = [], skipped = [];
    for (const r of ranked) {
      if (!r.fixable || doneRooms.has(r.g)) continue;
      const pick = r.getable.find(c => !usedIds.has(c.id) && (tierPrice(c, hit, t.name).price ?? Infinity) <= remaining);
      if (pick) {
        const tp = tierPrice(pick, hit, t.name);
        picks.push({ g: r.g, c: pick, price: tp.price, tier: tp.tier,
                     floor: isScholarshipTier(tp.tier) ? 0 : pick.nil_floor,
                     ceiling: isScholarshipTier(tp.tier) ? 0 : pick.nil_ceiling });
        usedIds.add(pick.id);
        doneRooms.add(r.g);
        remaining -= tp.price;
      } else skipped.push(r.g);
    }
    return { budget, picks, skipped,
             spend: picks.reduce((s, p) => s + p.price, 0),
             floor: picks.reduce((s, p) => s + p.floor, 0),
             ceiling: picks.reduce((s, p) => s + p.ceiling, 0) };
  });
  /* replacement pairing inside each built class, same rule as the
     saved-class board: the picks in build order push the rooms'
     bottom men off — the room's true bottom, snaps aside, ungraded
     men first (path replacement doctrine) */
  for (const k of classes) {
    const prs = pairAdds(t, k.picks.map(p => ({ id: p.c.id, g: p.g, benchmark: p.c.benchmark })));
    let tot = 0;
    k.ungradedPairs = [];
    for (const p of k.picks) {
      const pr = prs.get(p.c.id);
      p.off = pr ? pr.off : null;
      p.worth = pr ? pr.worth : null;
      if (p.off && p.off.grade == null) k.ungradedPairs.push(`${p.c.name} replaces ${p.off.name}`);
      if (p.worth != null) tot += p.worth;
    }
    k.worthTotal = Math.round(tot * 10) / 10;
  }
  return { rooms, ranked, classes,
           need: rooms.filter(r => r.gapPts != null && r.gapPts > 0).length,
           fixable: rooms.filter(r => r.fixable).length };
}

function renderBudgetReport(t, m) {
  const bm = budgetModel(t, m);
  const mark = hitLabel(champHitDefault);
  const fixCell = r => {
    if (!r.cheapest) {
      const why = (r.x.r.getable || []).length
        ? 'Getable players improve this room’s depth, but none carries an NIL estimate, so none can be priced.'
        : r.x.r.depth_grade == null && !r.x.r.depth_ungraded_name
          ? 'No rostered player in this room in the pool snapshot — the depth test has no man for an add to beat.'
          : 'No evaluated player with eligibility remaining beats the lowest graded man in this room, and the room’s bottom carries no ungraded man for an add to replace.';
      return `<b>No getable fix at any price.</b><br><span class="p-sub">${why}</span>`;
    }
    const c = r.cheapest.c;
    return `<a href="#/player/${esc(encodeURIComponent(c.id))}"><span class="pname">${esc(c.name)}</span></a>${c.hv ? '<span class="hv">Hidden Value</span>' : ''}${c.starter ? '<span class="starter-badge">Beats your starter</span>' : ''}
      <br><span class="p-sub">${esc(c.school)} · benchmark <b>${f1(c.benchmark)}</b> · ${isScholarshipTier(r.cheapest.tier) ? `<b>${esc(r.cheapest.tier)}</b> — no NIL spend` : `<b>${fmtMoney(r.cheapest.price)}</b> at ${esc(mark)}`}</span>
      <br><span class="p-sub">Band ${nilRange(c)} a year</span>${r.x.atBar ? '<br><span class="p-sub">This room is already at the standard — no fix needed; this is its cheapest getable player.</span>' : ''}`;
  };
  const rows = bm.ranked.map(r => {
    const x = r.x;
    return `<tr><td><span class="pname">${esc(r.g)}</span></td>
      <td>${x.r.incumbent ? esc(x.r.incumbent) : '<span class="p-sub">— none qualified —</span>'}</td>
      <td class="num">${x.inc != null ? `<b>${f1(x.inc)}</b>${x.bb ? '*' : ''}` : '—'}</td>
      <td class="num">${x.bar != null ? `<b>${f1(x.bar)}</b><br><span class="p-sub">${esc(x.r.bar_team)}</span>` : '—'}</td>
      <td class="num"><b>${r.gapPts != null ? f1(r.gapPts) : '—'}</b></td>
      <td>${fixCell(r)}</td></tr>`;
  }).join('');
  const classBlock = k => {
    if (!k.picks.length) return `<div class="budget-block" data-budget="${k.budget}">
      <h3 class="sub-h">${fmtMoney(k.budget)} class</h3>
      <p class="p-sub">No getable fix fits a ${fmtMoney(k.budget)} budget at the ${esc(mark)} mark.</p></div>`;
    const prows = k.picks.map(p => {
      const s = slotIn((t.rooms[p.g] || {}).roster || [], p.c.benchmark);
      return `<tr data-pid="${esc(p.c.id)}"><td><span class="pname">${esc(p.g)}</span></td>
      <td><a href="#/player/${esc(encodeURIComponent(p.c.id))}"><span class="pname">${esc(p.c.name)}</span></a>${p.c.hv ? '<span class="hv">Hidden Value</span>' : ''}
      <br><span class="p-sub">Slots <b>#${s.rank} of ${s.of}</b> in the room · ${pairText({ off: p.off, worth: p.worth })}</span></td>
      <td>${esc(p.c.school)}</td><td class="num"><b>${f1(p.c.benchmark)}</b></td>
      <td class="num"><b>${isScholarshipTier(p.tier) ? esc(p.tier) : fmtMoney(p.price)}</b></td><td>${nilRange(p.c)}</td></tr>`;
    }).join('');
    return `<div class="budget-block" data-budget="${k.budget}">
      <h3 class="sub-h">${fmtMoney(k.budget)} class — ${k.picks.length} fix${k.picks.length > 1 ? 'es' : ''}</h3>
      <div class="tbl-scroll"><table class="fits"><thead><tr><th>Room</th><th>Player</th><th>School</th><th class="num">Benchmark</th><th class="num">Price at ${esc(mark)}</th><th>Band</th></tr></thead>
      <tbody>${prows}</tbody></table></div>
      <p class="class-totals">Total at your marks: <b>${fmtMoney(k.spend)}</b> a year
        <span class="p-sub">${fmtMoney(k.floor)} at everyone's floor · ${fmtMoney(k.ceiling)} at everyone's ceiling</span>
        <span class="p-sub">· <b>${fmtWorth(k.worthTotal)} pts</b> gained over the players replaced</span></p>
      ${k.ungradedPairs && k.ungradedPairs.length ? `<p class="p-sub">${k.ungradedPairs.length} pick${k.ungradedPairs.length > 1 ? 's replace' : ' replaces'} a man with no grade on record (${k.ungradedPairs.map(esc).join('; ')}) — no point-worth is claimed for ${k.ungradedPairs.length > 1 ? 'those pairings' : 'that pairing'}, and the points total sums the graded pairings only.</p>` : ''}
      ${k.skipped.length ? `<p class="p-sub">Passed over — even the cheapest fix did not fit what was left of the budget: ${k.skipped.map(esc).join(', ')}.</p>` : ''}
      <button type="button" class="btn-ghost budget-open" data-budgetopen="${k.budget}">Open in class builder</button>
    </div>`;
  };
  return `<div class="card" id="budgetReport">
    <h2 class="sec" style="margin-top:2px">Budget Report — ${esc(t.name)}</h2>
    <p class="p-sub">The rooms ranked by gap — grade points from the room’s incumbent to the conference-best standard, biggest first — the cheapest getable fix in each room, and three ready-built classes at set budgets. Every price is at the class builder’s current mark, <b>${esc(mark)}</b> (the “Price new saves at” setting on the saved class board above). ${bm.need} of ${bm.rooms.length} rooms sit below the standard; ${bm.fixable} of those have a getable fix.</p>
    <div class="tbl-scroll"><table class="ctable champ-table">
      <thead><tr><th>Room</th><th>Incumbent</th><th class="num">Inc. grade</th><th class="num">Standard</th><th class="num">Gap</th><th>Cheapest getable fix at ${esc(mark)}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <h3 class="sub-h" style="margin-top:16px">Three classes, built to a budget</h3>
    <p class="p-sub">How these classes are built — rooms are filled biggest gap first, one fix per room. In each room the class takes the best getable player — highest benchmark first — whose price at your current mark fits what is left of the budget. A room is passed over when even its cheapest getable fix does not fit what is left, and a room with no getable fix at any price is never filled. Each pick also pushes the bottom man in that room off — the path works from the bottom of the room up toward its median, the bottom player is replaceable whatever his snap count, and a man with no grade on record is the first to fall off; the pick’s worth, printed on his row, is his benchmark minus the replaced man’s grade, and no point-worth is claimed against an ungraded man. Opening a class in the builder loads it in memory only — your saved class for ${esc(t.name)} is untouched until you change something in it.</p>
    ${bm.classes.map(classBlock).join('')}
    <p class="foot-note">Method, in plain terms. <b>Gap</b> is grade points from the room’s incumbent to the conference-best standard; an asterisked incumbent is a below-bar room carried by its top player by volume — the depth test still applies to the room, so a fix can be named for it. <b>Getable</b> is the depth test under the path replacement doctrine: the path works from the bottom of the room up toward its median, so an evaluated player with eligibility remaining is getable when his benchmark beats the room’s lowest-graded man — the bottom player is replaceable whatever his snap count — or when he slots into the room above a man with no grade on record, who is the first to fall off; a fix marked “Beats your starter” also clears the room’s top man. <b>Cheapest fix</b> is the lowest-priced getable player in the room at your current mark, with his estimated band beside him. <b>Scholarship only:</b> a fix whose offer at this school is Scholarship only is not an NIL spend — it prints the label instead of a price and counts $0 in every class total at every mark. <b>Floor totals are soft:</b> the NIL model’s floor is $0 in some band cells — 79 priced players sit in $0-floor cells — so a class’s floor bound understates what those players would really cost. ${esc(NIL_LABEL)}</p>
  </div>`;
}

/* Load a budget-built class into the board with share-link semantics:
   the class replaces the board's class in memory only — the stored
   class for the team is not read again and not overwritten; the first
   change the user makes saves it as their own (every mutation path
   runs through saveClass, exactly as with a shared class). */
function openBudgetClass(budget) {
  const t = CHAMP && CHAMP.teams.find(x => x.name === champSel);
  if (!t) return;
  const bm = budgetModel(t, champModel(t, CHAMP.meta.groups));
  const k = bm.classes.find(c => c.budget === budget);
  if (!k || !k.picks.length) return;
  const cls = {};
  for (const p of k.picks) cls[p.c.id] = { g: p.g, hit: champHitDefault };
  champPicked = true;   // the report names its team explicitly — like a share link, My Team must not move the page off it
  champSharedPending = { team: t.name, cls };
  champRestoreScroll = 'board';
  renderChamp();
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

const STATE_NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

let champRegional = false;
let champArchSel = new Set();   // archetypes ticked on the championship path — a getable/available player matches if he holds ANY of them
let champArchModeAll = false;   // championship archetype mode: ANY ticked tag (default) vs EVERY ticked tag
function archMatchId(id) {
  if (!champArchSel.size) return true;
  return champArchModeAll ? holdsAllTags(byIdAll[id], champArchSel) : holdsAnyTag(byIdAll[id], champArchSel);
}
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
/* The room's fall-off order under the path replacement doctrine
   (Tommy, Nov 19, 2026): the whole roster from the bottom up, snaps
   aside — men with no grade on record first (the bottom by
   definition), then graded men ascending by grade, zero-volume men
   included. This is the order adds pair against. */
function roomBottom(r) {
  return ((r && r.roster) || []).slice().sort((a, b) => {
    const an = a.grade == null, bn = b.grade == null;
    if (an !== bn) return an ? -1 : 1;
    if (an && bn) return String(a.name).localeCompare(String(b.name));
    return a.grade - b.grade || String(a.name).localeCompare(String(b.name));
  });
}
function slotIn(roster, bench) {
  let rank = 1, above = null, below = null;
  for (const p of roster || []) {
    if (p.grade != null && p.grade > bench) { rank++; if (!above || p.grade < above.grade) above = p; }
    else if (p.grade != null && (!below || p.grade > below.grade)) below = p;
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
  let spend = 0, floor = 0, ceiling = 0, priced = 0, n = 0, sch = 0;
  for (const [id, c] of Object.entries(champClass)) {
    const e = idx[id]; if (!e) continue;
    n++;
    /* a scholarship-tier add at this school is not an NIL spend:
       $0 to the spend and to both bounds, at every mark */
    if (isScholarshipTier(offerTierForEntry(e, champClassTeam))) { sch++; continue; }
    const p = hitPrice(e, c.hit);
    if (p != null) { priced++; spend += p; floor += e.nil_floor; ceiling += e.nil_ceiling; }
  }
  return { n, priced, spend, floor, ceiling, sch };
}
function updateClassTotals() {
  const ct = classTotals();
  const s = $('classSpend'), b = $('classBounds');
  if (s) s.textContent = (ct.priced || ct.sch) ? fmtMoney(ct.spend) : '—';
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

/* ---- replacement pairing: who falls off when a player is added ----
   Tommy, Nov 18, 2026: what is each added player worth against the
   player he would be replacing — and the worst player falls off.
   The PATH REPLACEMENT DOCTRINE (Tommy, Nov 19, 2026) sets the set
   the adds pair against: "we want to work to replace the median of
   the room — we want to replace the bottom player irrespective of
   amount of snaps, and quite frankly they should have a limited
   amount of snaps." So the pairing reads the room's TRUE bottom
   across all rostered men, snaps aside (roomBottom): men with no
   grade on record fall off FIRST — they are the bottom by
   definition — then graded men ascending by grade, zero-volume men
   included. In the order the adds were made, each add pushes the
   next man off the bottom; the add's WORTH is his benchmark minus
   that man's grade, printed plainly even when negative — except
   against an ungraded man, where no point-worth is claimed (worth
   null, the pairing still named). Adds beyond the room's size pair
   with nobody. Pairings recompute from scratch on every render, so
   removing an add re-pairs the adds behind it against the room as
   it stands. */
function pairAdds(t, adds) {
  const out = new Map();
  const taken = {};
  for (const a of adds) {
    const rot = roomBottom((t.rooms || {})[a.g]);
    const k = taken[a.g] || 0;
    if (k < rot.length) {
      const off = rot[k];
      out.set(a.id, { off, worth: off.grade == null ? null : Math.round((a.benchmark - off.grade) * 10) / 10 });
    } else {
      out.set(a.id, { off: null, worth: null });
    }
    taken[a.g] = k + 1;
  }
  return out;
}
function classPairings(t) {
  const idx = availIdx();
  const adds = [];
  for (const [id, c] of Object.entries(champClass)) {
    const e = idx[id]; if (!e) continue;
    adds.push({ id, g: c.g, benchmark: e.benchmark });
  }
  return pairAdds(t, adds);
}
const fmtWorth = w => (w >= 0 ? '+' : '') + f1(w);
function pairText(pr) {
  if (!pr || !pr.off) return 'No player left to fall off in this room';
  return pr.off.grade == null
    ? `Replaces <b>${esc(pr.off.name)}</b> (no grade on record) · no point-worth claimed`
    : `Replaces <b>${esc(pr.off.name)}</b> (${f1(pr.off.grade)}) · worth <b>${fmtWorth(pr.worth)} pts</b>`;
}
function pairTextPlain(pr) {
  if (!pr || !pr.off) return 'no player left to fall off in this room';
  return pr.off.grade == null
    ? `replaces ${pr.off.name} (no grade on record), no point-worth claimed`
    : `replaces ${pr.off.name} (${f1(pr.off.grade)}), worth ${fmtWorth(pr.worth)} pts`;
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
    (ct.priced || ct.sch) ? `Class spend at your marks: ${fmtMoney(ct.spend)} a year (${fmtMoney(ct.floor)} at everyone's floor · ${fmtMoney(ct.ceiling)} at everyone's ceiling)${ct.sch ? ` · ${ct.sch} add(s) at Scholarship only — $0 NIL, not counted in the spend` : ''}${ct.n - ct.priced - ct.sch > 0 ? ` · ${ct.n - ct.priced - ct.sch} player(s) with no estimate, not counted` : ''}` : 'Class spend: no priced players.',
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
  const totalsH = 36 + ((snap.ct.priced || snap.ct.sch) ? 18 : 0) + effLines.length * 18;
  const tY = 116 + snap.items.length * ROWH;
  const H = tY + totalsH + 22 + footLines.length * 14 + 12;
  const S = 2;
  const cv = document.createElement('canvas');
  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.scale(S, S);
  ctx.fillStyle = '#0d1526'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#070b14'; ctx.fillRect(0, 0, W, 88);
  ctx.fillStyle = '#ffffff'; ctx.font = `700 20px ${FONT}`;
  ctx.fillText(fitLine(ctx, `Saved class — ${snap.team}`, MAXW), PAD, 38);
  ctx.fillStyle = '#cbd5e1'; ctx.font = `12.5px ${FONT}`;
  ctx.fillText(`${snap.date} · Player Books — championship path`, PAD, 62);
  let y = 112;
  for (const it of snap.items) {
    ctx.fillStyle = '#f1f5f9'; ctx.font = `700 15px ${FONT}`;
    ctx.fillText(fitLine(ctx, it.name + `${it.hv ? ' · Hidden Value' : ''}${it.down ? ' · P4 Down' : ''}`, MAXW), PAD, y);
    ctx.fillStyle = '#a8b3c5'; ctx.font = `12.5px ${FONT}`;
    ctx.fillText(fitLine(ctx, `${it.g} · ${it.school} · benchmark ${f1(it.benchmark)} · slots #${it.rank} of ${it.of} in this room`, MAXW), PAD, y + 19);
    ctx.fillStyle = '#f1f5f9';
    ctx.fillText(fitLine(ctx, it.tier ? `${it.tier} — no NIL spend at this school` : it.price != null ? `Priced at ${hitLabel(it.hit)} — ${fmtMoney(it.price)} a year · band ${it.band}` : 'Est. NIL — no estimate (not counted in the spend)', MAXW), PAD, y + 38);
    y += ROWH;
    ctx.strokeStyle = '#263449'; ctx.beginPath(); ctx.moveTo(PAD, y - 12); ctx.lineTo(W - PAD, y - 12); ctx.stroke();
  }
  ctx.fillStyle = '#111a2e'; ctx.fillRect(PAD - 8, tY, MAXW + 16, totalsH);
  ctx.fillStyle = '#f1f5f9'; ctx.font = `700 14.5px ${FONT}`;
  ctx.fillText((snap.ct.priced || snap.ct.sch) ? `Class spend at your marks: ${fmtMoney(snap.ct.spend)} a year` : 'Class spend: no priced players.', PAD, tY + 24);
  let ly = tY + 24;
  if (snap.ct.priced || snap.ct.sch) {
    ctx.fillStyle = '#a8b3c5'; ctx.font = `12.5px ${FONT}`;
    ly += 18;
    ctx.fillText(fitLine(ctx, `${snap.ct.priced ? `${fmtMoney(snap.ct.floor)} at everyone's floor · ${fmtMoney(snap.ct.ceiling)} at everyone's ceiling · ` : ''}${snap.ct.n} player${snap.ct.n > 1 ? 's' : ''}${snap.ct.sch ? ` · ${snap.ct.sch} at Scholarship only — $0 NIL` : ''}${snap.ct.n - snap.ct.priced - snap.ct.sch > 0 ? ` · ${snap.ct.n - snap.ct.priced - snap.ct.sch} with no estimate, not counted` : ''}`, MAXW), PAD, ly);
  }
  ctx.fillStyle = '#f1f5f9'; ctx.font = `12.5px ${FONT}`;
  for (const L of effLines) { ly += 18; ctx.fillText(L, PAD, ly); }
  ctx.fillStyle = '#7d8aa0'; ctx.font = `10.5px ${FONT}`;
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
function canCopyImage() {
  try {
    return !!(window.ClipboardItem && navigator.clipboard && typeof navigator.clipboard.write === 'function');
  } catch (err) { return false; }
}
function copyClassImage() {
  const note = document.querySelector('[data-copynote]');
  const say = msg => { if (note) { note.hidden = false; note.textContent = msg; } };
  classImageBlob(b => {
    if (!b) { say('The picture could not be made on this device — use Download instead, then attach the file.'); return; }
    try {
      const p = navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]);
      if (p && typeof p.then === 'function') p.then(
        () => say('Picture copied — open an email draft below and paste it in (Ctrl+V, or Cmd+V on a Mac).'),
        () => say('The browser blocked the copy — use Download instead, then attach the file to the draft.'));
      else say('Picture copied — open an email draft below and paste it in (Ctrl+V, or Cmd+V on a Mac).');
    } catch (err) { say('The browser blocked the copy — use Download instead, then attach the file to the draft.'); }
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
  const pairings = classPairings(t);
  let worthTotal = 0, unpairedN = 0;
  const ungradedPairs = [];
  for (const [id, pr] of pairings) {
    if (pr.off && pr.off.grade == null) {
      const e = idx[id];
      ungradedPairs.push(`${e ? e.name : id} replaces ${pr.off.name}`);
    } else if (pr.worth != null) worthTotal += pr.worth;
    else unpairedN++;
  }
  worthTotal = Math.round(worthTotal * 10) / 10;
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
      const s = slotIn((t.rooms[g] || {}).roster || [], e.benchmark);
      const tier = offerTierForEntry(e, t.name);
      const schTier = isScholarshipTier(tier);
      const price = schTier ? 0 : hitPrice(e, hit);
      lines.push(`${e.name} (${g}) — ${e.school} — benchmark ${f1(e.benchmark)} — slots #${s.rank} of ${s.of} in the ${t.name} room — ${pairTextPlain(pairings.get(e.id))} — ${schTier ? `${tier} at ${t.name} — no NIL spend` : price != null ? `priced at ${hitLabel(hit)}: ${fmtMoney(price)} a year (band ${nilRange(e)})` : 'Est. NIL: no estimate'}`);
      items.push({ name: e.name, g, school: e.school, benchmark: e.benchmark, rank: s.rank, of: s.of, price, hit, tier: schTier ? tier : null, band: price != null ? nilRange(e) : null, hv: !!e.hv, down: e.dir === 'down' });
      rows += `<div class="class-row">${photo(e)}
        <div class="avail-main">
          <a href="#/player/${esc(encodeURIComponent(e.id))}"><span class="pname">${esc(e.name)}</span></a>
          <span class="room-tag">${esc(g)}</span>${e.hv ? '<span class="hv">Hidden Value</span>' : ''}${e.dir === 'down' ? '<span class="down-badge">P4 Down</span>' : ''}
          <br><span class="p-sub">${esc(e.school)} · benchmark <b>${f1(e.benchmark)}</b> · slots <b>#${s.rank} of ${s.of}</b> in this room</span>
          <br><span class="p-sub">${pairText(pairings.get(e.id))}</span>
          ${schTier ? `<br><span class="p-sub">${nilRange(e) ? `Est. NIL ${nilRange(e)} a year — ` : ''}<b>${esc(tier)}</b> at ${esc(t.name)}: no NIL spend here</span>
          <span class="hit-print">${esc(tier)} — no NIL spend</span>`
          : `<br><span class="p-sub">${price != null ? `Est. NIL ${nilRange(e)} a year` : 'Est. NIL — no estimate (not counted in the spend)'}</span>
          ${price != null ? `<span class="hit-ctl"><span class="hit-chips">${HIT_STOPS.map(([v, lab]) =>
            `<button type="button" class="hit-chip${Math.abs(hit - v) < 0.001 ? ' on' : ''}" data-hitpid="${esc(e.id)}" data-hitval="${v}">${lab}</button>`).join('')}</span>
          <input type="range" class="hit-range" min="0" max="100" step="5" value="${Math.round(hit * 100)}" data-hitrange="${esc(e.id)}" aria-label="Where ${esc(e.name)} lands between floor and ceiling">
          <b class="hit-price" id="hitprice-${esc(e.id)}">${fmtMoney(price)}</b></span>
          <span class="hit-print">Priced at ${esc(hitLabel(hit))} — ${fmtMoney(price)} a year</span>` : ''}`}
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
      <p class="p-sub" style="margin-top:0">The class goes out as a <b>picture of this board</b> — the class as it looks on screen — with the <b>full text underneath it</b>, so it still reads on a phone even where the picture doesn't load. Get the picture first, then open a draft for the text.</p>
      <div class="email-btns">
        ${canShareFiles() ? '<button type="button" class="btn-save" data-shareclass>Share — picture + text</button>' : ''}
        <button type="button" class="btn-ghost" data-dlimg>Download board picture</button>
        ${canCopyImage() ? '<button type="button" class="btn-ghost" data-copyimg>Copy board picture</button>' : ''}
      </div>
      ${canShareFiles() ? '<p class="p-sub"><b>Share</b> drops the picture straight into your mail app — Apple Mail, the Gmail app, whichever you pick — with the text under it. That is the one route that attaches the picture by itself.</p>' : ''}
      <p class="p-sub" data-copynote hidden></p>
      <p class="p-sub">Email drafts open with the text only — a web page can't attach the picture. Download or copy the picture first, then attach or paste it into the draft.</p>
      <div class="email-btns">
        <a class="btn-ghost mail-btn" href="${classMailto(t, m, ct, eff, lines)}">Open an email draft — text only</a>
        <a class="btn-ghost mail-btn" href="${gmailCompose(t, m, ct, eff, lines)}" target="_blank" rel="noopener">Open in Gmail — text only</a>
      </div>
    </div>` : ''}
    ${ct.n ? `<div class="class-list">${rows}</div>
    <p class="class-totals">Class spend at your marks: <b id="classSpend">${(ct.priced || ct.sch) ? fmtMoney(ct.spend) : '—'}</b> a year
      <span class="p-sub" id="classBounds">${ct.priced ? `${fmtMoney(ct.floor)} at everyone's floor · ${fmtMoney(ct.ceiling)} at everyone's ceiling` : ''}</span>
      <span class="p-sub">· ${ct.n} player${ct.n > 1 ? 's' : ''}${ct.sch ? ` · ${ct.sch} at Scholarship only — no NIL spend` : ''}${ct.n - ct.priced - ct.sch > 0 ? ` · ${ct.n - ct.priced - ct.sch} with no estimate, not counted` : ''}</span></p>
    <p class="p-sub">Points gained over the players replaced: <b>${fmtWorth(worthTotal)} pts</b> in total — each saved player’s benchmark against the man he pushes off the bottom of his room, named on his row; the pairing works from the bottom of the room up, snaps aside.${ungradedPairs.length ? ` ${ungradedPairs.length} pairing${ungradedPairs.length > 1 ? 's replace' : ' replaces'} a man with no grade on record (${ungradedPairs.map(esc).join('; ')}) — no point-worth is claimed for ${ungradedPairs.length > 1 ? 'those' : 'that'} pairing${ungradedPairs.length > 1 ? 's' : ''}, and the total above sums the graded pairings only.` : ''}${unpairedN ? ` ${unpairedN} saved player${unpairedN > 1 ? 's have' : ' has'} no player left to fall off and count${unpairedN > 1 ? '' : 's'} as no gain.` : ''}</p>
    <p class="p-sub">With this class: <b>${eff.atAfter} of ${m.rooms.length} rooms at the standard</b> (today: ${m.atNow}) · <b>${f1(eff.points)} grade points to the standard</b> (today: ${f1(m.points)}). Read the same way as the path summary above — a room counts when its projected top grade, the better of the incumbent and your best class benchmark in it, reaches the conference-best standard.</p>`
    : '<p class="p-sub class-empty">No players saved yet — drag a player here, use his Save button below, or save him from his player page.</p>'}
    <p class="foot-note">${esc(NIL_LABEL)}</p>
  </div>`;
}

function renderFullRooms(t, m) {
  const pairings = classPairings(t);
  let h = '';
  for (const x of m.rooms) {
    const g = x.g, r = x.r;
    const rosterAll = r.roster || [];
    const roster = rosterAll.filter(p => p.vol > 0);
    const zeroVol = rosterAll.filter(p => !(p.vol > 0));
    const fallSet = new Set();
    for (const [id, pr] of pairings) {
      const c = champClass[id];
      if (c && c.g === g && pr.off) fallSet.add(pr.off.name + '|' + pr.off.grade);
    }
    const all = champAvailFor(t, g);
    const reg = all.filter(e => isRegional(t, e));
    let shown = champRegional ? reg : all;
    if (champArchSel.size) shown = shown.filter(e => archMatchId(e.id));
    const rosterRows = roster.map((p, i) => `<tr><td class="num">${i + 1}</td><td>${esc(p.name)}${p.grade == null ? ' <span class="p-sub">(no grade on record)</span>' : ''}${fallSet.has(p.name + '|' + p.grade) ? ' <span class="fall-off">(falls off)</span>' : ''}</td><td class="num"><b>${f1(p.grade)}</b></td><td class="num">${esc(p.vol)} ${esc(r.vol_unit || '')}</td></tr>`).join('')
      + (zeroVol.length ? `<tr class="roster-div"><td colspan="4">Also in the data — no recorded ${esc(r.vol_unit || 'volume')} in the snapshot</td></tr>`
        + zeroVol.map(p => `<tr class="vol0"><td class="num">—</td><td>${esc(p.name)}${p.grade == null ? ' <span class="p-sub">(no grade on record)</span>' : ''}${fallSet.has(p.name + '|' + p.grade) ? ' <span class="fall-off">(falls off)</span>' : ''}</td><td class="num">${f1(p.grade)}</td><td class="num">0 ${esc(r.vol_unit || '')}</td></tr>`).join('') : '');
    /* the strict tier, marked in the room's own list: his benchmark
       beats the room's top man — the qualified incumbent's grade, or
       the best grade in the played rotation for a below-bar room */
    const playedGrades = roster.map(p => p.grade).filter(v => v != null);
    const topBar = r.below_bar
      ? (playedGrades.length ? Math.max(...playedGrades) : null)
      : r.inc_grade;
    const availRows = shown.map(e => {
      const s = slotIn(rosterAll, e.benchmark);
      const inClass = !!champClass[e.id];
      const beatsStarter = topBar != null && e.benchmark > topBar;
      const slotTxt = rosterAll.length
        ? `Slots <b>#${s.rank} of ${s.of}</b>${s.above ? ` — behind ${esc(s.above.name)} ${f1(s.above.grade)}` : ' — the room’s top grade'}${s.below ? ` · ahead of ${esc(s.below.name)} ${f1(s.below.grade)}` : ''}`
        : 'No rostered player in this room in the pool snapshot';
      return `<div class="avail-row${inClass ? ' in-class' : ''}" draggable="true" data-dragpid="${esc(e.id)}">${photo(e)}
        <div class="avail-main">
          <a href="#/player/${esc(encodeURIComponent(e.id))}"><span class="pname">${esc(e.name)}</span></a>${e.hv ? '<span class="hv">Hidden Value</span>' : ''}${e.dir === 'down' ? '<span class="down-badge">P4 Down</span>' : ''}${beatsStarter ? '<span class="starter-badge">Beats your starter</span>' : ''}${isRegional(t, e) ? `<span class="reg-badge">Regional · ${esc(e.home_state)}</span>` : ''}${tagBadges(e.id)}
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
          <h3 class="sub-h">The room he enters — ${esc(t.name)} ${esc(g)} (${rosterAll.length})</h3>
          ${rosterAll.length ? `<div class="tbl-scroll"><table class="fits room-tbl"><thead><tr><th class="num">#</th><th>Player</th><th class="num">Grade</th><th class="num">Volume</th></tr></thead><tbody>${rosterRows}</tbody></table></div>`
            : '<p class="p-sub">No rostered players at this group in the pool snapshot.</p>'}
          <p class="p-sub">Every player with a report row at this group — the rotation first (with volume), then the rostered names with no recorded ${esc(r.vol_unit || 'volume')} in the snapshot. Every man in the room counts in slot-in standing: the path works from the bottom of the room up, the bottom player is replaceable whatever his snap count, and a man with no grade on record is the bottom of the room and the first to fall off. Incumbent: <b>${r.incumbent ? esc(r.incumbent) : '— none qualified —'}${r.inc_grade != null ? ` (${f1(r.inc_grade)})` : ''}</b> · conference-best standard <b>${r.bar_grade != null ? f1(r.bar_grade) : '—'}</b>.</p>
        </div>
        <div>
          <h3 class="sub-h">Available — ${shown.length} of ${all.length} evaluated players${champRegional ? ` (regional only · ${reg.length} regional)` : ''}${champArchSel.size ? ' (archetype filter on — ticked tags only)' : ''}</h3>
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
    ${cmpNote('How to read this page: the pool is a <b>Nov 17, 2026 in-season snapshot</b> of PFF Ultimate exports, and grades are PFF headline grades. The <b>incumbent</b> is each room’s top-graded <b>volume-qualified</b> player under the books’ fits bars (for example TE ≥ 20 targets, OL ≥ 200 snaps). A room with no qualified player is <b>carried by its top player by volume</b>, flagged with an asterisk and his volume against the bar — his gaps print, but no candidates are named for that room. Conference and level medians are medians of team incumbents — the level median is the G6 median for a G6 team, the P4 median for a P4 team. <b>Upgrade candidates</b> are the evaluated players — the twelve conference books, the ULM and UTEP books and the P4 Down book — who clear the room under the depth test: his benchmark beats the room’s lowest-graded man, and a candidate flagged as beating the incumbent also clears the room’s top man. A P4 Down player’s benchmark is his headline grade at a P4 room (same level, no translation adjustment) and his projected grade at a G6 room.')}
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

/* -------- Value Board (#/value) --------
   Every priced player (683) ranked inside his position pool by value:
   steady value = benchmark-grade percentile − price percentile;
   ceiling value = ceiling-rung percentile − price percentile (the
   percentile of the band ceiling rung's ladder index inside the pool —
   no rung-to-grade conversion exists; see VALUE_METHOD.md). Records
   carry the layer's "value" field (value_join.py, joined from
   data/value_board.json); the 83 NO ESTIMATE players carry none and
   are not on the board. Every row prints the player's actual NIL band
   beside his scores — 79 players sit in $0-floor cells, and a score is
   never shown without its band. Both scores print under both lenses;
   the ceiling lens breaks its tie blocks by the steady score. */
let valueLens = 'steady';            // 'steady' | 'ceiling'
const valuePosSel = new Set();       // positions ticked on the board (OR within the filter)

const valuePool = () => [...UP, ...DOWN].filter(p => p.value);

function valuePosBtnLabel() {
  const btn = $('v-pos');
  if (!btn) return;
  const n = valuePosSel.size;
  btn.innerHTML = `Position${n ? ` · ${n}` : ''} <span class="ms-caret">▾</span>`;
  btn.classList.toggle('ms-on', n > 0);
}

function buildValuePosPanel() {
  const box = $('valuePosOpts');
  if (!box) return;
  const counts = {};
  for (const p of valuePool()) counts[p.value.position] = (counts[p.value.position] || 0) + 1;
  box.innerHTML = Object.keys(counts).sort().map(n =>
    `<label class="ms-opt"><input type="checkbox" value="${esc(n)}"${valuePosSel.has(n) ? ' checked' : ''}> ${esc(n)} (${counts[n]})</label>`).join('');
  valuePosBtnLabel();
}

function renderValue() {
  const pool = valuePool();
  const rows = pool.filter(p => !valuePosSel.size || valuePosSel.has(p.value.position));
  const bySteady = (a, b) => (b.value.steady_value - a.value.steady_value)
    || (b.value.ceiling_value - a.value.ceiling_value) || a.name.localeCompare(b.name);
  const byCeiling = (a, b) => (b.value.ceiling_value - a.value.ceiling_value)
    || (b.value.steady_value - a.value.steady_value) || a.name.localeCompare(b.name);
  rows.sort(valueLens === 'ceiling' ? byCeiling : bySteady);
  $('valueCount').textContent = `${rows.length} of ${pool.length} priced players`;
  $('valueSteadyBtn').classList.toggle('on', valueLens === 'steady');
  $('valueCeilingBtn').classList.toggle('on', valueLens === 'ceiling');
  $('valueBody').innerHTML = rows.map((p, i) => {
    const v = p.value;
    return `<tr data-id="${esc(p.id)}">
      <td class="num">${i + 1}</td>
      <td><a class="pname" href="#/player/${encodeURIComponent(p.id)}">${esc(p.name)}</a>${isOverpay(p) ? '<span class="overpay-chip">OVERPAY</span>' : ''}</td>
      <td>${esc(p.school)}</td>
      <td>${esc(v.position)}</td>
      <td class="num">${f1(v.grade_used)}</td>
      <td>${esc(v.ceiling_level)}</td>
      <td class="num">${fmtMoney(v.nil_low)}–${fmtMoney(v.nil_high)}</td>
      <td class="num${valueLens === 'steady' ? ' v-on' : ''}">${f1(v.steady_value)}</td>
      <td class="num${valueLens === 'ceiling' ? ' v-on' : ''}">${f1(v.ceiling_value)}</td>
    </tr>`;
  }).join('');
  $('valueEmpty').hidden = rows.length > 0;
  $('valueLabel').textContent = NIL_LABEL;
}

/* ---------------- map view: players by home state ----------------
   Tommy, Nov 19, 2026: a real geographic map — every US state drawn in
   place, and Canada drawn on the map in its position north of the US
   as ONE selectable country outline (no provinces) — with, alongside
   it, the same selection as an alphabetical list of states with counts
   and checkboxes, "just in case a coach is not a geography guy". The
   map and the list are one selection: clicking a state on the map
   ticks its box and vice versa. International players have no
   geography on this continent: the globe block beside the map selects
   them. Everything runs over BOTH directories off the home-geography
   fields joined onto every record (home_geo.py): home_state /
   home_country / home_country_name. A player with no hometown on
   record is his own honest bucket — counted, listed and selectable,
   never silently dropped. Boundary geometry is simplified
   public-domain data (US Census via us-atlas, Natural Earth via
   world-atlas), generated into app.js by build_map_geo.py. */
let mapSel = new Set();
const MAP_SPECIAL = { CANADA: 'Canada', INTL: 'International', UNKNOWN: 'Hometown not on record' };
const GLOBE_SVG = `<svg class="map-globe" viewBox="0 0 48 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2"><circle cx="24" cy="24" r="16"/><ellipse cx="24" cy="24" rx="7" ry="16"/><path d="M8.5 19h31M8.5 29h31"/></g></svg>`;
function mapKeyOf(p) {
  if (p.home_country === 'US' && p.home_state) return p.home_state;
  if (p.home_country === 'Canada') return 'CANADA';
  if (p.home_country === 'International') return 'INTL';
  return 'UNKNOWN';
}
function mapCounts() {
  const c = {};
  for (const p of [...UP, ...DOWN]) { const k = mapKeyOf(p); c[k] = (c[k] || 0) + 1; }
  return c;
}
function mapKeyLabel(k) {
  return MAP_SPECIAL[k] || STATE_NAMES[k] || k;
}
function mapSelectedPlayers() {
  return [...UP, ...DOWN].filter(p => mapSel.has(mapKeyOf(p)))
    .sort((a, b) => (b.headline_grade || 0) - (a.headline_grade || 0) || a.name.localeCompare(b.name));
}
function renderMap() {
  const body = $('mapBody');
  if (!body) return;
  const counts = mapCounts();
  const total = UP.length + DOWN.length;
  const intlNames = [...new Set([...UP, ...DOWN]
    .filter(p => p.home_country === 'International' && p.home_country_name)
    .map(p => p.home_country_name))].sort();
  const intlCounts = {};
  for (const p of [...UP, ...DOWN]) if (p.home_country === 'International')
    intlCounts[p.home_country_name] = (intlCounts[p.home_country_name] || 0) + 1;
  let svg = `<svg class="map-svg" viewBox="${MAP_VIEWBOX}" role="group" aria-label="Map of Canada and the United States">`;
  svg += `<path class="map-region${mapSel.has('CANADA') ? ' sel' : ''}" data-mapkey="CANADA" d="${CANADA_PATH}"><title>Canada — ${counts.CANADA || 0} players</title></path>`;
  for (const code of Object.keys(STATE_PATHS))
    svg += `<path class="map-region${mapSel.has(code) ? ' sel' : ''}" data-mapkey="${code}" d="${STATE_PATHS[code]}"><title>${esc(STATE_NAMES[code] || code)} — ${counts[code] || 0} players</title></path>`;
  for (const [code, pt] of Object.entries(MAP_LABELS)) {
    if (MAP_CALLOUTS[code]) continue;
    if (code === 'CANADA')
      svg += `<text class="map-lab map-lab-can" x="${pt[0]}" y="${pt[1]}">CANADA</text><text class="map-cnt" x="${pt[0]}" y="${pt[1] + 16}">${counts.CANADA || 0}</text>`;
    else
      svg += `<text class="map-lab" x="${pt[0]}" y="${pt[1]}">${code}</text><text class="map-cnt" x="${pt[0]}" y="${pt[1] + 12}">${counts[code] || 0}</text>`;
  }
  for (const [code, pt] of Object.entries(MAP_CALLOUTS)) {
    if (code === '_x') continue;
    const lp = MAP_LABELS[code] || [0, 0];
    svg += `<line class="map-leader" x1="${lp[0]}" y1="${lp[1]}" x2="${pt[0] - 4}" y2="${pt[1]}"/><text class="map-callout${mapSel.has(code) ? ' sel' : ''}" data-mapkey="${code}" x="${pt[0]}" y="${pt[1]}">${code} · ${counts[code] || 0}</text>`;
  }
  svg += '</svg>';
  const stateCodes = Object.keys(STATE_PATHS)
    .sort((a, b) => (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b));
  const listRow = k => `<label class="map-opt"><input type="checkbox" data-mapcheck="${k}"${mapSel.has(k) ? ' checked' : ''}> <span class="map-opt-name">${esc(mapKeyLabel(k))}</span> <span class="map-opt-n">${counts[k] || 0}</span></label>`;
  const list = stateCodes.map(listRow).join('')
    + '<div class="map-opt-sep"></div>'
    + ['CANADA', 'INTL', 'UNKNOWN'].map(listRow).join('');
  const sel = mapSelectedPlayers();
  const selNames = [...mapSel].map(mapKeyLabel);
  const rows = sel.map(p => `<tr>
      <td><a href="#/player/${esc(encodeURIComponent(p.id))}"><span class="pname">${esc(p.name)}</span></a>${p.hidden_value ? '<span class="hv">Hidden Value</span>' : ''}${p.direction === 'down' ? '<span class="down-badge">P4 Down</span>' : ''}</td>
      <td>${esc(p.position || '')}</td><td>${esc(p.school)}</td>
      <td>${esc(p.conference_book || '')}</td>
      <td class="num"><b>${f1(p.headline_grade)}</b></td></tr>`).join('');
  body.innerHTML = `
  <div class="card">
    <h2 class="sec" style="margin-top:2px">Players by home state</h2>
    <p class="p-sub">Every evaluated player in both directories — <b>${total} players</b> — placed by the hometown on his record. Click a state on the map, or tick it in the list: the map and the list are the same selection, and you can pick as many as you like. Canada is drawn on the map as one region. Players from anywhere else in the world are under <b>International</b> — the globe. A player whose hometown is not on record is counted under his own heading, never dropped.</p>
    <div class="map-layout">
      <div class="map-mapwrap">${svg}
        <p class="p-sub map-note">The small north-eastern states are labelled at the right with their counts — Vermont, New Hampshire, Massachusetts, Rhode Island, Connecticut, New Jersey, Delaware, Maryland and the District of Columbia are drawn in place and clickable, just small.</p>
      </div>
      <div class="map-side">
        <div class="map-block${mapSel.has('INTL') ? ' sel' : ''}" data-mapkey="INTL" role="button" tabindex="0" aria-pressed="${mapSel.has('INTL')}">
          ${GLOBE_SVG}
          <div><h3>International</h3>
          <p class="p-sub"><b>${counts.INTL || 0} players</b> from outside the US and Canada${intlNames.length ? ` — ${intlNames.map(n => `${esc(n)} ${intlCounts[n]}`).join(' · ')}` : ''}. No geography on this map — one block for the rest of the world.</p></div>
        </div>
        <div class="map-block${mapSel.has('UNKNOWN') ? ' sel' : ''}" data-mapkey="UNKNOWN" role="button" tabindex="0" aria-pressed="${mapSel.has('UNKNOWN')}">
          <div><h3>Hometown not on record</h3>
          <p class="p-sub"><b>${counts.UNKNOWN || 0} players</b> have no hometown on record in the library. They are counted here, never silently dropped.</p></div>
        </div>
        <div class="map-list" aria-label="States by name">${list}</div>
      </div>
    </div>
  </div>
  <div class="card">
    ${mapSel.size
      ? `<div class="map-selhead"><h2 class="sec" style="margin-top:2px">${sel.length} player${sel.length === 1 ? '' : 's'} — ${selNames.map(esc).join(' · ')}</h2><button type="button" class="btn-ghost" data-mapclear>Clear the selection</button></div>
        ${sel.length
          ? `<div class="tbl-scroll"><table class="ctable"><thead><tr><th>Player</th><th>Pos</th><th>School</th><th>Book</th><th class="num">Grade</th></tr></thead><tbody>${rows}</tbody></table></div>`
          : '<p class="p-sub">No evaluated players in the library come from the selected region yet.</p>'}`
      : `<h2 class="sec" style="margin-top:2px">No region selected</h2>
        <p class="p-sub">Pick states on the map or in the list and their players land here — name, position, school, book and headline grade, each name opening his player page. Across the library: <b>${counts.TX || 0}</b> from Texas, the largest home state; <b>${counts.CANADA || 0}</b> from Canada; <b>${counts.INTL || 0}</b> international; <b>${counts.UNKNOWN || 0}</b> with no hometown on record.</p>`}
  </div>`;
}

/* ---------------- prototype search (build-a-player) ----------------
   Tommy, Nov 19, 2026: describe the player you want — position, size,
   hometown geography, ability, price — and get back the evaluated
   players who match, each row linking to his page and carrying the
   Prospect star and a Save-to-class action that write to the same
   localStorage stores as everywhere else. Every input is optional
   except position. The skills state (trait bars, the value lean, the
   include-flashes toggle) is the directory's own — one skills filter
   across the site — and the geography is the map view's own selection
   (mapSel): ticking a state here ticks it there. "Optimal size" is
   computed from the library itself by build_optimal_size.py: the
   height and weight interquartile ranges of the top-quartile
   benchmark players at the position (the group's full range when
   that set is under 20 players, with the basis printed). */
let protoArchSel = new Set();
let protoArchAll = false;
let protoCompCache = {};    // pool key -> {player id -> build composite | null}

const protoBench = p => {
  if (p.universe) return p.grade != null ? p.grade : null;   // a standard record sorts on his headline grade, labelled as such
  const b = (p.fits || {}).benchmark;
  return b != null ? b : (p.proj != null ? p.proj : null);
};

function protoPool() {
  const d = $('p-dir').value;
  if (d === 'all') return UNIVERSE ? [...UP, ...DOWN, ...UNIVERSE] : [...UP, ...DOWN];
  return d === 'up' ? UP : d === 'down' ? DOWN : [...UP, ...DOWN];
}

function protoComposite(p, pool, key) {
  if (!protoCompCache[key]) {
    const byGroup = {};
    for (const q of pool) (byGroup[q.screen_position || q.position] = byGroup[q.screen_position || q.position] || []).push(q);
    const map = {};
    for (const g of Object.keys(byGroup)) {
      const hs = [], ws = [];
      for (const q of byGroup[g]) {
        const h = heightInches(q.height); if (h != null) hs.push(h);
        if (q.weight != null) ws.push(q.weight);
      }
      hs.sort((a, b) => a - b); ws.sort((a, b) => a - b);
      for (const q of byGroup[g]) {
        const h = heightInches(q.height);
        map[q.id] = (h != null && q.weight != null && hs.length && ws.length)
          ? (midPct(hs, h) + midPct(ws, q.weight)) / 2 : null;
      }
    }
    protoCompCache[key] = map;
  }
  const c = protoCompCache[key][p.id];
  return c === undefined ? null : c;
}

function protoBuildTest(p, bf, pool, key) {
  const h = heightInches(p.height), w = p.weight == null ? null : p.weight;
  if (bf.htMin != null && (h == null || h < bf.htMin)) return false;
  if (bf.htMax != null && (h == null || h > bf.htMax)) return false;
  if (bf.wtMin != null && (w == null || w < bf.wtMin)) return false;
  if (bf.wtMax != null && (w == null || w > bf.wtMax)) return false;
  if (bf.build !== 'any') {
    const c = protoComposite(p, pool, key);
    if (c == null) return false;
    if (bf.build === 'half' && c < 50) return false;
    if (bf.build === 'quartile' && c < 75) return false;
  }
  return true;
}

function buildProtoPanels() {
  const counts = mapCounts();
  const geoRow = k => `<label class="map-opt"><input type="checkbox" data-protogeo="${k}"${mapSel.has(k) ? ' checked' : ''}> <span class="map-opt-name">${esc(mapKeyLabel(k))}</span> <span class="map-opt-n">${counts[k] || 0}</span></label>`;
  const stateCodes = Object.keys(STATE_PATHS).sort((a, b) => (STATE_NAMES[a] || a).localeCompare(STATE_NAMES[b] || b));
  $('protoGeo').innerHTML = stateCodes.map(geoRow).join('') + '<div class="map-opt-sep"></div>' + ['CANADA', 'INTL', 'UNKNOWN'].map(geoRow).join('');
  const mt = myTeamObj();
  const regBtn = $('p-regional');
  if (regBtn) {
    regBtn.hidden = !(mt && mt.state);
    if (mt && mt.state) regBtn.textContent = `Regional to my team — ${STATE_NAMES[mt.state] || mt.state} + bordering states`;
  }
  const tagCounts = {};
  for (const p of [...UP, ...DOWN]) for (const t of tagsOf(p)) tagCounts[t.tag] = (tagCounts[t.tag] || 0) + 1;
  $('protoArch').innerHTML = Object.keys(tagCounts).sort().map(t =>
    `<label class="map-opt"><input type="checkbox" data-protoarch="${esc(t)}"${protoArchSel.has(t) ? ' checked' : ''}> <span class="map-opt-name">${esc(t)}</span> <span class="map-opt-n">${tagCounts[t]}</span></label>`).join('');
  buildProtoTraits();
}

function buildProtoTraits() {
  const el = $('protoTraits');
  if (!el) return;
  const pos = $('p-pos').value;
  const pool = [...UP, ...DOWN].filter(p => (p.screen_position || p.position) === pos);
  const keys = Object.keys(TRAIT_REG).filter(k => (TRAIT_REG[k].groups || []).includes(pos));
  if (!keys.length) { el.innerHTML = '<p class="p-sub">No skill traits at this position.</p>'; return; }
  el.innerHTML = keys
    .map(k => ({
      k,
      n: pool.reduce((acc, p) => acc + (traitEntry(p, k) ? 1 : 0), 0),
      fn: pool.reduce((acc, p) => acc + (flashEntry(p, k) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.n - a.n || b.fn - a.fn)
    .map(({ k, n, fn }) => {
      const r = TRAIT_REG[k], d = TRAIT_DISPLAY[k] || {};
      const name = d.name || r.label;
      return `<label class="trait-row"><span class="trait-main"><span class="trait-name">${esc(name)}${r.proxy ? ' <span class="tag-proxy">stand-in stat</span>' : ''}</span>${d.gloss ? `<span class="trait-gloss">${esc(d.gloss)}</span>` : ''}</span><span class="trait-count">${n} ${groupPlural(pos)} in this library show this${fn ? ` · ${fn} more in limited action` : ''}</span><input type="number" class="trait-bar" data-prototrait="${esc(k)}" min="0" max="100" step="1" placeholder="75" value="${traitBars[k] != null ? traitBars[k] : ''}" aria-label="Cut-off for ${esc(name)}"></label>`;
    }).join('');
}

function protoSaveCell(p) {
  const e = availIdx()[p.id];
  if (!e || !CHAMP) return '<span class="p-sub">Not saveable</span>';
  const teams = CHAMP.teams.filter(t => champAvailFor(t, e._g).some(x => x.id === p.id));
  if (!teams.length) return '<span class="p-sub">Not saveable</span>';
  const def = teams.some(t => t.name === myTeam) ? myTeam : teams[0].name;
  return `<span class="proto-save"><select data-psave-sel="${esc(p.id)}" aria-label="School whose class saves ${esc(p.name)}">${teams.map(t => `<option value="${esc(t.name)}"${t.name === def ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select> <button type="button" class="btn-save" data-psave="${esc(p.id)}">Save</button></span>`;
}

function runPrototype() {
  const body = $('protoBody');
  if (!body) return;
  syncOfferNote();
  const pos = $('p-pos').value;
  const dirKey = $('p-dir').value;
  if (dirKey === 'all' && !UNIVERSE) {
    body.innerHTML = '<div class="card"><p class="empty">Loading the full list…</p></div>';
    ensureUniverse().then(() => runPrototype());
    return;
  }
  const pool = protoPool().filter(p => (p.screen_position || p.position) === pos);
  const bf = {
    htMin: heightInches($('p-ht-min').value), htMax: heightInches($('p-ht-max').value),
    wtMin: numOrNull($('p-wt-min').value), wtMax: numOrNull($('p-wt-max').value),
    build: $('p-build').value
  };
  const bMin = numOrNull($('p-bench-min').value), bMax = numOrNull($('p-bench-max').value);
  const nilMax = numOrNull($('p-nil-max').value), nilBasis = $('p-nil-basis').value;
  const eligOnly = $('p-elig').checked;
  const offerSel = new Set();
  if ($('p-offer-nil').checked) offerSel.add('NIL');
  if ($('p-offer-sch').checked) offerSel.add('Scholarship only');
  if ($('p-offer-wo').checked) offerSel.add('Walk-on');
  const rows = pool.filter(p => {
    if (!protoBuildTest(p, bf, pool, dirKey + ':' + pos)) return false;
    if (mapSel.size && !mapSel.has(mapKeyOf(p))) return false;
    if (offerSel.size && !offerMatches(p, offerSel)) return false;
    if (protoArchSel.size && !(protoArchAll ? holdsAllTags(p, protoArchSel) : holdsAnyTag(p, protoArchSel))) return false;
    if (!passesTraits(p)) return false;
    const bench = protoBench(p);
    if (bMin != null && (bench == null || bench < bMin)) return false;
    if (bMax != null && (bench == null || bench > bMax)) return false;
    if (nilMax != null) {
      if (p.nil_status !== 'priced') return false;
      const v = nilBasis === 'ceiling' ? p.nil_ceiling : (p.nil_floor + p.nil_ceiling) / 2;
      if (v == null || v > nilMax) return false;
    }
    if (eligOnly && p.elig_qualified !== 'Eligible') return false;
    return true;
  });
  rows.sort((a, b) => {
    const x = protoBench(a), y = protoBench(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    return y - x || a.name.localeCompare(b.name);
  });
  const uniN = dirKey === 'all' ? rows.filter(p => p.universe).length : 0;
  $('protoCount').textContent = `${rows.length} of ${pool.length} ${pos} players match${dirKey === 'all' ? ` — ${uniN} of the matches are standard records, ranked on their headline grade only` : ''}`;
  body.innerHTML = rows.length ? `<div class="card table-card"><div class="tbl-scroll"><table class="ctable"><thead><tr><th>Player</th><th>Pos</th><th>School</th><th>Book</th><th class="num">Benchmark</th><th>Size</th><th>Hometown</th><th>Est. NIL band</th><th>Save to a class</th></tr></thead><tbody>
    ${rows.map(p => p.universe ? `<tr>
      <td><a href="#/player/${esc(encodeURIComponent(p.id))}"><span class="pname">${esc(p.name)}</span></a><span class="uni-badge">Standard record</span></td>
      <td>${esc(p.position)}</td><td>${esc(p.school)}</td><td>Standard record — ${esc(p.level)}</td>
      <td class="num"><b>${f1(p.grade)}</b> <span class="p-sub">headline grade</span></td>
      <td>—</td>
      <td>—</td>
      <td>—</td>
      <td><span class="p-sub">Not evaluated</span></td></tr>` : `<tr>
      <td>${prospectStar(p)}<a href="#/player/${esc(encodeURIComponent(p.id))}"><span class="pname">${esc(p.name)}</span></a>${tagBadges(p.id)}${flashBadges(p.id)}</td>
      <td>${esc(p.position)}</td><td>${esc(p.school)}</td><td>${esc(p.conference_book)}${p.direction === 'down' ? ' · P4 Down' : ''}</td>
      <td class="num"><b>${protoBench(p) == null ? '—' : f1(protoBench(p))}</b></td>
      <td>${esc(p.height || '—')} · ${p.weight == null ? '—' : esc(p.weight) + ' lb'}</td>
      <td>${esc(hometownLine(p) || 'Not on record')}</td>
      <td>${nilRange(p) || 'no estimate'}</td>
      <td>${protoSaveCell(p)}</td></tr>`).join('')}
    </tbody></table></div></div>`
    : `<div class="card"><p class="empty">No players match that prototype — loosen an input or reset.</p></div>`;
}

function route() {
  closeTopMenus();
  markActiveNav();
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
    if (!UNIVERSE && ps.length < ids.length) {
      // a standard record's compare link, followed before the
      // universe has loaded: load it, then route again
      showView('compare');
      $('compareBody').innerHTML = '<div class="card empty">Loading the full list…</div>';
      ensureUniverse().then(() => route());
      return;
    }
  }
  const m = hash.match(/^#\/player\/(.+)$/);
  if (m) {
    const p = byIdAll[decodeURIComponent(m[1])];
    if (p && p.universe) {
      setChrome(null);
      const chip = $('dirChip');
      chip.hidden = false;
      chip.textContent = 'Standard record';
      if (UNIVERSE_META) $('totalChip').textContent = `${fmtN(UNIVERSE_META.total_listed)} listed`;
      showView('player');
      $('playerBody').innerHTML = renderUniversePlayer(p);
      document.title = `${p.name} — Player Books`;
      window.scrollTo(0, 0);
      return;
    }
    if (!p && !UNIVERSE && decodeURIComponent(m[1]).charAt(0) === 'u') {
      // a standard record's deep link, followed before the universe
      // has loaded: load it, then route again
      showView('player');
      $('playerBody').innerHTML = '<div class="card empty">Loading the full list…</div>';
      ensureUniverse().then(() => route());
      return;
    }
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
  if (hash === '#/changes') {
    setChrome(null);
    showView('changes');
    $('changesBody').innerHTML = renderChanges();
    document.title = 'What changed — Player Books';
    window.scrollTo(0, 0);
    return;
  }
  if (hash === '#/value') {
    setChrome(null);
    showView('value');
    renderValue();
    document.title = 'Value Board — Player Books';
    window.scrollTo(0, 0);
    return;
  }
  if (hash === '#/prospects') {
    setChrome(null);
    showView('prospects');
    renderProspects();
    document.title = 'Prospect List — Player Books';
    window.scrollTo(0, 0);
    return;
  }
  if (hash === '#/map') {
    setChrome(null);
    showView('map');
    renderMap();
    document.title = 'Map — players by home state — Player Books';
    window.scrollTo(0, 0);
    return;
  }
  if (hash === '#/prototype') {
    setChrome(null);
    showView('prototype');
    buildProtoPanels();
    runPrototype();
    document.title = 'Prototype search — Player Books';
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
  if (hash === '#/universe') {
    setChrome(null);
    const chip = $('dirChip');
    chip.hidden = false;
    chip.textContent = 'Every player — standard records';
    if (UNIVERSE_META) $('totalChip').textContent = `${fmtN(UNIVERSE_META.total_listed)} listed`;
    showView('universe');
    renderUniverseView();
    document.title = 'Every player — Player Books';
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
  // championship.json degrades to no championship data, never an error.
  // The payload ships in two parts (championship.json + championship_b.json,
  // split by split_championship.py to stay under the host's file-size wall);
  // the teams lists merge by team name, later part winning, so the page sees
  // one dataset. A missing second part degrades to part one alone.
  const get = url => fetch(url)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  return Promise.all([get('championship.json'), get('championship_b.json')])
    .then(([a, b]) => {
      if (!a || Array.isArray(a) || !Array.isArray(a.teams) || !a.meta) return null;
      if (b && Array.isArray(b.teams)) {
        const byName = new Map();
        for (const t of a.teams) byName.set(t.name, t);
        for (const t of b.teams) byName.set(t.name, t);
        a.teams = [...byName.values()];
      }
      return a;
    })
    .catch(() => null);
}

function loadTraits() {
  // same failure-tolerant pattern: a missing or malformed traits.json
  // degrades to no trait layer, never an error. The file is the
  // build_traits.py output: a "_registry" object plus one entry list
  // per player id.
  return fetch('traits.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j) && j._registry) ? j : null)
    .catch(() => null);
}

function loadFlashes() {
  // same failure-tolerant pattern: a missing or malformed flashes.json
  // degrades to no flash layer, never an error. The file is the
  // build_flashes.py output: a "_registry" object plus one entry list
  // per player id, in traits.json's shape family.
  return fetch('flashes.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j) && j._registry) ? j : null)
    .catch(() => null);
}

function loadOptimal() {
  // same failure-tolerant pattern: a missing optimal_size.json
  // degrades to no Optimal-size button data, never an error.
  return fetch('optimal_size.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j)) ? j : null)
    .catch(() => null);
}

function loadTeamBrands() {
  // same failure-tolerant pattern: a missing team_brands.json degrades
  // to no team skin colours (the neutral site is unaffected), never an
  // error. Shape: {team name: {logo, color, accent}}.
  return fetch('team_brands.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j)) ? j : null)
    .catch(() => null);
}

function loadUniverseMeta() {
  // same failure-tolerant pattern: a missing universe_meta.json
  // degrades to core-only counts, never an error. The universe data
  // files themselves load lazily via ensureUniverse().
  return fetch('universe_meta.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j) && typeof j.total_listed === 'number') ? j : null)
    .catch(() => null);
}

function loadChanges() {
  // same failure-tolerant pattern: a missing or malformed changes.json
  // degrades to no changes posted, never an error. The file is a plain
  // {"weeks": [{"week": "...", "entries": ["...", ...]}, ...]} log,
  // newest week first — the Tuesday screen run prepends a week object.
  return fetch('changes.json')
    .then(r => (r.ok ? r.json() : null))
    .then(j => (j && !Array.isArray(j) && Array.isArray(j.weeks)) ? j : null)
    .catch(() => null);
}

function loadPlayers(file) {
  // Player payloads ship in two parts (<file> + <name>_b.json, split by
  // split_players.py to stay under the host's file-size wall); the lists
  // concatenate in file order to reproduce the dataset exactly. A missing
  // second part degrades to part one alone (same pattern as loadChamp).
  const get = url => fetch(url)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null);
  return Promise.all([get(file), get(file.replace(/\.json$/, '_b.json'))])
    .then(([a, b]) => (Array.isArray(a) && Array.isArray(b)) ? a.concat(b) : a);
}
Promise.all([loadPlayers('players.json'), loadPlayers('players_down.json'), loadComparison(), loadTeams(), loadChamp(), loadChanges(), loadTraits(), loadFlashes(), loadOptimal(), loadTeamBrands(), loadUniverseMeta()]).then(([up, down, cmp, teams, champ, changes, traits, flashes, optimal, brands, umeta]) => {
  CMP = cmp;
  TEAMS = teams;
  CHAMP = champ;
  CHANGES = changes;
  TRAIT_REG = (traits && traits._registry) || {};
  TRAITS_BY_ID = {};
  if (traits) for (const id of Object.keys(traits)) {
    if (id !== '_registry' && Array.isArray(traits[id])) TRAITS_BY_ID[id] = traits[id];
  }
  FLASH_REG = (flashes && flashes._registry) || {};
  FLASHES_BY_ID = {};
  if (flashes) for (const id of Object.keys(flashes)) {
    if (id !== '_registry' && Array.isArray(flashes[id])) FLASHES_BY_ID[id] = flashes[id];
  }
  OPTIMAL_SIZE = optimal || {};
  TEAM_BRANDS = brands || {};
  UNIVERSE_META = umeta;
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
  applyTeamSkin();
  loadProspects();
  updateProspectLink();
  UP = (Array.isArray(up) ? up : []).map(p => ({ ...p, direction: p.direction || 'up' }));
  DOWN = (Array.isArray(down) ? down : []).map(p => ({ ...p, direction: p.direction || 'down' }));
  UP.forEach(p => { byIdAll[p.id] = p; });
  DOWN.forEach(p => { if (!byIdAll[p.id]) byIdAll[p.id] = p; });
  $('statPlayers').textContent = fmtN(UP.length + DOWN.length);
  if (UNIVERSE_META) {
    // the reveal: the full universe, stated once — the evaluated core
    // and the standard records as separate honest numbers
    $('revealTotal').textContent = fmtN(UNIVERSE_META.total_listed);
    $('revealSub').textContent = `players listed. ${fmtN(UNIVERSE_META.core_evaluated)} carry the full evaluation — band, fits, The Call. The other ${fmtN(UNIVERSE_META.universe)} are standard records: name, school, 2026 grade and snaps. Nothing more is claimed for them.`;
  }
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
  $('f-blend').addEventListener('change', applyFilters);
  // universe directory: filters re-render the window; headers sort
  ['uq', 'ulevel', 'uconf', 'upos', 'ugrade'].forEach(id => {
    const n = $(id);
    if (!n) return;
    n.addEventListener('input', () => renderUniverseRows(true));
    n.addEventListener('change', () => renderUniverseRows(true));
  });
  document.querySelectorAll('#unitable th[data-usort]').forEach(th =>
    th.addEventListener('click', () => {
      const k = th.dataset.usort;
      if (uniSortKey === k) uniSortDir = -uniSortDir;
      else { uniSortKey = k; uniSortDir = (k === 'grade' || k === 'volume') ? -1 : 1; }
      renderUniverseRows(true);
    }));
  // archetype AND-mode + build filters: plain controls over applyFilters
  $('f-arch-all').addEventListener('change', e => { archModeAll = e.target.checked; applyFilters(); });
  ['b-ht-min', 'b-ht-max', 'b-wt-min', 'b-wt-max', 'b-build'].forEach(id => {
    $(id).addEventListener('input', applyFilters);
    $(id).addEventListener('change', applyFilters);
  });
  FILTER_DEFS.forEach(def => {
    const w = msWrap(def.id);
    $(def.id).addEventListener('click', () => toggleMs(def.id));
    w.querySelector('.ms-opts').addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      if (cb.checked) filterSel[def.id].add(cb.value); else filterSel[def.id].delete(cb.value);
      updateMsButton(def);
      if (def.id === 'f-pos') refreshArchFilter();
      applyFilters();
    });
    w.querySelector('.ms-clear').addEventListener('click', () => {
      clearFilter(def.id);
      if (def.id === 'f-pos') refreshArchFilter();
      applyFilters();
    });
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
  // championship path archetype cut: the directory's tag set, applied to
  // the getable and available lists (the panel lives in the static
  // controls card, so it survives renderChamp's rebuild of champBody)
  buildChampArchPanel();
  $('c-arch').addEventListener('click', () => toggleMs('c-arch'));
  $('champArchOpts').addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    if (cb.checked) champArchSel.add(cb.value); else champArchSel.delete(cb.value);
    champArchBtnLabel();
    champRestoreScroll = window.scrollY;
    renderChamp();
  });
  $('c-arch-all').addEventListener('change', e => {
    champArchModeAll = e.target.checked;
    champRestoreScroll = window.scrollY;
    renderChamp();
  });
  $('champArchClear').addEventListener('click', () => {
    champArchSel.clear();
    champArchModeAll = false;
    $('c-arch-all').checked = false;
    buildChampArchPanel();
    champRestoreScroll = window.scrollY;
    renderChamp();
  });
  // Value Board: lens switch + position multi-select (the directory's
  // panel machinery under its own ids, bound like the champ panel)
  buildValuePosPanel();
  $('v-pos').addEventListener('click', () => toggleMs('v-pos'));
  $('valuePosOpts').addEventListener('change', e => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    if (cb.checked) valuePosSel.add(cb.value); else valuePosSel.delete(cb.value);
    valuePosBtnLabel();
    renderValue();
  });
  $('valuePosClear').addEventListener('click', () => {
    valuePosSel.clear();
    buildValuePosPanel();
    renderValue();
  });
  $('valueSteadyBtn').addEventListener('click', () => { valueLens = 'steady'; renderValue(); });
  $('valueCeilingBtn').addEventListener('click', () => { valueLens = 'ceiling'; renderValue(); });
  $('playerBody').addEventListener('click', e => {
    const pr = e.target.closest('[data-prospect]');
    if (pr) { toggleProspect(pr.dataset.prospect); return; }
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
  $('prospectBody').addEventListener('click', e => {
    const un = e.target.closest('[data-unprospect]');
    if (un) { toggleProspect(un.dataset.unprospect); renderProspects(); return; }
    if (e.target.closest('[data-clearprospects]')) {
      PROSPECTS = []; saveProspects(); syncProspectStars(); updateProspectLink(); renderProspects(); return;
    }
    if (e.target.closest('[data-printprospects]')) {
      document.body.classList.add('print-prospects');
      const donePp = () => { document.body.classList.remove('print-prospects'); window.removeEventListener('afterprint', donePp); };
      window.addEventListener('afterprint', donePp);
      setTimeout(donePp, 2000);
      try { window.print(); } catch (err) {}
    }
  });
  $('champBody').addEventListener('click', e => {
    const bo = e.target.closest('[data-budgetopen]');
    if (bo) { openBudgetClass(parseInt(bo.dataset.budgetopen, 10)); return; }
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
    if (e.target.closest('[data-copyimg]')) { copyClassImage(); return; }
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
  $('mapBody').addEventListener('click', e => {
    if (e.target.closest('[data-mapclear]')) { mapSel.clear(); renderMap(); return; }
    const k = e.target.closest('[data-mapkey]');
    if (k) {
      const key = k.dataset.mapkey;
      if (mapSel.has(key)) mapSel.delete(key); else mapSel.add(key);
      renderMap();
    }
  });
  $('mapBody').addEventListener('change', e => {
    const cb = e.target.closest('[data-mapcheck]');
    if (cb) {
      if (cb.checked) mapSel.add(cb.dataset.mapcheck);
      else mapSel.delete(cb.dataset.mapcheck);
      renderMap();
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMs(); });
  $('reset').addEventListener('click', () => {
    $('q').value = ''; clearAllFilters();
    $('f-hv').checked = false; $('f-ulm').checked = false; $('f-myteam').checked = false; $('f-blend').value = ''; applyFilters();
  });
  // the filter ribbon: tabs open one panel at a time; the active tab
  // or the chevron collapses back to the strip; Clear all in the
  // strip resets every control across all tabs (the same reset as
  // the Search panel's button).
  document.querySelectorAll('.ribbon-tab').forEach(b => b.addEventListener('click', () => {
    setRibbonTab(ribbonTab === b.dataset.rtab ? null : b.dataset.rtab);
  }));
  $('ribbonChev').addEventListener('click', () => setRibbonTab(null));
  $('ribbonClear').addEventListener('click', () => {
    $('q').value = ''; clearAllFilters();
    $('f-hv').checked = false; $('f-ulm').checked = false; $('f-myteam').checked = false; $('f-blend').value = ''; applyFilters();
  });
  $('geoPanel').addEventListener('change', e => {
    const cb = e.target.closest('[data-geocheck]');
    if (!cb) return;
    if (cb.checked) dirGeoSel.add(cb.dataset.geocheck); else dirGeoSel.delete(cb.dataset.geocheck);
    syncGeoUI();
    applyFilters();
  });
  // the Hometown tab's mini-map: clicking a state (or the Canada /
  // International / not-on-record blocks) toggles the same selection
  // the list's tick boxes drive — one selection, two views.
  $('geoMap').addEventListener('click', e => {
    const k = e.target.closest('[data-geokey]');
    if (!k) return;
    const key = k.dataset.geokey;
    if (dirGeoSel.has(key)) dirGeoSel.delete(key); else dirGeoSel.add(key);
    syncGeoUI();
    applyFilters();
  });
  // "Done" — the selection is already applied (filtering is live);
  // Done is the close affordance: the ribbon collapses to the strip,
  // which shows the Hometown group active with the places count.
  $('geoDone').addEventListener('click', () => setRibbonTab(null));
  // prototype search controls
  ['p-dir', 'p-build', 'p-nil-basis'].forEach(id => $(id).addEventListener('change', runPrototype));
  $('p-pos').addEventListener('change', () => { buildProtoTraits(); runPrototype(); });
  ['p-ht-min', 'p-ht-max', 'p-wt-min', 'p-wt-max', 'p-bench-min', 'p-bench-max', 'p-nil-max'].forEach(id => $(id).addEventListener('input', runPrototype));
  $('p-elig').addEventListener('change', runPrototype);
  ['p-offer-nil', 'p-offer-sch', 'p-offer-wo'].forEach(id => $(id).addEventListener('change', runPrototype));
  $('p-arch-all').addEventListener('change', e => { protoArchAll = e.target.checked; runPrototype(); });
  $('p-lean').addEventListener('change', e => { valueLean = e.target.checked; runPrototype(); });
  $('p-flash').addEventListener('change', e => { traitFlash = e.target.checked; runPrototype(); });
  $('protoGeo').addEventListener('change', e => {
    const cb = e.target.closest('[data-protogeo]');
    if (!cb) return;
    if (cb.checked) mapSel.add(cb.dataset.protogeo); else mapSel.delete(cb.dataset.protogeo);
    runPrototype();
  });
  $('protoArch').addEventListener('change', e => {
    const cb = e.target.closest('[data-protoarch]');
    if (!cb) return;
    if (cb.checked) protoArchSel.add(cb.dataset.protoarch); else protoArchSel.delete(cb.dataset.protoarch);
    runPrototype();
  });
  $('protoTraits').addEventListener('input', e => {
    const inp = e.target.closest('[data-prototrait]');
    if (!inp) return;
    const v = parseFloat(inp.value);
    if (inp.value.trim() === '' || !Number.isFinite(v)) delete traitBars[inp.dataset.prototrait];
    else traitBars[inp.dataset.prototrait] = v;
    runPrototype();
  });
  $('p-optimal').addEventListener('click', () => {
    const pos = $('p-pos').value;
    const band = OPTIMAL_SIZE[pos];
    const note = $('p-optimal-note');
    if (!band) { if (note) note.textContent = 'No optimal band computed for this position.'; return; }
    $('p-ht-min').value = band.ht_min_label; $('p-ht-max').value = band.ht_max_label;
    $('p-wt-min').value = band.wt_min; $('p-wt-max').value = band.wt_max;
    if (note) note.textContent = `Optimal for ${pos}: ${band.ht_min_label}–${band.ht_max_label}, ${band.wt_min}–${band.wt_max} lb — from ${band.n} players (${band.basis}).`;
    runPrototype();
  });
  $('p-regional').addEventListener('click', () => {
    const mt = myTeamObj();
    if (!mt || !mt.state) return;
    mapSel = new Set([mt.state, ...(STATE_ADJ[mt.state] || [])]);
    buildProtoPanels();
    runPrototype();
  });
  $('p-reset').addEventListener('click', () => {
    $('p-dir').value = 'both';
    ['p-ht-min', 'p-ht-max', 'p-wt-min', 'p-wt-max', 'p-bench-min', 'p-bench-max', 'p-nil-max'].forEach(id => { $(id).value = ''; });
    $('p-build').value = 'any';
    $('p-elig').checked = false;
    ['p-offer-nil', 'p-offer-sch', 'p-offer-wo'].forEach(id => { $(id).checked = false; });
    protoArchSel.clear(); protoArchAll = false; $('p-arch-all').checked = false;
    mapSel.clear();
    traitBars = {}; valueLean = false; traitFlash = false;
    $('p-lean').checked = false; $('p-flash').checked = false;
    const note = $('p-optimal-note'); if (note) note.textContent = '';
    buildProtoPanels();
    runPrototype();
  });
  $('protoBody').addEventListener('click', e => {
    const star = e.target.closest('[data-prospect]');
    if (star) { toggleProspect(star.dataset.prospect); return; }
    const sv = e.target.closest('[data-psave]');
    if (sv) {
      const sel = document.querySelector(`[data-psave-sel="${sv.dataset.psave}"]`);
      const team = sel ? sel.value : null;
      if (team && savePlayerToTeam(sv.dataset.psave, team)) {
        sv.textContent = `Saved in ${team}’s class ✓`;
        sv.disabled = true;
      }
    }
  });
  document.querySelectorAll('th[data-sort]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
    applyFilters();
  }));
  $('dirBody').addEventListener('click', e => {
    const star = e.target.closest('[data-prospect]');
    if (star) { toggleProspect(star.dataset.prospect); return; }
    if (e.target.closest('.cmp-cell')) return;
    const tr = e.target.closest('tr[data-id]');
    if (tr) location.hash = '#/player/' + encodeURIComponent(tr.dataset.id);
  });
  const onCmpChange = e => {
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
  };
  $('dirBody').addEventListener('change', onCmpChange);
  $('uniBody').addEventListener('change', onCmpChange);
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
$('myTeamClear').addEventListener('click', () => setMyTeam(''));
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
/* top-level menus: click a button to open, click it again, click
   outside, press Escape or choose an item to close */
document.querySelectorAll('.tmenu-btn').forEach(b =>
  b.addEventListener('click', () => toggleTopMenu(b)));
document.querySelectorAll('.tmenu-item').forEach(a =>
  a.addEventListener('click', closeTopMenus));
document.addEventListener('click', e => { if (!e.target.closest('.tmenu')) closeTopMenus(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.tmenu-panel:not([hidden])');
  if (!open) return;
  closeTopMenus();
  open.parentElement.querySelector('.tmenu-btn').focus();
});
window.addEventListener('hashchange', route);
