// Unit tests for client/spin/parts.js (custom tops). Run: npm run test:unit
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../client/spin/parts.js');

test('default cfg builds to the stock core', () => {
    for (const c of P.CORE_IDS) {
        const b = P.build(P.defaultCfg(c));
        for (const k of ['r', 'mass', 'accel', 'vmax', 'drain', 'atk', 'def', 'bres', 'dash']) assert.strictEqual(b[k], P.CORES[c][k], `${c}.${k}`);
        assert.strictEqual(b.type, c);
        assert.strictEqual(b.cost, 0);
    }
});

test('build applies part modifiers and colours, without touching the shared core', () => {
    const before = P.CORES.attack.atk;
    const b = P.build({ core: 'attack', ring: 'spike', disk: 'heavy', tip: 'std', col: 2, name: 'Ace' });
    const ring = P.find('ring', 'spike'), disk = P.find('disk', 'heavy');
    assert.ok(Math.abs(b.atk - before * ring.mul.atk) < 1e-9);
    assert.ok(Math.abs(b.mass - P.CORES.attack.mass * disk.mul.mass) < 1e-9);
    assert.strictEqual(b.c1, P.COLORS[2][0]);
    assert.strictEqual(b.nick, 'Ace');
    assert.strictEqual(b.cost, 4);
    assert.strictEqual(P.CORES.attack.atk, before);
});

test('sanitize: unknown parts or over the energy cap → standard parts, core kept', () => {
    const over = P.sanitize({ core: 'defense', ring: 'fang', disk: 'rim', tip: 'jet' });   // 3+3+3
    assert.strictEqual(over.ok, false);
    assert.deepStrictEqual([over.cfg.core, over.cfg.ring, over.cfg.disk, over.cfg.tip], ['defense', 'std', 'std', 'std']);
    const bogus = P.sanitize({ core: 'stamina', ring: 'laser', disk: 'heavy' });
    assert.strictEqual(bogus.ok, false);
    assert.strictEqual(bogus.cfg.disk, 'std');
    const fine = P.sanitize({ core: 'balance', ring: 'fang', disk: 'heavy', tip: 'ball' });   // 3+2+1 = 6
    assert.strictEqual(fine.ok, true);
    assert.strictEqual(fine.cfg.ring, 'fang');
    // garbage in, defaults out — never throws
    for (const junk of [null, undefined, 42, 'x', [], { core: 'nope' }, { core: '__proto__', ring: {} }, { col: 99, name: 5 }]) {
        const r = P.sanitize(junk, 'attack');
        assert.ok(P.CORES[r.cfg.core]);
        assert.strictEqual(r.cfg.col, -1);
        assert.ok(P.build(junk).mass > 0);
    }
});

test('names are cosmetic and safe', () => {
    const c = P.sanitize({ core: 'attack', name: '<img src=x onerror=alert(1)>"\'&\u0000very long name' }).cfg;
    assert.ok(!/[<>&"'\u0000]/.test(c.name));
    assert.ok(c.name.length <= P.NAME_MAX);
});

test('every non-standard part has an upside and a downside; std is free', () => {
    for (const slot of P.SLOTS) {
        for (const p of P.PARTS[slot]) {
            if (p.id === 'std') { assert.strictEqual(p.cost, 0); assert.ok(!p.mul && !p.add); continue; }
            // "good" direction per stat: higher is better except drain
            const eff = Object.entries(p.mul || {}).map(([k, v]) => (k === 'drain' ? 1 / v : v));
            if (p.add && p.add.r) eff.push(1.01);           // bigger body = steadier
            assert.ok(eff.some((v) => v > 1), `${slot}:${p.id} has no upside`);
            assert.ok(eff.some((v) => v < 1), `${slot}:${p.id} has no downside`);
            assert.ok(p.cost >= 1 && p.cost <= 3, `${slot}:${p.id} cost`);
        }
    }
});

test('the energy cap allows a full 2+2+2 build but not three 3-cost parts', () => {
    const all = P.allCfgs('attack');
    assert.ok(all.every((c) => P.cost(c) <= P.CAP));
    assert.ok(all.some((c) => c.ring === 'spike' && c.disk === 'heavy' && c.tip === 'rubber'));
    assert.ok(!all.some((c) => c.ring === 'fang' && c.disk === 'rim' && c.tip === 'jet'));
});

test('unlocks: a fresh profile has std + every 1-cost part; nothing needs more than tower 6F', () => {
    for (const slot of P.SLOTS) {
        const free = P.PARTS[slot].filter((p) => P.unlocked(p, {}));
        assert.ok(free.some((p) => p.id === 'std'));
        assert.ok(free.some((p) => p.cost === 1), `${slot} has a starter part`);
        for (const p of P.PARTS[slot]) assert.ok(P.unlocked(p, { tw: 6 }), `${slot}:${p.id} reachable by 6F`);
    }
    assert.ok(P.unlocked(P.find('ring', 'spike'), { rp: 100 }));
    assert.ok(!P.unlocked(P.find('ring', 'spike'), { rp: 99, bursts: 2 }));
});

test('stat bars stay in range for every legal build', () => {
    for (const c of P.CORE_IDS) {
        for (const cfg of P.allCfgs(c)) {
            for (const v of P.bars(P.build(cfg))) assert.ok(v >= 0.3 && v <= 6);
        }
    }
});
