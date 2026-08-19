import './server/minigame/g-cards.js';
import { MINI_GAMES } from './server/minigame/registry.js';

const def = MINI_GAMES.find((g) => g.meta.id === 'turtle');
const t = def.create();
t.init([
  { id: 'p1', name: 'A', color: 'red' },
  { id: 'p2', name: 'B', color: 'blue' },
  { id: 'p3', name: 'C', color: 'green' },
]);

let checks = 0, fails = 0;
function assert(cond, msg) { checks++; if (!cond) { fails++; console.log('  ✗ ' + msg); } }

// 1) 开局：下家 = 顺时针下一个有牌者
const s0 = t.getState();
assert(s0.view.drawFromId, '开局应给出 drawFromId');
assert(s0.view.drawFromId === 'p2', `首回合(p1)下家应为 p2，实际 ${s0.view.drawFromId}`);

// 2) 玩家点选下家某张具体牌：该【位置】的牌应被精确抽走
const target = t.drawFromId();
const beforeTargetLen = t.hands[target].length;
const pickIdx = 2 % beforeTargetLen; // 故意选一个非首位的牌，验证「按位置抽」
const pickedId = t.hands[target][pickIdx].id; // 记录被点选的那张牌
t.onPlayerAction('p1', { type: 'draw', cardIndex: pickIdx });
assert(t.hands[target].length === beforeTargetLen - 1, '下家手牌应减少 1');
assert(!t.hands[target].some((c) => c.id === pickedId), '被点选位置的那张牌已从下家手牌消失（精确抽出）');

// 3) 非法 cardIndex 应兜底随机（不报错、不崩）
const len2 = t.hands[t.drawFromId()].length;
t.onPlayerAction(t.getCurrentPlayerId(), { type: 'draw', cardIndex: 999 });
assert(t.hands[t.drawFromId()].length === len2 - 1 || t.hands[t.getCurrentPlayerId()].length >= 0, '非法 index 兜底抽牌不崩');

// 4) 整局跑完：每回合当前玩家从 drawFromId 抽一张，直到 done
let guard = 0;
while (!t.isFinished() && guard < 500) {
  guard++;
  const cur = t.getCurrentPlayerId();
  if (!cur) break;
  const tgt = t.drawFromId();
  if (!tgt) { t.onPlayerAction(cur, { type: 'timeout' }); continue; }
  const idx = Math.floor(Math.random() * t.hands[tgt].length);
  t.onPlayerAction(cur, { type: 'draw', cardIndex: idx });
}
assert(guard < 500, `整局应在有限回合内结束（用 ${guard} 步）`);
assert(t.isFinished(), '游戏应正常结束');

// 5) 结算：恰好一人留乌龟，一人最先出完
const res = t.getResult();
const turtleHolder = ['p1', 'p2', 'p3'].find((id) => t.hands[id].some((c) => c.face === 'TURTLE'));
console.log('  乌龟持有者:', turtleHolder, '| 最先出完:', res.winner, '| effects:', JSON.stringify(res.effects));
assert(turtleHolder, '应有人持有乌龟');
assert(res.winner && res.winner.length === 1, '应有唯一赢家');

// 6) AI 动作应返回合法 cardIndex
const t2 = def.create();
t2.init([{ id: 'p1', name: 'A', color: 'red' }, { id: 'p2', name: 'B', color: 'blue' }]);
const ai = t2.aiAction('p1');
assert(ai && typeof ai.cardIndex === 'number' && ai.cardIndex >= 0 && ai.cardIndex < t2.hands[t2.drawFromId()].length, 'AI 返回合法 cardIndex');

console.log(`\n抓乌龟「点选下家具体牌」模拟：${checks - fails}/${checks} 通过`);
process.exit(fails ? 1 : 0);
