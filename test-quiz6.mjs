import './server/minigame/g-reaction.js';
import { MINI_GAMES } from './server/minigame/registry.js';

const def = MINI_GAMES.find((g) => g.meta.id === 'quiz-three');
const q = def.create();
q.init([
  { id: 'p1', name: 'A', color: 'red' },
  { id: 'p2', name: 'B', color: 'blue' },
  { id: 'p3', name: 'C', color: 'green' },
]);

let checks = 0, fails = 0;
const assert = (c, m) => { checks++; if (!c) { fails++; console.log('  ✗ ' + m); } };

assert(q.total === 6, `total 应为 6，实际 ${q.total}`);

// 模拟一整局：每题由某人抢答并作答（全部答对/答错混合），统计出题数
let asked = 0;
let guard = 0;
let prevQid = null;
while (!q.isFinished() && guard < 50) {
  guard++;
  const v = q.getState().view;
  if (v.phase === 'ask') {
    asked++;
    // 每题记录题面 id 是否推进
    if (prevQid !== null && v.q.q === prevQid) { /* 同一题仍在问，正常 */ }
    prevQid = v.q.q;
    // p1 抢答，随机答对或答错
    q.onPlayerAction('p1', { type: 'buzz' });
    const correct = Math.random() < 0.5;
    q.onPlayerAction('p1', { type: 'answer', answer: correct ? v.q.a : (['A', 'B', 'C', 'D'].find((x) => x !== v.q.a)) });
  } else break;
}
assert(asked === 6, `应恰好出 6 题，实际出了 ${asked} 题`);
assert(q.isFinished(), '6 题后应结束');
const res = q.getResult();
assert(res.winner && res.winner.length === 1, `应有唯一赢家，实际 ${JSON.stringify(res.winner)}`);
assert(res.effects.some((e) => e.type === 'forward' && e.value === 3), '赢家应有前进 3 效果');

// 超时路径：每题都无人抢答，也应稳定出满 6 题后结束
const q2 = def.create();
q2.init([{ id: 'p1', name: 'A', color: 'red' }, { id: 'p2', name: 'B', color: 'blue' }]);
let asked2 = 0, g2 = 0;
while (!q2.isFinished() && g2 < 50) {
  g2++;
  const v = q2.getState().view;
  if (v.phase === 'ask') { asked2++; q2.onGlobalTimeout(); }
  else break;
}
assert(asked2 === 6, `无人抢答超时路径也应出满 6 题，实际 ${asked2}`);
assert(q2.isFinished(), '超时路径 6 题后应结束');

console.log(`\n抢答三色「固定 6 题」模拟：${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
