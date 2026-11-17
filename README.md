# Launch Radar — a token launch radar for make.fun

[![Competition](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/aelyraAI/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/aelyraAI/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01)

An entry in [token-radar-01](https://make.fun/bounty/token-radar-01) on make.fun: build the best token launch radar.

Launch Radar reads the sealed DefiLlama snapshot of the protocol universe and ranks every protocol that records no token yet by an implied value — what a token would be worth if the protocol's record stayed as it is — then hands a reader a dashboard: the ranked board, a detail view per protocol with its farm plan, the already-trading set the values are anchored to, and the model itself.

## The model

One function scores every protocol; no name is special-cased and every input is a figure the snapshot carries:

```
implied value = TVL × peer multiple × momentum × endurance
```

- **Peer multiple** — for the protocol's category, the median market-cap / TVL ratio of the snapshot's live-token protocols in that category (at least 4 peers, else the all-market median), clamped to 0.03×–1.5×. It is what the market itself pays for one TVL dollar of this kind of protocol.
- **Momentum** — 1 + clamp(7-day TVL change, −50%, +100%) × 0.35. An unreported change scores neutral.
- **Endurance** — 0.70 + 0.30 × min(age in days, 1460) / 1460; an unrecorded listing date scores 0.85. The longer a protocol has run at size with no token, the more of its record a launch price can stand on.

The board covers every protocol on the snapshot's watchlist and every other rankable pre-token protocol in the snapshot (198 rows on the dev snapshot). Wrapped, staked, bridged and versioned products of tokens that already trade, and exchanges, are never ranked; live-token protocols are set aside and used only as the yardstick. Each row carries a six-step farm plan derived from its category, first chain, TVL tier and age — every step states what it costs and how long it takes.

## Run it

Requires Node.js 22.18 or later; nothing is installed and there is no build step.

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

The program reads the snapshot (in the grading container it is mounted at `/input/snapshot.json`), validates the board against the gate's shape, and writes into the output directory: `board.json` (the ranked board), `data.js` (the dashboard's data), `dashboard/` (the static page: `index.html`, `app.css`, `app.js` — no network, open it from disk or any static server), `screenshots/` and `dossier.json` (written with `buildDossier` from `vendor/makefun-board.ts`).

## Layout

- `main.ts` — the entrypoint: snapshot in, board and dashboard out, dossier last.
- `lib/model.ts` — the value model, the board builder and the farm plans.
- `dashboard/` — the page the judge reads: board, detail, already-trading and model views.
- `screenshots/` — the board, a detail view and a filtered view, rendered from this dashboard on the dev snapshot.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored byte for byte.

Implied value is this entry's own claim, computed from the snapshot's figures. A protocol here *records* no token; that is DefiLlama's record, not proof that none exists. Nothing here is a price, a prediction that a token will be issued, or financial advice.

MIT licensed — see `LICENSE`.
