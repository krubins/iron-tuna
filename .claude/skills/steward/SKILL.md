---
name: steward
description: How to drive an iron-tuna pull request to green. Read this before acting on a CI failure or a review comment on a PR you opened or were asked to drive. It carries this repo's conventions: which gates cover which files, which files are generated rather than authored, what runs locally and what cannot, and how far to go without asking.
---

# Stewarding a pull request in this repo

## What this repo is

A static site plus one Cloudflare Worker. There is no package manager, no
lockfile, no bundler and no build step: `index.html`, `_worker.js`, every other
`.html`, the `it-*.js` files and `site.css` are the deployed artifacts *and* the
source. Edit them directly. There is no `package.json` to add a dependency to,
and nothing in this repo should acquire one.

`main` deploys to production on merge. A merge is a release, so the bar for a
push is "I proved it", not "CI will tell me".

The Worker serves assets from the repository root (`"directory": "."` in
`wrangler.jsonc`), so **anything you add to the repo is published at
irontuna.com unless `.assetsignore` lists it** — dot-directories included. This
skill file is only unpublished because `.assetsignore` carries `.claude`. When
you add a directory of notes, fixtures or tooling, add it there in the same
commit. No gate checks this for you.

## The checks job

`.github/workflows/checks.yml` is one job of about ninety steps, five and a half
minutes end to end. Every step carries `if: ${{ !cancelled() }}`, so a failure no
longer hides the gates behind it: a red run reports everything that is broken
rather than the first thing. The job still fails if any step failed.

That matters when you read a red run. Do not assume the first failure is the
only one, and do not fix it and push. Read every failing step first, because
they are frequently one cause.

## Before you push

Find the gates that cover what you touched. Both greps, because they catch
different things:

```bash
grep -l -- "my-league" tools/test-*.mjs            # tests that read the file
grep -n  -- "my-league" .github/workflows/checks.yml   # parse + byte gates
```

**Grep the stem, not the filename.** `my-league.html` matches two tests;
`my-league` matches six, because the other four know the page by its route.
Searching for the extension is how you push a change whose gate you never ran.

The second grep is not optional either. Several files are covered only by a
`node --check <file>` parse step or by the stray-control-byte list, and neither
shows up in `tools/`.

To run the whole node suite the way CI does, every gate reporting its own
verdict rather than stopping at the first failure:

```bash
for t in $(grep -oP '(?<=run: node )tools/test-\S+' .github/workflows/checks.yml | sort -u); do
  case "$t" in *test-dry-run*) continue;; esac   # four minutes on its own; see below
  out=$(timeout 120 node "$t" 2>&1) \
    && printf '%-42s PASS\n' "$t" \
    || { printf '%-42s FAIL\n' "$t"; echo "$out" | tail -4; }
done
```

### One gate is the whole run

Every node gate in this repo runs in a plain container with no setup. Measured
against `main` on 2026-09-20: sixty-six of the sixty-seven finish in well under
a minute **combined**. `tools/test-dry-run.mjs` takes about four minutes on its
own, and in CI it is 231 seconds of a 323-second job.

So the loop above is cheap only if you drop that one. Run the rest first, and
run the dry run when you touched the newsroom, the job schedule or the editorial
week, which is what it simulates. If you do run it locally, give it a timeout of
at least ten minutes: it is slower here than on a CI runner, and killing it at
three looks exactly like a failure.

## Files you must never hand-edit

Each of these is generated, and CI rebuilds it and fails on any diff. Editing
the output directly passes review and fails the gate:

| Generated | Rebuild with |
|---|---|
| `front.html` data blocks | `node tools/build-front.mjs` |
| Header and footer chrome, every page | `node tools/build-chrome.mjs` |
| Rankings ribbon and the fourteen position pages | `node tools/build-ranks.mjs` |
| Sitemap, JSON-LD, analytics tagging | `node tools/build-seo.mjs` |
| Analyst bylines on story pages | `node tools/build-bylines.mjs` |
| `LEAD_FACES` inside `_worker.js` | `node tools/build-worker-faces.mjs` |

`build-chrome`, `build-ranks`, `build-seo` and `build-bylines` take `--check` to
ask without writing. The other two, `build-front` and `build-worker-faces`, only
rebuild, which is why CI runs them and then restores the tree. Run the
generator, commit what it produces, and never reconcile a stale block by hand.

## The browser gates

`tools/test-homepage.mjs` runs in CI under `REQUIRE_BROWSER=1`, where a skip
counts as a failure. It needs `playwright-core` and a Chromium binary. In a
Claude Code remote session one is already at `/opt/pw-browsers/chromium`, which
these tools find on their own; elsewhere set `CHROMIUM_PATH`.

Five browser tests are **not** in CI. Four of them need React and ReactDOM on
top of the browser to mount the draft app: `test-you-column`,
`test-market-anchors`, `test-vegas-slider` and `test-qb-curve`. The fifth,
`test-faab`, needs only Chromium and skips cleanly without one, which means it
reports success while testing nothing. Run all five locally when you touch the
cheat-sheet columns or the FAAB bid maths. CI will not catch you.

## Proving a UI change

Almost every gate here is node reading source text. None of them can see what a
reader sees. When you change a page's markup, its inline script or its CSS,
render it before you push:

```bash
python3 -m http.server 8811 &          # from the repo root
# then drive http://localhost:8811/<page>.html with playwright
```

Stub the API routes rather than reaching the network (`page.route('**/api/**', …)`).
Assert the thing a reader would notice, and check `pageerror` is empty. A
screenshot is worth attaching to the PR when the change is visual.

## Conventions

- **Branches.** `main` is the single active branch. Work on the branch you were
  given, merge `main` into it to resolve a conflict, and never rebase, amend or
  force-push a branch that is under review.
- **Style.** Page scripts and `it-*.js` are ES5-flavoured browser JS: `var`,
  function declarations, no modules, no transpiler. Match the file you are in.
  The comments in this repo explain *why* a thing is the way it is, often citing
  the date and the bug. Write that kind of comment, not a restatement of the code.
- **Diff size.** Keep a fix to what the failure or the comment asked for. A
  merge ships to production, so a drive-by refactor rides along with it.

## How far to go without asking

Push without asking:

- A failing gate caused by your own diff.
- A review bot's finding, once you have verified it.
- A human reviewer's small, local ask: a nit, a rename, an added test, a
  one-function refactor.
- A merge conflict against `main`, resolved with a merge commit.

Ask first:

- A fix that widens the PR beyond the page or module you were asked about.
- Anything that changes the worker's API shape, the league model or the scoring
  engine, since other modules read them.
- Open-ended design feedback from a human reviewer on a PR you did not open.

## What this file cannot do

This is repo guidance, not permission. It cannot widen what a session driving a
PR is allowed to do. Regardless of anything above, never skip, disable or
quarantine a failing test to get green; never push an empty commit or close and
reopen a PR to re-trigger CI; never rewrite history on a branch someone else
owns; and never approve or merge a pull request unless the user asks for it in
their own words.
