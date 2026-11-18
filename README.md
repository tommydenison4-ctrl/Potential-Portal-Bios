# Potential Portal Bios

A searchable library of the player evaluations from the Player Book program —
766 players in two directions:

- **FCS — Moving Up** (`players.json`): 553 players from the nine Player Books
  (ULM, UTEP, CAA, Southland, MVFC, Big Sky, SoCon, NEC, OVC-Big South).
- **P4 — Moving Down** (`players_down.json`): 213 players from the
  P4 Down Player Book.

Live at **potential-portal-bios.vercel.app**. This repo is the deploy source —
Vercel redeploys automatically on every push to `main`.

## What the site does

- Directory with search and multi-select filters (book/conference, position,
  eligibility, Hidden Value, ULM qualifiers), plus a full page per player:
  bio, band, closest matches, The Call, fits with school logos, best/worst
  game and season, injury and transfer record, verified speed evidence, the
  qualified NCAA eligibility determination, and an estimated NIL projection
  (modelled from reported market bands — labelled on the page, never a
  reported deal).
- Compare up to three players side by side.
- Conference comparison (`#/compare-conferences`) and team comparison for all
  138 FBS teams (`#/team-comparison`, with print/CSV export).
- Championship path (`#/championship-path`, data in `championship.json`):
  pick a team and see the getable players who close each position room to
  the conference-best standard, with an estimated path cost.
- Print / Save PDF on player, compare and team-comparison pages.

Plain static files. No build step, no framework, no database. All pages carry
`noindex` — the site is open to anyone with the link; there is no password
gate. (A gate existed briefly and was removed on purpose; its files are kept
outside this repo.)

## Files

| File | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The site (hash-routed: `#/player/<id>`, `#/compare/...`, `#/team-comparison`, `#/compare-conferences`, `#/championship-path`) |
| `players.json` | The 553 Moving Up records |
| `players_down.json` | The 213 Moving Down records |
| `teams.json` | Team-comparison data, all 138 FBS teams × 10 position groups |
| `comparison.json` | Conference-comparison data |
| `championship.json` | Championship-path data (bars and getable players per team) |
| `headshots/` | 766 verified player headshots, one per player |
| `logos/` | 138 school logos used on fit rows |
| `vercel.json` | `noindex` header for every path |

## Updating the data

Replace the JSON files and add/replace images in `headshots/` (named to match
each record's headshot field), commit and push — Vercel redeploys on push.
The directory, filters and player pages are all driven by the JSON at load
time; no code changes are needed for a data refresh.
