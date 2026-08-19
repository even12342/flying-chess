// 骰子类小游戏：命运骰子 / 骰子斗牛 / 骰子淘汰赛 / 骰子大逃杀
import { registerGame } from './registry.js';

function rollDie() { return 1 + Math.floor(Math.random() * 6); }

// ============ 命运骰子（即时型） ============
// 每位玩家各掷 1 颗特殊六面骰子，六面即时执行，支持 2-4 人。
const FATE_DICE_FACES = [
  { name: '前进 2 格', type: 'forward', value: 2 },
  { name: '后退 2 格', type: 'backward', value: 2 },
  { name: '与任意玩家换位', type: 'swapRandom' },
  { name: '获得护盾', type: 'shield' },
  { name: '停一轮', type: 'skip', value: 1 },
  { name: '双倍下一步', type: 'double' },
];
class FateDice {
  constructor() { this.immediate = true; this.gameId = 'fate-dice'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.idx = 0; this.results = []; this.pending = [];
  }
  start() {}
  getCurrentPlayerId() { return this.idx < this.order.length ? this.order[this.idx] : null; }
  onPlayerAction(pid) {
    if (pid !== this.getCurrentPlayerId()) return;
    const f = FATE_DICE_FACES[Math.floor(Math.random() * FATE_DICE_FACES.length)];
    let effect = null;
    if (f.type === 'swapRandom') {
      const others = this.order.filter((x) => x !== pid);
      if (others.length) effect = { playerId: pid, type: 'swap', value: others[Math.floor(Math.random() * others.length)] };
    } else effect = { playerId: pid, type: f.type, value: f.value };
    this.results.push({ playerId: pid, name: f.name, effect });
    this.pending = effect ? [effect] : [];
    this.idx++;
  }
  getPendingEffects() { const p = this.pending; this.pending = []; return p; }
  isFinished() { return this.idx >= this.order.length; }
  getResult() {
    return { winner: [], effects: this.results.filter((r) => r.effect).map((r) => r.effect), details: this.results.map((r) => ({ playerId: r.playerId, name: r.name })) };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'fate-dice', results: this.results.map((r) => ({ playerId: r.playerId, name: r.name, applied: !!r.effect })) } };
  }
  timeoutHint() { return { mode: 'turn', ms: 15000 }; }
  destroy() {}
}

// ============ 骰子斗牛（2 人，结算型） ============
// 各掷 3 骰比总和，可跟注额外掷 1（最多 4），或停牌；总和大大者胜，平局。
class DiceBull {
  constructor() { this.immediate = false; this.gameId = 'dice-bull'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.dice = {}; this.stood = {}; this.state = 'betting'; this.cur = 0;
    for (const p of this.players) this.dice[p.id] = [rollDie(), rollDie(), rollDie()];
  }
  start() {}
  sum(id) { return this.dice[id].reduce((s, x) => s + x, 0); }
  getCurrentPlayerId() { return this.state === 'betting' ? this.order[this.cur] : null; }
  nextBettor() { for (let i = 0; i < this.order.length; i++) { const j = (this.cur + i + 1) % this.order.length; if (!this.stood[this.order[j]]) return j; } return this.cur; }
  allStood() { return this.order.every((id) => this.stood[id]); }
  onPlayerAction(pid, action) {
    if (this.state !== 'betting' || pid !== this.order[this.cur]) return;
    if (action.type === 'timeout') action = { choice: 'stand' };
    if (action.choice === 'hit' && this.dice[pid].length < 4) this.dice[pid].push(rollDie());
    this.stood[pid] = true;
    this.cur = this.nextBettor();
    if (this.allStood()) this.state = 'done';
  }
  isFinished() { return this.state === 'done'; }
  getResult() {
    const [a, b] = this.order;
    const sa = this.sum(a), sb = this.sum(b);
    let winner = null;
    if (sa > sb) winner = a; else if (sb > sa) winner = b;
    return { winner: winner ? [winner] : [], effects: winner ? [{ playerId: winner, type: 'forward', value: 4 }] : [], details: [{ playerId: a, name: `点数 ${sa}` }, { playerId: b, name: `点数 ${sb}` }] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'dice-bull', dice: this.dice, stood: this.stood, state: this.state, cur: this.order[this.cur] } };
  }
  timeoutHint() { return this.state === 'betting' ? { mode: 'turn', ms: 20000 } : null; }
  aiAction(pid) {
    const opp = this.order.find((x) => x !== pid);
    if (this.dice[pid].length < 4 && this.sum(pid) <= this.sum(opp)) return { choice: 'hit' };
    return { choice: 'stand' };
  }
  destroy() {}
}

// ============ 骰子淘汰赛（2-4 人，结算型） ============
// 各掷 1 骰，最小者淘汰，剩者继续，直到冠军。并列则并列者加掷 1 颗决胜。
class DiceElim {
  constructor() { this.immediate = false; this.gameId = 'dice-elim'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.alive = this.order.slice();
    this.elimOrder = []; // 被淘汰先后
    this.lastRolls = {}; this.state = 'ready';
  }
  start() {} // 首轮由第一位存活玩家点击“掷骰（淘汰本轮）”开始
  rollRound() {
    this.lastRolls = {};
    for (const id of this.alive) this.lastRolls[id] = rollDie();
    const min = Math.min(...this.alive.map((id) => this.lastRolls[id]));
    let cands = this.alive.filter((id) => this.lastRolls[id] === min);
    // 并列则加掷 1 颗决胜，直至唯一最小
    while (cands.length > 1) {
      let best = Infinity, pick = [];
      for (const id of cands) { const v = rollDie(); this.lastRolls[id] = v; if (v < best) { best = v; pick = [id]; } else if (v === best) pick.push(id); }
      cands = pick;
    }
    const out = cands[0];
    this.alive = this.alive.filter((id) => id !== out);
    this.elimOrder.push(out);
    if (this.alive.length <= 1) this.state = 'done';
  }
  // 指定当前存活队列首位玩家点击推进本轮；被淘汰后自动轮到下一位
  getCurrentPlayerId() { return this.state === 'ready' ? this.alive[0] : null; }
  onPlayerAction(pid, action) {
    if (this.state !== 'ready') return;
    if (action.type === 'timeout') { this.rollRound(); return; }
    this.rollRound();
  }
  isFinished() { return this.state === 'done'; }
  timeoutHint() { return this.state === 'ready' ? { mode: 'turn', ms: 15000 } : null; }
  getResult() {
    const champ = this.alive[0];
    const firstOut = this.elimOrder[0];
    const effects = [];
    if (champ) effects.push({ playerId: champ, type: 'forward', value: 4 });
    if (firstOut) effects.push({ playerId: firstOut, type: 'backward', value: 2 });
    return { winner: champ ? [champ] : [], effects, details: [{ playerId: champ, name: '冠军' }, { playerId: firstOut, name: '最先淘汰' }] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'dice-elim', alive: this.alive, elimOrder: this.elimOrder, lastRolls: this.lastRolls, state: this.state } };
  }
  aiAction() { return { type: 'roll' }; }
  destroy() {}
}

// ============ 骰子大逃杀（2-4 人，结算型） ============
// 各掷 2 骰，总和最小淘汰，剩者继续，直到冠军。冠军前进 5，第 2 前进 2，最后两名各后退 2。
class DiceRoyale {
  constructor() { this.immediate = false; this.gameId = 'dice-royale'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.alive = this.order.slice();
    this.elimOrder = [];
    this.lastRolls = {}; this.state = 'ready';
  }
  start() {}
  rollRound() {
    this.lastRolls = {};
    for (const id of this.alive) this.lastRolls[id] = rollDie() + rollDie();
    const min = Math.min(...this.alive.map((id) => this.lastRolls[id]));
    let cands = this.alive.filter((id) => this.lastRolls[id] === min);
    while (cands.length > 1) {
      let best = Infinity, pick = [];
      for (const id of cands) { const v = rollDie() + rollDie(); this.lastRolls[id] = v; if (v < best) { best = v; pick = [id]; } else if (v === best) pick.push(id); }
      cands = pick;
    }
    const out = cands[0];
    this.alive = this.alive.filter((id) => id !== out);
    this.elimOrder.push(out);
    if (this.alive.length <= 1) this.state = 'done';
  }
  getCurrentPlayerId() { return this.state === 'ready' ? this.alive[0] : null; }
  onPlayerAction(pid, action) {
    if (this.state !== 'ready') return;
    if (action.type === 'timeout') { this.rollRound(); return; }
    this.rollRound();
  }
  isFinished() { return this.state === 'done'; }
  timeoutHint() { return this.state === 'ready' ? { mode: 'turn', ms: 15000 } : null; }
  getResult() {
    const champ = this.alive[0];
    const second = this.elimOrder[this.elimOrder.length - 2];
    const last2 = this.elimOrder.slice(0, 2);
    const effects = [];
    if (champ) effects.push({ playerId: champ, type: 'forward', value: 5 });
    if (second) effects.push({ playerId: second, type: 'forward', value: 2 });
    for (const id of last2) effects.push({ playerId: id, type: 'backward', value: 2 });
    return { winner: champ ? [champ] : [], effects, details: [{ playerId: champ, name: '冠军' }, { playerId: second, name: '第2名' }] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'dice-royale', alive: this.alive, elimOrder: this.elimOrder, lastRolls: this.lastRolls, state: this.state } };
  }
  aiAction() { return { type: 'roll' }; }
  destroy() {}
}

registerGame({
  meta: { id: 'fate-dice', name: '命运骰子', description: '每人掷 1 颗特殊骰子：前进 2 / 后退 2 / 与任意玩家换位 / 获得护盾 / 停一轮 / 双倍下一步，即时生效。', rules: '每位玩家各掷 1 颗六面骰子，六面分别是：前进 2 格、后退 2 格、与任意玩家换位、获得护盾（撞机免疫一次）、停一轮、双倍下一步。掷出后效果立即作用在飞行棋上。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 },
  create: () => new FateDice(),
});
registerGame({
  meta: { id: 'dice-bull', name: '骰子斗牛', description: '两人各掷 3 颗骰子比总和，可跟注再掷 1 颗（最多 4 颗）或停牌，总和大大者胜。', rules: '双方先各掷 3 颗骰子。之后轮流行动：可“跟注”再掷 1 颗（最多 4 颗）或“停牌”。双方都停牌后，骰子点数总和大的一方获胜，胜者前进 4 格；点数相同则平局。', minPlayers: 2, maxPlayers: 2, supports: (n) => n === 2 },
  create: () => new DiceBull(),
});
registerGame({
  meta: { id: 'dice-elim', name: '骰子淘汰赛', description: '各掷 1 骰，最小者淘汰，剩者继续，直到冠军。', rules: '每轮所有存活玩家各掷 1 颗骰子，点数最小者淘汰出局。若出现最小点数并列，则并列者加掷 1 颗骰子决胜负。剩余玩家继续，直到决出最后一名冠军。冠军前进 4 格，最先被淘汰者后退 2 格。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 },
  create: () => new DiceElim(),
});
registerGame({
  meta: { id: 'dice-royale', name: '骰子大逃杀', description: '各掷 2 骰，总和最小淘汰，直到冠军。冠军前进 5，第 2 前进 2，最后两名后退 2。', rules: '每轮所有存活玩家各掷 2 颗骰子，点数总和最小者淘汰。并列最小则并列者加掷 1 颗决胜。直到决出冠军：冠军前进 5 格，第 2 名前进 2 格，最先被淘汰的两名各后退 2 格。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 },
  create: () => new DiceRoyale(),
});
