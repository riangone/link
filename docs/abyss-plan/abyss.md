# Abyssal Front — design & architecture (client/abyss/)

`abyss` is the **deep-sea** sibling of `frontline` (Steel Shadow: Frontline). It keeps
the entire proven frontline skeleton — host-authoritative simulation, WebRTC rooms,
GameBot wiring, loadout chips, minimap fog — and swaps the *world layer*: no modern
war, no tanks, no shells. Pressure hulls, bioluminescent sonar, leviathans, and a
sentient trench.

Japanese title is **深淵ライズ** with "rise"; if you prefer the literal "front" reading,
swap it for **深淵フロント**.

Product name: **Abyssal Front / 深渊升潮 / 深淵ライズ / 심연 상승**.

---

## 1. What is reused verbatim (the skeleton)

These modules are *not* re-implemented; abyss imports them exactly like frontline:

| Concern | Module | Contract used by abyss |
|---|---|---|
| P2P room + RTT + data channel | `client/scripts/game-session.js` | `GameSession({gameFolder, dataChannelOptions, onRole, onMessage, …})`, `send()` |
| vs-computer plumbing | `client/scripts/game-bot.js` | `GameBot.session`, `GameBot.pick`, `GameBot.expose`, `GameBot.t` |
| Room discovery in lobby | `server/matchmaker.js` | `GAMES` allow-list must contain `'abyss'` |
| Lobby card | `client/play/index.html` | `GAMES` card entry + `S[lang]` title |
| Test harness | `tests/e2e/dev-server.js` | static client + real signaling on one port |

**Rule:** every game message is JSON over an *unordered, lossy* data channel.
Nothing may depend on ordering: positions are absolute snapshots, gadgets are
edge-triggered by monotonic sequence numbers (`pressed()` guard), events carry ids.

## 2. Theme — why deep sea

Frontline's identity is **vision**: forests hide, firing reveals, ambush multiplies
damage. The natural reskin without "modern war" is **the darkness of the deep ocean**:
there is no horizon, so *everything you know about the enemy comes from active sonar*,
and active sonar gives you away. Every frontline mechanic has an underwater twin, so
the design transfers 1:1 without rewriting the simulation contract.

## 3. Mechanic map (frontline → abyss)

| Frontline | Abyss | Implementation note |
|---|---|---|
| Tank hull `TANK_R`, `blockedTank` | Pressure hull, coral pillars & basalt rocks | same circle/rect collision, `depression` field added |
| Forest hides a still tank | **Kelp beds** hide a silent hull | same `inForest()` rule, renamed |
| Smoke blocks LOS | **Thermal vents / vapor plumes** | same `smokes[]` + `inSmoke()` |
| Sight radius | **Sonar radius**; fires an active ping | ping *reveals you* for `PING_REVEAL` ms — new |
| Muzzle flash reveals shooter | Bioluminescent discharge glow | same `reveal` timer |
| Drone (Q) | **Echo drone** (visits point, hovers, illuminates with light) | same structure, `R = 300` |
| Attack drone (R) | **Vampire eel swarm** = Hunter drone | same; bio-torpedoes |
| Satellite scan (E) | **Sonar pulse scan**: delayed, pings enemy position only | same delay + window |
| EMP (Z) | **Abyssal flare**: blind + lockout | same |
| Mine (F) | **Siphon mine** | same `mineVisible`, arming |
| Supply crates + outposts | **Leviathan dens** that spawn supply + reveal nearby | same capture ring, plus `pop` field |
| Rear-sector crit / ricochet | **Hollow rear vents** crit ×1.75 / **Bio-armor deflect** | same angle math |
| Ambush ×1.6 | Silent strike ×1.6 (fired while unseen) | same |
| Kill 3 → win | Flood the den: 3 sinkings | same |
| Map sizes normal/large/huge | **Shallows / Trench / Hadal Abyss** with kelp, rocks, vents, dens | same `MAP_SPECS` shape, new tuning |

Deeper identity mechanics actually shipped:

- **Dive depth bands** (host-owned): `Sunlit layer / Thermocline / Midnight zone /
  Hadal zone` scale *both* hulls — wider sonar vs. shorter torpedo reach, and in the
  hadal dark crits hit harder. Changes the match's feel without a new system.
- **Active fire exposes you**: firing sets `reveal`; the exposure is scaled by gear
  (lookout / vent reclaimer) *and* the depth band. Silence is the core resource.
- **Silent strike is decided by the victim's ears**: `amb = !visibleTo(S, 1 - i, shooter)`.
  Ambushing from kelp gives ×1.6; firing in the open does **not** (you were seen).
- **Listening-post dens**: a held den reveals anything within 360px — capturing one is a
  vision upgrade, not just supplies.
- Leviathan dens pay supply pods on a 24s cycle while held at ≥80%.

Deferred (not in this build): O₂/pressure as a per-hull resource, lamp toggle, den-reared
NPC leviathans, sea-current drift.

## 4. Module layout

```
client/abyss/
  index.html     screens: lobby / ready / gameover / disconnect  (same as frontline)
  style.css      abyss palette (#04121a water, #6be3d8 sonar cyan, #c8a2ff psi violet)
  i18n.js        strings zh/en/ja/ko, exposes window.AbyssI18n {L, apply, setLang, S, lang}
  game.js        everything else (single IIFE, no build step — the project rule)
```

`game.js` section order mirrors frontline exactly:

1. tuning & map specs  2. loadout tables (`CLASSES`, `WEAPONS`, `GEARS`, `DEPTH`) +
   `statsOf()` + `stOf()` cache  3. mines/crates/items tables  4. DOM refs
  5. map generation (point-symmetric about `(W/2,H/2)`)  6. geometry & LOS
  7. sim state (`S` host-only, `net` client)  8. bot  9. input  10. network
  11. screens & loadout picker  12. audio (WebAudio tones, no assets)  13. effects
  14. exploration  15. rendering  16. test hooks.

### Key state shapes (debuggable via `window.__bot`)

```js
S = {
  seed, size, T,                 // T is host-sim ms — never wall clock
  ph: 'play'|'over', sc:[int,int], win, winReason,
  tanks: [ {x,y,a,ta,hp,maxHp,cd,alive,respawnAt,cls,w,g,depression,
            reveal, still, o2, lamp, qs,as,es,ms,zs,xs, mines, ...} ],
  shots: [ {x,y,vx,vy,o,life,amb,dmg,sp,w} ],
  drones:[...], hunters:[...], dens:[...], smokes:[...], mines:[...],
  items:[...], ev:[ {id,t,k,...} ]   // event log, last 24, monotonic id
}
```

### Invariants (do not break)

- The **host** is the only writer of `S`. Clients *send `{type:'input'}` and render `net`*.
- `D()` = `S` on host, latest snapshot on client; all rendering reads `D()`.
- Any timer compared against `S.T` (host-sim time), never `Date.now()`.
- Vision decisions happen **on the host**: clients never learn about an invisible enemy
  except through `visibleTo()` on the *observer's* team (`net` includes all tanks, the
  renderer hides unseen ones — same as frontline).
- Randomness: `rng(seed)` for maps; `Math.random()` only for cosmetic/pod kind.
- **Local side index**: mapgen puts spawn 0 top-left and spawn 1 bottom-right; the
  client's default `myIdx` is **1** and must only change when the session reports the
  host role. Rendering must be correct before the first snapshot arrives.
- **Pause**: the host sim does not step while a screen (gameover/disconnect) is up, and
  the step loop is capped (~10 steps/frame) so a stalled tab cannot burst-simulate.
- **Debug hooks** (`window.__bot`): `state()` is the authoritative host `S`;
  `net()` is the per-frame serialised snapshot the renderer draws (in bot mode,
  `syncBotSnapshot()` refreshes it once per sim frame). Use `state()` in tests.

### Bugs caught by the E2E suite during the build (regression material)

1. Fog canvas + map were referenced before creation → every frame threw (`T` stuck at 0).
2. `startMatch()` called `bot.reset()` before `const bot` existed (TDZ).
3. The vent key compared against `ventUntil`, which nothing ever set → the plume cool-down
   was effectively `ventAt` only.
4. Firing was *not* gated by the flare lockout (check used the wrong timer).
5. Client-side `setDepth()` mutated stats behind the host's back; the depth band is now
   host-owned and applied to live hulls (`applyDepthToState`).
6. `free()` / `clearPair()` test helpers returned spots deep inside kelp (failed almost
   silently) — now a fine-grained search that never lands in kelp or open geometry.

## 5. Integration checklist (done for this build)

- [x] `server/matchmaker.js` `GAMES` += `'abyss'`
- [x] `client/play/index.html` `GAMES` += `{ id:'abyss', e:'🌊', cat:'3d', tag:'tag_fight' }`
- [x] lobby `S[lang]` title key `abyss` for zh/ja/ko/en
- [x] `tests/e2e/abyss.spec.js`
- [ ] service worker pre-cache (game assets are network-first; not required)

## 6. Roadmap

1. **P0 (done, this build)** — playable: 4 hulls × 4 weapons × 5 gears, 4 depth bands,
   3 sea sizes, kelp stealth, active-fire exposure, echo drone / hunter eel swarm / sonar
   scan / flare / vent plume / siphon mines, supply pods, listening-post dens, bot + PvP.
   Verified by `tests/e2e/abyss.spec.js` (6 scenarios, 3× repeat, no skips).
2. **P1** — O₂ pressure resource; bioluminescent lamp toggle; den-reared leviathans that
   wander and must be driven off (persistent NPC threat instead of a static ring).
3. **P2** — sea-current field that drifts hulls (a positional hazard that changes every
   match); species-specific hull cosmetics; audio pass (hydrophone ambience).
4. **P3** — third player role: the **Warden** (controls a leviathan, hunts both players).

## 7. Verification commands

```bash
npx playwright test tests/e2e/abyss.spec.js --reporter=list --repeat-each=3
npm run test:server          # matchmaker accepts the new 'abyss' id
```

Screenshots from the suite land in `test-results/abyss-client.png`.
