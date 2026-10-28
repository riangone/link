// Unit tests for client/armor/parts.js (custom tanks).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../../client/armor/parts.js');

test('default cfg builds to the stock core', () => {
    for (const c of P.CORE_IDS) {
        const b = P.build(P.defaultCfg(c));
        for (const k of ['hp', 'spd', 'r', 'rl', 'dmg', 'bs', 'turn', 'splash', 'len']) {
            assert.strictEqual(b[k], P.CORES[c][k], `${c}.${k}`);
        }
        assert.strictEqual(b.type, c);
        assert.strictEqual(b.cost, 0);
        assert.strictEqual(b.dcd, 120);
    }
});

test('build applies part modifiers and colours without mutating shared core', () => {
    const beforeHp = P.CORES.heavy.hp;
    const b = P.build({ core: 'heavy', gun: 'heavy', hull: 'plate', track: 'turbo', col: 4, name: 'REX' });
    assert.ok(b.dmg > P.CORES.heavy.dmg);
    assert.ok(b.hp > P.CORES.heavy.hp * 1.05);
    assert.strictEqual(b.col, P.COLORS[4]);
    assert.strictEqual(b.nick, 'REX');
    assert.strictEqual(b.cost, 6);
    assert.strictEqual(P.CORES.heavy.hp, beforeHp);
});

test('sanitize resets parts when over budget or invalid, keeping core', () => {
    const over = P.sanitize({ core: 'rapid', gun: 'twin', hull: 'fort', track: 'omni' }); // 3+3+3=9 > 6
    assert.strictEqual(over.ok, false);
    assert.deepStrictEqual([over.cfg.core, over.cfg.gun, over.cfg.hull, over.cfg.track], ['rapid', 'std', 'std', 'std']);
    const valid = P.sanitize({ core: 'sniper', gun: 'long', hull: 'light', track: 'dash' }); // 2+1+2=5 <= 6
    assert.strictEqual(valid.ok, true);
    assert.strictEqual(valid.cfg.gun, 'long');
});
