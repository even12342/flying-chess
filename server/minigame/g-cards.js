// 卡牌类小游戏：记忆翻牌 / 翻牌对对碰 / 抓乌龟 / UNO速决 / 运气抽卡
import { registerGame } from './registry.js';

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ============ 记忆翻牌（2-4 人，结算型） ============
class Memory {
  constructor() { this.immediate = false; this.gameId = 'memory'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    const pairs = { 2: 6, 3: 8, 4: 10 }[players.length] || 6;
    const faces = [];
    for (let i = 0; i < pairs; i++) { faces.push(i); faces.push(i); }
    shuffle(faces);
    this.cards = faces.map((f, i) => ({ id: i, face: f, up: false, matched: false }));
    this.scores = {}; this.order.forEach((id) => (this.scores[id] = 0));
    this.first = null; this.cur = 0; this.phase = 'play'; this.winner = null; this.target = null; this.reveal = null;
  }
  start() {}
  getCurrentPlayerId() { return this.phase === 'choose' ? this.winner : (this.phase === 'play' ? this.order[this.cur] : null); }
  onPlayerAction(pid, action) {
    if (this.phase === 'choose') {
      if (pid !== this.winner) return;
      let tgt = action.target;
      if (action.type === 'timeout' || !tgt || !this.order.includes(tgt) || tgt === this.winner) {
        const others = this.order.filter((id) => id !== this.winner);
        tgt = others[Math.floor(Math.random() * others.length)];
      }
      this.target = tgt; this.phase = 'done'; return;
    }
    if (this.phase !== 'play' || pid !== this.order[this.cur]) return;
    if (action.type === 'timeout') { this.first = null; this.cur = (this.cur + 1) % this.order.length; return; }
    const c = this.cards[action.idx];
    if (!c || c.up || c.matched) return;
    c.up = true;
    if (this.first == null) { this.first = action.idx; }
    else {
      const f = this.cards[this.first];
      if (f.face === c.face) { f.matched = true; c.matched = true; this.scores[pid] = (this.scores[pid] || 0) + 1; this.first = null; }
      else {
        // 未配对：保持翻开进入揭示阶段，延迟后翻回并换人
        this.reveal = { a: this.first, b: action.idx };
        this.first = null;
        this.phase = 'reveal';
      }
    }
  }
  computeWinner() { let best = -1, bid = null; for (const id of this.order) if (this.scores[id] > best) { best = this.scores[id]; bid = id; } this.winner = best > 0 ? bid : null; }
  isFinished() { return this.phase === 'done'; }
  onGlobalTimeout() { if (this.phase === 'play') { this.computeWinner(); this.phase = this.winner ? 'choose' : 'done'; } }
  getRevealDelay() { return this.phase === 'reveal' ? 1200 : 0; }
  onRevealTimeout() {
    if (this.phase !== 'reveal' || !this.reveal) return;
    this.cards[this.reveal.a].up = false;
    this.cards[this.reveal.b].up = false;
    this.reveal = null;
    this.cur = (this.cur + 1) % this.order.length;
    this.phase = 'play';
  }
  getResult() {
    const effects = [];
    if (this.winner) { effects.push({ playerId: this.winner, type: 'forward', value: 2 }); if (this.target) effects.push({ playerId: this.target, type: 'backward', value: 2 }); }
    return { winner: this.winner ? [this.winner] : [], effects, details: [] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'memory', cards: this.cards, scores: this.scores, first: this.first, cur: this.phase === 'choose' ? null : this.order[this.cur], phase: this.phase, order: this.order, winner: this.winner, target: this.target, reveal: this.reveal } };
  }
  timeoutHint() { return this.phase === 'play' ? { mode: 'global', ms: 30000 } : (this.phase === 'choose' ? { mode: 'turn', ms: 8000 } : null); }
  aiAction(pid) {
    if (this.phase === 'choose') {
      const others = this.order.filter((id) => id !== this.winner);
      return { target: others[Math.floor(Math.random() * others.length)] };
    }
    const closed = this.cards.filter((c) => !c.up && !c.matched);
    if (this.first == null) return closed.length ? { idx: closed[0].id } : null;
    const f = this.cards[this.first];
    const m = closed.find((c) => c.face === f.face);
    return { idx: (m || closed[0]).id };
  }
  destroy() {}
}

// ============ 翻牌对对碰（2-4 人，结算型） ============
class MatchPair {
  constructor() { this.immediate = false; this.gameId = 'match-pair'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    const faces = [];
    for (let i = 0; i < 8; i++) { faces.push(i); faces.push(i); }
    shuffle(faces);
    this.cards = faces.map((f, i) => ({ id: i, face: f, up: false, matched: false }));
    this.scores = {}; this.order.forEach((id) => (this.scores[id] = 0));
    this.first = null; this.cur = 0; this.phase = 'play'; this.reveal = null;
  }
  start() {}
  getCurrentPlayerId() { return this.phase === 'play' ? this.order[this.cur] : null; }
  onPlayerAction(pid, action) {
    if (this.phase === 'reveal') return; // 揭示阶段不可操作
    if (this.phase !== 'play' || pid !== this.order[this.cur]) return;
    if (action.type === 'timeout') { this.first = null; this.cur = (this.cur + 1) % this.order.length; return; }
    const c = this.cards[action.idx];
    if (!c || c.up || c.matched) return;
    c.up = true;
    if (this.first == null) this.first = action.idx;
    else {
      const f = this.cards[this.first];
      if (f.face === c.face) { f.matched = true; c.matched = true; this.scores[pid] = (this.scores[pid] || 0) + 1; this.first = null; }
      else {
        // 未配对：保持两张翻开进入揭示阶段，让玩家看清后再延迟翻回并换人
        this.reveal = { a: this.first, b: action.idx };
        this.first = null;
        this.phase = 'reveal';
      }
    }
    if (this.phase === 'play' && this.cards.every((x) => x.matched)) this.phase = 'done';
  }
  // 揭示阶段时长（ms）：返回 >0 时房间会在该延迟后调用 onRevealTimeout 翻回并换人
  getRevealDelay() { return this.phase === 'reveal' ? 1200 : 0; }
  onRevealTimeout() {
    if (this.phase !== 'reveal' || !this.reveal) return;
    this.cards[this.reveal.a].up = false;
    this.cards[this.reveal.b].up = false;
    this.reveal = null;
    this.cur = (this.cur + 1) % this.order.length;
    this.phase = 'play';
    if (this.cards.every((x) => x.matched)) this.phase = 'done';
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    const ranked = this.order.slice().sort((a, b) => this.scores[b] - this.scores[a]);
    const effects = [];
    if (ranked[0]) effects.push({ playerId: ranked[0], type: 'forward', value: 4 });
    if (ranked[1]) effects.push({ playerId: ranked[1], type: 'forward', value: 2 });
    return { winner: ranked[0] ? [ranked[0]] : [], effects, details: [] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'match-pair', cards: this.cards, scores: this.scores, first: this.first, cur: this.order[this.cur], phase: this.phase, order: this.order, reveal: this.reveal } };
  }
  timeoutHint() { return this.phase === 'play' ? { mode: 'global', ms: 30000 } : null; }
  aiAction() {
    const closed = this.cards.filter((c) => !c.up && !c.matched);
    if (!closed.length) return null;
    if (this.first == null) return { idx: closed[0].id };
    const f = this.cards[this.first];
    const m = closed.find((c) => c.face === f.face);
    return { idx: (m || closed[0]).id };
  }
  destroy() {}
}

// ============ 抓乌龟（2-4 人，结算型） ============
class Turtle {
  constructor() { this.immediate = false; this.gameId = 'turtle'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    const pairs = { 2: 10, 3: 12, 4: 15 }[players.length] || 10;
    const deck = [];
    let id = 0;
    for (let i = 0; i < pairs; i++) { deck.push({ id: id++, face: 'p' + i }); deck.push({ id: id++, face: 'p' + i }); }
    deck.push({ id: id++, face: 'TURTLE' });
    shuffle(deck);
    // 均分，乌龟随机落某玩家
    const n = this.order.length;
    this.hands = {}; this.order.forEach((idp) => (this.hands[idp] = []));
    deck.forEach((card, i) => this.hands[this.order[i % n]].push(card));
    this.dropPairs();
    this.finished = {}; this.orderOut = [];
    this.cur = 0; this.phase = 'play';
  }
  start() {}
  dropPairs() {
    for (const idp of this.order) {
      const cnt = {};
      this.hands[idp].forEach((c) => (cnt[c.face] = (cnt[c.face] || 0) + 1));
      this.hands[idp] = this.hands[idp].filter((c) => cnt[c.face] !== 2);
      // 注意：仅丢弃恰好成对者；成对后剩余单张保留
    }
  }
  nextAlive() { let i = this.cur; for (let k = 0; k < this.order.length; k++) { i = (i + 1) % this.order.length; if (!this.finished[this.order[i]]) return i; } return this.cur; }
  drawFromId() {
    // 抽牌对象 = 当前玩家顺时针下一个「仍在场且有牌」的玩家（即下家；下家已出完则顺延）
    const n = this.order.length;
    for (let k = 1; k <= n; k++) {
      const idp = this.order[(this.cur + k) % n];
      if (!this.finished[idp] && this.hands[idp].length > 0) return idp;
    }
    return null;
  }
  getCurrentPlayerId() { return this.phase === 'play' ? this.order[this.cur] : null; }
  onPlayerAction(pid, action) {
    if (this.phase !== 'play' || pid !== this.order[this.cur]) return;
    // 抽牌对象固定为「下家」（顺时针下一个仍有牌者）。玩家点选其手里的某一张具体牌（按位置）
    const target = this.drawFromId();
    if (!target) { this.cur = this.nextAlive(); return; }
    const nh = this.hands[target];
    if (!nh || nh.length === 0) { this.cur = this.nextAlive(); return; }
    let idx;
    if (action.type === 'timeout') idx = Math.floor(Math.random() * nh.length);
    else {
      idx = Number(action.cardIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= nh.length) idx = Math.floor(Math.random() * nh.length);
    }
    const drawn = nh.splice(idx, 1)[0];
    this.hands[pid].push(drawn);
    // 若与手牌配对则弃对
    const cnt = {};
    this.hands[pid].forEach((c) => (cnt[c.face] = (cnt[c.face] || 0) + 1));
    this.hands[pid] = this.hands[pid].filter((c) => cnt[c.face] !== 2);
    if (this.hands[pid].length === 0 && !this.finished[pid]) { this.finished[pid] = true; this.orderOut.push(pid); }
    // 仅剩 1 人有牌则结束
    const alive = this.order.filter((id) => !this.finished[id] && this.hands[id].length > 0);
    if (alive.length <= 1) { this.phase = 'done'; return; }
    this.cur = this.nextAlive();
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    const turtle = this.order.find((id) => this.hands[id].some((c) => c.face === 'TURTLE')) || (this.orderOut.length ? this.orderOut[this.orderOut.length - 1] : null);
    const winner = this.orderOut[0];
    const effects = [];
    if (winner) effects.push({ playerId: winner, type: 'forward', value: 3 });
    if (turtle) effects.push({ playerId: turtle, type: 'backward', value: 3 });
    return { winner: winner ? [winner] : [], effects, details: [] };
  }
  getState() {
    // 公开视图：只暴露每位玩家的手牌【数量】（不泄露具体牌面，也不泄露谁拿了乌龟）
    const handCounts = {};
    for (const idp of this.order) handCounts[idp] = this.hands[idp].length;
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'turtle', handCounts, finished: this.finished, order: this.order, players: this.players, cur: this.order[this.cur], drawFromId: this.drawFromId() } };
  }
  getStateFor(playerId) {
    const s = this.getState();
    s.view.myHand = this.hands[playerId].map((c) => (c.face === 'TURTLE' ? '🐢' : c.face));
    return s;
  }
  timeoutHint() { return this.phase === 'play' ? { mode: 'global', ms: 60000 } : null; }
  aiAction(pid) {
    if (pid !== this.order[this.cur]) return null;
    const target = this.drawFromId();
    if (!target) return null;
    const nh = this.hands[target];
    if (!nh || nh.length === 0) return null;
    return { type: 'draw', cardIndex: Math.floor(Math.random() * nh.length) };
  }
  destroy() {}
}

// ============ UNO 速决（2-4 人，结算型） ============
const UNO_COLORS = ['red', 'yellow', 'blue', 'green'];
class Uno {
  constructor() { this.immediate = false; this.gameId = 'uno'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.deck = [];
    let id = 0;
    for (const col of UNO_COLORS) { for (let n = 0; n <= 9; n++) this.deck.push({ id: id++, col, num: n, sp: null }); this.deck.push({ id: id++, col, num: null, sp: 'skip' }); this.deck.push({ id: id++, col, num: null, sp: 'reverse' }); this.deck.push({ id: id++, col, num: null, sp: '+2' }); }
    shuffle(this.deck);
    this.hands = {}; this.order.forEach((idp) => (this.hands[idp] = []));
    for (let i = 0; i < 5; i++) for (const idp of this.order) this.hands[idp].push(this.deck.pop());
    this.top = this.deck.pop();
    this.dir = 1; this.cur = 0; this.phase = 'play';
  }
  start() {}
  getCurrentPlayerId() { return this.phase === 'play' ? this.order[this.cur] : null; }
  playable(card) { return card.col === this.top.col || (card.num != null && this.top.num != null && card.num === this.top.num) || (card.sp && this.top.sp === card.sp); }
  step() {
    let guard = 0;
    do { this.cur = (this.cur + this.dir + this.order.length) % this.order.length; guard++; } while (this.hands[this.order[this.cur]].length === 0 && guard < this.order.length);
  }
  onPlayerAction(pid, action) {
    if (this.phase !== 'play' || pid !== this.order[this.cur]) return;
    if (action.type === 'timeout') { this.drawOne(pid); this.step(); return; }
    if (action.type === 'draw') { this.drawOne(pid); this.step(); return; }
    const card = this.hands[pid].find((c) => c.id === action.cardId);
    if (!card || !this.playable(card)) return;
    this.hands[pid] = this.hands[pid].filter((c) => c.id !== card.id);
    this.top = card;
    if (card.sp === 'skip') { this.step(); this.step(); return; }
    if (card.sp === 'reverse') { this.dir *= -1; this.step(); return; }
    if (card.sp === '+2') { const nxt = this.order[(this.cur + this.dir + this.order.length) % this.order.length]; for (let i = 0; i < 2; i++) if (this.deck.length) this.hands[nxt].push(this.deck.pop()); this.step(); this.step(); return; }
    if (this.hands[pid].length === 0) { this.phase = 'done'; return; }
    this.step();
  }
  drawOne(pid) { if (this.deck.length) this.hands[pid].push(this.deck.pop()); }
  isFinished() { return this.phase === 'done'; }
  onGlobalTimeout() { if (this.phase === 'play') this.phase = 'done'; }
  getResult() {
    const ranked = this.order.slice().sort((a, b) => this.hands[a].length - this.hands[b].length);
    const effects = [];
    if (ranked[0] && this.hands[ranked[0]].length === 0) effects.push({ playerId: ranked[0], type: 'forward', value: 4 });
    if (ranked[1]) effects.push({ playerId: ranked[1], type: 'forward', value: 1 });
    if (ranked[ranked.length - 1]) effects.push({ playerId: ranked[ranked.length - 1], type: 'backward', value: 2 });
    return { winner: this.phase === 'done' && this.hands[ranked[0]].length === 0 ? [ranked[0]] : [], effects, details: [] };
  }
  baseView() {
    // 公开视图：只暴露每位玩家的手牌【张数】，绝不泄露他人手牌内容
    const handCounts = {};
    for (const idp of this.order) handCounts[idp] = this.hands[idp].length;
    return { kind: 'uno', handCounts, top: { col: this.top.col, num: this.top.num, sp: this.top.sp }, dir: this.dir, cur: this.order[this.cur], phase: this.phase, order: this.order };
  }
  getState() { return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { ...this.baseView() } }; }
  getStateFor(playerId) { return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { ...this.baseView(), myHand: this.hands[playerId].map((c) => ({ id: c.id, col: c.col, num: c.num, sp: c.sp })) } }; }
  timeoutHint() { return this.phase === 'play' ? { mode: 'global', ms: 40000 } : null; }
  aiAction(pid) {
    if (pid !== this.order[this.cur]) return null;
    const playable = this.hands[pid].filter((c) => this.playable(c));
    if (playable.length) return { cardId: playable[0].id };
    return { type: 'draw' };
  }
  destroy() {}
}

// ============ 运气抽卡（2-4 人，即时型） ============
const LUCKY_CARDS = [
  { name: '前进 3 格', type: 'good', effect: { type: 'forward', value: 3 } },
  { name: '前进 2 格', type: 'good', effect: { type: 'forward', value: 2 } },
  { name: '获得护盾', type: 'good', effect: { type: 'shield' } },
  { name: '双倍下一步', type: 'good', effect: { type: 'double' } },
  { name: '与任意玩家换位', type: 'good', effect: { type: 'swapRandom' } },
  { name: '前进 4 格', type: 'good', effect: { type: 'forward', value: 4 } },
  { name: '后退 3 格', type: 'bad', effect: { type: 'backward', value: 3 } },
  { name: '后退 2 格', type: 'bad', effect: { type: 'backward', value: 2 } },
  { name: '暂停一轮', type: 'bad', effect: { type: 'skip', value: 1 } },
  { name: '后退 4 格', type: 'bad', effect: { type: 'backward', value: 4 } },
  { name: '整蛊：指定目标后退 3', type: 'curse', effect: { type: 'backward', value: 3 } },
  { name: '整蛊：指定目标暂停一轮', type: 'curse', effect: { type: 'skip', value: 1 } },
  { name: '整蛊：指定目标后退 2', type: 'curse', effect: { type: 'backward', value: 2 } },
  { name: '整蛊：指定目标失去护盾', type: 'curse', effect: { type: 'disarm' } },
  { name: '整蛊：指定目标暂停 2 轮', type: 'curse', effect: { type: 'skip', value: 2 } },
];
class LuckyDraw {
  constructor() { this.immediate = true; this.gameId = 'lucky-draw'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.idx = 0; this.phase = 'play'; this.results = []; this.pending = []; this.picking = null; this.pickPlayer = null;
  }
  start() {}
  getCurrentPlayerId() { return this.picking ? this.pickPlayer : (this.idx < this.order.length ? this.order[this.idx] : null); }
  onPlayerAction(pid, action) {
    if (this.picking) {
      if (pid !== this.pickPlayer) return;
      let tgt = action.target;
      if (action.type === 'timeout' || !tgt || !this.order.includes(tgt) || tgt === this.pickPlayer) {
        const others = this.order.filter((id) => id !== this.pickPlayer);
        tgt = others[Math.floor(Math.random() * others.length)];
      }
      const eff = { ...this.pendingCard.effect, playerId: tgt };
      this.results.push({ playerId: pid, name: this.pendingCard.name + ' → ' + this.nameOf(tgt), effect: eff });
      this.pending = [eff]; this.picking = false; this.pendingCard = null; this.idx++;
      return;
    }
    if (pid !== this.order[this.idx]) return;
    const card = LUCKY_CARDS[Math.floor(Math.random() * LUCKY_CARDS.length)];
    if (card.type === 'curse') { this.picking = true; this.pickPlayer = pid; this.pendingCard = card; this.results.push({ playerId: pid, name: card.name, effect: null }); return; }
    this.results.push({ playerId: pid, name: card.name, effect: { ...card.effect, playerId: pid } });
    this.pending = [{ ...card.effect, playerId: pid }];
    this.idx++;
  }
  nameOf(id) { const p = this.players.find((x) => x.id === id); return p ? p.name : id; }
  getPendingEffects() { const p = this.pending; this.pending = []; return p; }
  isFinished() { return this.idx >= this.order.length; }
  getResult() {
    return { winner: [], effects: this.results.filter((r) => r.effect).map((r) => r.effect), details: this.results.map((r) => ({ playerId: r.playerId, name: r.name })) };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'lucky-draw', results: this.results.map((r) => ({ playerId: r.playerId, name: r.name, applied: !!r.effect })), picking: this.picking, order: this.order, players: this.players } };
  }
  timeoutHint() { return { mode: 'turn', ms: 15000 }; }
  aiAction(pid) {
    if (this.picking) {
      if (pid !== this.pickPlayer) return null;
      const others = this.order.filter((id) => id !== this.pickPlayer);
      return { target: others[Math.floor(Math.random() * others.length)] };
    }
    return { type: 'draw' };
  }
  destroy() {}
}

registerGame({ meta: { id: 'memory', name: '记忆翻牌', description: '桌面若干对卡牌，轮流翻两张配对得分，总时长 30 秒，分高者胜。胜者指定一名玩家后退 2 格。', rules: '桌面上放置若干对背面朝上的卡牌（2 人 6 对、3 人 8 对、4 人 10 对）。玩家轮流翻开两张牌，若图案相同则配对成功得 1 分并可继续翻牌；若不同则翻回背面，换下一玩家。总时长 30 秒，时间结束得分最高者获胜，胜者可指定任意一名玩家后退 2 格（系统默认指定当前最落后玩家）。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new Memory() });
registerGame({ meta: { id: 'match-pair', name: '翻牌对对碰', description: '8 对卡牌轮流翻，配对得分，30 秒后按得分排名。第 1 前进 4，第 2 前进 2。', rules: '桌面上放置 8 对背面朝上的卡牌，玩家轮流翻开两张，配对成功得 1 分并可继续翻牌，配对失败则翻回换人。总时长 30 秒，时间结束后按得分排名：第 1 名前进 4 格，第 2 名前进 2 格，其余玩家不变。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new MatchPair() });
registerGame({ meta: { id: 'turtle', name: '抓乌龟', description: '抽下家牌配对弃对，剩乌龟者输。赢家前进 3，乌龟后退 3。', rules: '系统发牌，牌中含若干对相同牌和 1 张单独的乌龟牌。玩家轮流抽取下家一张手牌，若抽到的牌与自己手中某张配对则丢弃该对。所有对子出完后，最后手中剩乌龟牌者为输家，最先出完所有牌者为赢家。赢家前进 3 格，乌龟后退 3 格，其余玩家不变。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new Turtle() });
registerGame({ meta: { id: 'uno', name: 'UNO 速决', description: '出牌颜色/数字相同，特殊牌生效，先出完胜。第 1 前进 4，第 2 前进 1，最后后退 2。', rules: '每人发 5 张牌，牌堆顶翻开 1 张作起始牌。玩家轮流出牌，所出牌需与桌面上一张牌颜色相同或数字相同（特殊牌：跳过=下家跳过、反转=出牌顺序反转、+2=下家摸 2 张并跳过）。无牌可出则摸 1 张。先出完所有手牌者获胜，限时 40 秒，超时按剩余手牌排名：第 1 名前进 4 格，第 2 名前进 1 格，最后 1 名后退 2 格。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new Uno() });
registerGame({ meta: { id: 'lucky-draw', name: '运气抽卡', description: '卡池好运/厄运/整蛊三类，每人抽 1 张即时生效，整蛊卡指定目标。', rules: '卡池包含三类卡牌：好运卡（前进 / 获得道具）、厄运卡（后退 / 停一轮）、整蛊卡（指定其他玩家执行负面效果）。每位玩家各抽 1 张，即时生效。整蛊卡由抽卡者指定目标玩家再生效。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new LuckyDraw() });
