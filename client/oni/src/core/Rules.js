/**
 * Rules.js - Game Rules Strategy for Oni Remake
 * Decouples authentic Oni 2001 Adventure / Campaign rules from Arcade PvP Arena rules.
 */

export class GameRules {
    constructor(name = 'BASE') {
        this.name = name;
    }
    onInit(sim) {}
    onTick(sim) {}
    onFighterDown(sim, victim, attacker) {}
    onTimeout(sim) {}
}

export class OniRules extends GameRules {
    constructor() {
        super('ONI_CAMPAIGN');
    }

    onInit(sim) {
        sim.roundTimer = -1; // Unlimited time; no countdown pressure in campaign exploration
        sim.isMatchOver = false;
        sim.winner = null;
    }

    onTick(sim) {
        // Player (Konoko) HP check -> triggers checkpoint retry instead of arcade KO
        if (sim.f1 && sim.f1.hp <= 0 && !sim.isMatchOver) {
            sim.isMatchOver = true;
            sim.winner = 'DEFEAT';
            sim.events.push({
                type: 'PLAYER_DEAD',
                entityId: 'p1',
                checkpointId: sim.checkpointId || 'checkpoint_current'
            });
            return;
        }

        // Track hostile neutralizations
        const enemies = typeof sim.getEnemies === 'function' ? sim.getEnemies() : [sim.f2];
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (enemy && enemy.hp <= 0 && !enemy._emittedDown) {
                enemy._emittedDown = true;
                sim.events.push({
                    type: 'FIGHTER_DOWN',
                    entityId: enemy.id,
                    isBoss: !!enemy.isBoss
                });
            }
        }
    }

    onFighterDown(sim, victim, attacker) {
        if (victim && victim.id === 'p1') {
            sim.isMatchOver = true;
            sim.winner = 'DEFEAT';
            sim.events.push({
                type: 'PLAYER_DEAD',
                entityId: 'p1',
                checkpointId: sim.checkpointId || 'checkpoint_current'
            });
        }
    }

    onTimeout(sim) {
        // Authentic Oni rules: No arbitrary time limit defeat!
    }
}

export class ArenaRules extends GameRules {
    constructor(roundSeconds = 99) {
        super('ARENA');
        this.initialFrames = roundSeconds * 60;
    }

    onInit(sim) {
        sim.roundTimer = this.initialFrames;
        sim.isMatchOver = false;
        sim.winner = null;
    }

    onTick(sim) {
        if (sim.isMatchOver) return;

        if (sim.f1 && sim.f1.hp <= 0) {
            sim.declareWinner('p2');
            return;
        }

        const enemies = typeof sim.getEnemies === 'function' ? sim.getEnemies() : [sim.f2];
        if (enemies.length > 0 && enemies.every((e) => e && e.hp <= 0)) {
            sim.declareWinner('p1');
            return;
        }
    }

    onTimeout(sim) {
        if (sim.isMatchOver) return;
        sim.isMatchOver = true;
        if (sim.f1.hp > sim.f2.hp) {
            sim.declareWinner('p1');
        } else if (sim.f2.hp > sim.f1.hp) {
            sim.declareWinner('p2');
        } else {
            sim.winner = 'DRAW';
            sim.events.push({ type: 'TIMEOUT_DRAW' });
        }
    }
}
