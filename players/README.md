# Player photos

The front page renders a photo slot for a few featured players. Each slot looks for:

    /players/<slug>.jpg

where `<slug>` is the player's name lowercased with every run of non-alphanumeric
characters turned into a single hyphen — the same transform as `slug()` in
`front.html`:

    Jahmyr Gibbs         -> /players/jahmyr-gibbs.jpg
    Christian McCaffrey  -> /players/christian-mccaffrey.jpg
    Ja'Marr Chase        -> /players/ja-marr-chase.jpg

Until a file exists the slot shows a position-tinted initials badge, which is a
deliberate design state rather than a broken image: the `<img>` removes itself on
error, leaving the badge. Drop a file in and it appears on the next load — no code
change, no rebuild.

**Which players?** Whoever the solver puts at the top of the optimal roster, which
changes when projections change. Check the current two with:

    node -e "console.log(require('./tools/front-analysis.json').lineup.sort((a,b)=>b.price-a.price).slice(0,2))"

**Format.** Square, at least 160x160 (they render at 74px, so 148px covers 2x
displays), face centred — the slot is a circle with `object-fit: cover`.

**Licensing.** These are published on a commercial site. Use images you have the
right to use: club or league media programmes with the appropriate licence, a stock
provider, your own photography, or a Creative Commons image whose terms you follow
(and attribute where the licence requires it). Do not hotlink or copy from ESPN,
NFL.com or a wire service without a licence.
