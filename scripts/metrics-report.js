#!/usr/bin/env node
/**
 * Print the decision metrics from server/data/metrics.json.
 * Usage: node scripts/metrics-report.js [days=7] [file]
 * See docs/analytics-events.md for what each number decides.
 */
const fs = require('fs');
const path = require('path');

const days = parseInt(process.argv[2] || '7', 10);
const file = process.argv[3] || path.join(__dirname, '..', 'server', 'data', 'metrics.json');
let data;
try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
    console.error(`No metrics yet (${file}): ${e.message}`);
    process.exit(1);
}

const selected = Object.keys(data.days || {}).sort().slice(-days);
const rows = [];
for (const day of selected) {
    for (const [key, n] of Object.entries(data.days[day])) rows.push({ parts: key.split('|'), n });
}
/** Sum counts of `ev` whose dimensions match; a null/undefined filter slot matches anything. */
const sum = (ev, ...filter) => rows
    .filter(r => r.parts[0] === ev && filter.every((f, i) => f == null || r.parts[i + 1] === f))
    .reduce((t, r) => t + r.n, 0);
const pct = (a, b) => (b ? `${Math.round(100 * a / b)}% (${a}/${b})` : `- (${a}/0)`);
/** Totals of `ev` per value of dimension `index` (1-based after the event name). */
const by = (ev, index) => {
    const out = {};
    for (const r of rows) if (r.parts[0] === ev) out[r.parts[index]] = (out[r.parts[index]] || 0) + r.n;
    return out;
};

console.log(`Metrics for ${selected.length} day(s): ${selected[0] || '-'} .. ${selected[selected.length - 1] || '-'}\n`);

console.log('Friend path');
console.log('  link opened -> room joined :', sum('code_join', 'link', 'ok'), '/', sum('code_join', 'link'));
console.log('  link join -> finished match:', pct(sum('match_end', null, 'code', 'link'), sum('code_join', 'link', 'ok')));
console.log('  share clicks               :', sum('share_click'));

console.log('\nStrangers');
console.log('  quick queue -> matched     :', pct(sum('match_found', null, 'quick'), sum('queue_join', null, 'quick')));
console.log('  wait when matched          :', by('match_found', 4));
console.log('  gave up                    :', by('queue_leave', 2));
console.log('  gave up after waiting      :', by('queue_leave', 3));

console.log('\nConnections and play');
console.log('  matched -> both connected  :', pct(sum('room_ready'), sum('match_found')));
console.log('  connection type            :', by('net_result', 2));
console.log('  match length               :', by('match_end', 4));
console.log('  rematch / match end        :', pct(sum('rematch'), sum('match_end')));
console.log('  bot starts                 :', by('bot_start', 2));
console.log('  lobby opens (not people)   :', sum('lobby_open'));

console.log('\nPer game: finished matches, rematches');
const games = Object.keys(by('match_end', 1)).sort((a, b) => sum('match_end', b) - sum('match_end', a));
for (const g of games) console.log(`  ${g.padEnd(12)} ${String(sum('match_end', g)).padStart(5)} ${String(sum('rematch', g)).padStart(5)}`);

console.log('\nRetention: first-visit week -> visitors in week 0, 1, 2, ...');
for (const cohort of Object.keys(data.retention || {}).sort()) {
    const row = data.retention[cohort];
    const last = Math.max(...Object.keys(row).map(Number));
    const cells = [];
    for (let w = 0; w <= last; w++) cells.push(row[w] || 0);
    console.log(`  ${cohort}: ${cells.join(' ')}`);
}
