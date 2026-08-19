// 猜测 / 社交类小游戏：数字猎人 / 数字炸弹 / 你画我猜 / 谁是卧底
import { registerGame } from './registry.js';

// ============ 数字猎人（2 人，结算型） ============
class NumberHunter {
  constructor() { this.immediate = false; this.gameId = 'number-hunter'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.target = 1 + Math.floor(Math.random() * 100);
    this.lo = 1; this.hi = 100; this.turn = 0; this.phase = 'play'; this.guesses = {}; this.winner = null;
  }
  start() {}
  getCurrentPlayerId() { return this.phase === 'play' ? this.order[this.turn] : null; }
  onPlayerAction(pid, action) {
    if (this.phase !== 'play' || pid !== this.order[this.turn]) return;
    if (action.type === 'timeout') { this.turn = 1 - this.turn; return; }
    const v = Number(action.value);
    if (!Number.isInteger(v) || v < this.lo || v > this.hi) return;
    this.guesses[pid] = v;
    if (v === this.target) { this.winner = pid; this.phase = 'done'; return; }
    if (v < this.target) this.lo = Math.max(this.lo, v + 1); else this.hi = Math.min(this.hi, v - 1);
    this.turn = 1 - this.turn;
  }
  isFinished() { return this.phase === 'done'; }
  getResult() { const w = this.winner; return { winner: w ? [w] : [], effects: w ? [{ playerId: w, type: 'shield' }] : [], details: [{ playerId: w, name: '猜中 ' + this.target }] }; }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'number-hunter', lo: this.lo, hi: this.hi, turn: this.turn, guesses: this.guesses, order: this.order } };
  }
  timeoutHint() { return this.phase === 'play' ? { mode: 'turn', ms: 10000 } : null; }
  aiAction() { return { value: this.lo + Math.floor(Math.random() * (this.hi - this.lo + 1)) }; }
  destroy() {}
}

// ============ 数字炸弹（2-4 人，结算型） ============
class NumberBomb {
  constructor() { this.immediate = false; this.gameId = 'number-bomb'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.bomb = 1 + Math.floor(Math.random() * 50);
    this.lo = 1; this.hi = 50; this.turn = 0; this.phase = 'play'; this.guesses = {}; this.loser = null;
  }
  start() {}
  getCurrentPlayerId() { return this.phase === 'play' ? this.order[this.turn] : null; }
  onPlayerAction(pid, action) {
    if (this.phase !== 'play' || pid !== this.order[this.turn]) return;
    if (action.type === 'timeout') { this.turn = (this.turn + 1) % this.order.length; return; }
    const v = Number(action.value);
    if (!Number.isInteger(v) || v < 1 || v > 50) return;
    this.guesses[pid] = v;
    if (v === this.bomb) { this.loser = pid; this.phase = 'done'; return; }
    if (v < this.bomb) this.lo = Math.max(this.lo, v + 1); else this.hi = Math.min(this.hi, v - 1);
    this.turn = (this.turn + 1) % this.order.length;
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    const effects = [];
    for (const id of this.order) effects.push(id === this.loser ? { playerId: id, type: 'backward', value: 3 } : { playerId: id, type: 'forward', value: 2 });
    return { winner: [], effects, details: [{ playerId: this.loser, name: '踩中炸弹' }] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'number-bomb', lo: this.lo, hi: this.hi, turn: this.turn, guesses: this.guesses, order: this.order } };
  }
  timeoutHint() { return this.phase === 'play' ? { mode: 'turn', ms: 15000 } : null; }
  aiAction() { return { value: this.lo + Math.floor(Math.random() * (this.hi - this.lo + 1)) }; }
  destroy() {}
}

// ============ 你画我猜（3-4 人，结算型） ============
const DRAW_WORDS = ['苹果', '太阳', '房子', '小猫', '小狗', '汽车', '飞机', '大树', '花朵', '雨伞', '书本', '钟表', '小鱼', '小鸟', '星星', '月亮', '电脑', '手机', '帽子', '鞋子', '足球', '西瓜', '香蕉', '雪人', '风筝', '灯笼', '小船', '火车', '钢琴', '吉他', '牙刷', '眼镜', '钥匙', '小桥', '高山', '小河', '闪电', '火苗', '冰激凌', '汉堡', '披萨', '自行车', '火箭', '气球', '彩虹', '灯塔', '木马', '闹钟', '钱包'];
class DrawGuess {
  constructor() { this.immediate = false; this.gameId = 'draw-guess'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.scores = {}; this.order.forEach((id) => (this.scores[id] = 0));
    this.drawerIdx = 0; this.phase = 'drawing'; this.startRound();
  }
  startRound() {
    this.drawer = this.order[this.drawerIdx];
    this.word = DRAW_WORDS[Math.floor(Math.random() * DRAW_WORDS.length)];
    this.strokes = []; this.guessed = false; this.phase = 'drawing';
  }
  start() {}
  getCurrentPlayerId() { return null; }
  onPlayerAction(pid, action) {
    if (this.phase !== 'drawing') return;
    if (action.type === 'draw') { if (pid !== this.drawer) return; if (Array.isArray(action.seg)) this.strokes.push(action.seg); }
    else if (action.type === 'guess') {
      if (pid === this.drawer || this.guessed) return;
      const t = (action.text || '').trim();
      if (t && t === this.word) { this.scores[pid] = (this.scores[pid] || 0) + 1; this.scores[this.drawer] = (this.scores[this.drawer] || 0) + 1; this.guessed = true; this.nextDrawer(); }
    } else if (action.type === 'end') { if (pid === this.drawer) this.nextDrawer(); }
  }
  nextDrawer() { this.drawerIdx++; if (this.drawerIdx >= this.order.length) this.phase = 'done'; else this.startRound(); }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    let best = -1, bid = null;
    for (const id of this.order) if (this.scores[id] > best) { best = this.scores[id]; bid = id; }
    const effects = [];
    if (bid) effects.push({ playerId: bid, type: 'forward', value: 4 });
    for (const id of this.order) if (id !== bid) effects.push({ playerId: id, type: 'forward', value: this.scores[id] > 0 ? 2 : 1 });
    return { winner: bid ? [bid] : [], effects, details: [] };
  }
  baseView() { return { kind: 'draw-guess', drawer: this.drawer, drawerIdx: this.drawerIdx, totalDrawers: this.order.length, strokes: this.strokes, scores: this.scores, phase: this.phase, order: this.order, players: this.players }; }
  getState() { return { currentPlayerId: null, finished: this.isFinished(), view: { ...this.baseView(), word: null } }; }
  getStateFor(playerId) { return { currentPlayerId: null, finished: this.isFinished(), view: { ...this.baseView(), word: playerId === this.drawer ? this.word : null } }; }
  timeoutHint() { return this.phase === 'drawing' ? { mode: 'global', ms: 15000 } : null; }
  onGlobalTimeout() { if (this.phase === 'drawing') this.nextDrawer(); }
  aiAction(pid) { if (pid === this.drawer) return null; return { type: 'guess', text: this.word }; }
  destroy() {}
}

// ============ 谁是卧底（3-4 人，结算型） ============
const WORD_PAIRS = [
  ['苹果', '梨'], ['猫', '老虎'], ['太阳', '月亮'], ['红色', '粉色'], ['大海', '湖泊'], ['飞机', '火箭'],
  ['自行车', '汽车'], ['西瓜', '冬瓜'], ['钢琴', '吉他'], ['医生', '护士'], ['老师', '教练'], ['雪', '霜'],
  ['星星', '火星'], ['糖果', '巧克力'], ['警察', '保安'], ['国王', '皇帝'], ['山顶', '山坡'], ['河流', '小溪'],
  ['面包', '馒头'], ['牛奶', '豆浆'], ['眼镜', '墨镜'], ['钥匙', '锁'], ['雨', '雪'], ['风', '雨'],
  ['手机', '电脑'], ['帽子', '头盔'], ['鞋子', '靴子'], ['铅笔', '钢笔'], ['蝴蝶', '蜜蜂'], ['玫瑰', '月季'],
  ['金鱼', '鲤鱼'], ['猴子', '猩猩'], ['兔子', '老鼠'], ['橘子', '橙子'], ['云', '雾'], ['火', '灯'],
  ['桥', '路'], ['船', '艇'], ['钟', '表'], ['碗', '盘'], ['沙发', '椅子'], ['电视', '收音机'],
  ['冰箱', '柜子'], ['牙刷', '梳子'], ['枕头', '被子'], ['窗帘', '门帘'], ['公园', '花园'], ['学校', '书店'],
  ['医院', '诊所'], ['餐厅', '食堂'], ['电影院', '剧场'],
];
class Undercover {
  constructor() { this.immediate = false; this.gameId = 'undercover'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    const pair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
    this.undercoverId = this.order[Math.floor(Math.random() * this.order.length)];
    this.words = {}; this.order.forEach((id) => (this.words[id] = id === this.undercoverId ? pair[1] : pair[0]));
    this.phase = 'describe'; this.descIndex = 0; this.round = 1; this.descLog = []; this.votes = {}; this.out = null;
  }
  start() {}
  getCurrentPlayerId() { return this.phase === 'describe' ? this.order[this.descIndex] : null; }
  onPlayerAction(pid, action) {
    if (this.phase === 'describe') {
      if (pid !== this.order[this.descIndex]) return;
      if (action.type !== 'timeout') this.descLog.push({ id: pid, text: action.text || '' });
      this.descIndex++;
      if (this.descIndex >= this.order.length) { if (this.round >= 2) this.phase = 'vote'; else { this.round++; this.descIndex = 0; } }
    } else if (this.phase === 'vote') {
      if (this.votes[pid] !== undefined) return;
      this.votes[pid] = action.vote;
      if (this.order.every((id) => this.votes[id] !== undefined)) this.resolveVote();
    }
  }
  resolveVote() {
    const cnt = {}; this.order.forEach((id) => (cnt[id] = 0));
    for (const id in this.votes) if (this.votes[id]) cnt[this.votes[id]]++;
    let max = -1, ties = [];
    for (const id of this.order) { if (cnt[id] > max) { max = cnt[id]; ties = [id]; } else if (cnt[id] === max) ties.push(id); }
    this.out = ties[Math.floor(Math.random() * ties.length)];
    this.phase = 'done';
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    const civWin = this.out !== this.undercoverId;
    const winners = civWin ? this.order.filter((id) => id !== this.undercoverId) : [this.undercoverId];
    const losers = civWin ? [this.undercoverId] : this.order.filter((id) => id !== this.undercoverId);
    const effects = [];
    winners.forEach((id) => effects.push({ playerId: id, type: 'forward', value: 3 }));
    losers.forEach((id) => effects.push({ playerId: id, type: 'backward', value: 2 }));
    return { winner: winners, effects, details: [] };
  }
  baseView() { return { kind: 'undercover', phase: this.phase, round: this.round, descIndex: this.descIndex, descLog: this.descLog, votes: this.votes, order: this.order, players: this.players }; }
  getState() { return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { ...this.baseView(), myWord: null, isUndercover: null } }; }
  getStateFor(playerId) { return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { ...this.baseView(), myWord: this.words[playerId], isUndercover: playerId === this.undercoverId } }; }
  timeoutHint() { return this.phase === 'describe' ? { mode: 'turn', ms: 15000 } : (this.phase === 'vote' ? { mode: 'global', ms: 10000 } : null); }
  onGlobalTimeout() {
    if (this.phase === 'describe') { this.descIndex++; if (this.descIndex >= this.order.length) { if (this.round >= 2) this.phase = 'vote'; else { this.round++; this.descIndex = 0; } } }
    else if (this.phase === 'vote') { for (const id of this.order) if (this.votes[id] === undefined) this.votes[id] = this.order[Math.floor(Math.random() * this.order.length)]; this.resolveVote(); }
  }
  aiAction(pid) {
    if (this.phase === 'describe') return { text: '我觉得它……' };
    if (this.phase === 'vote') { const others = this.order.filter((id) => id !== pid); return { vote: others[Math.floor(Math.random() * others.length)] }; }
    return null;
  }
  destroy() {}
}

registerGame({ meta: { id: 'number-hunter', name: '数字猎人', description: '系统随机 1-100，两人轮流猜，提示大/小，先猜中胜。胜者获护盾。', rules: '系统随机生成 1-100 之间的整数，两人轮流猜测。每次猜测后系统提示“大了”或“小了”以缩小范围，先猜中正确数字者获胜。每人每次限时 10 秒，超时跳过该回合。胜者获得护盾道具（下次被撞机回起点时抵消一次）。', minPlayers: 2, maxPlayers: 2, supports: (n) => n === 2 }, create: () => new NumberHunter() });
registerGame({ meta: { id: 'number-bomb', name: '数字炸弹', description: '1-50 设炸弹，轮流报数，报中者输，其余胜。踩中后退 3，其余前进 2。', rules: '系统在 1-50 之间设定一个炸弹数字。玩家轮流报一个数字，系统根据报数缩小安全范围（如炸弹是 37，有人报 20 则提示 21-50 安全）。报中炸弹数字者被炸输，其余玩家获胜。踩中炸弹者后退 3 格，其余玩家各前进 2 格。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new NumberBomb() });
registerGame({ meta: { id: 'draw-guess', name: '你画我猜', description: '系统给 1 人词语，其作画 15 秒，其余猜。猜对者与画画者各 +1 分。轮流画完，最高分胜。', rules: '系统随机给 1 名玩家一个词语，该玩家在画板上作画（限时 15 秒，不能写字）。其余玩家在输入框猜测，猜对者与画画者各得 1 分。每人轮流担任画画者一次，所有玩家画完后总分最高者获胜，前进 4 格；其余玩家按得分各前进 1-2 格。', minPlayers: 3, maxPlayers: 4, supports: (n) => n >= 3 && n <= 4 }, create: () => new DrawGuess() });
registerGame({ meta: { id: 'undercover', name: '谁是卧底', description: '分发相似词，1 人卧底。轮流描述后投票，卧底出局则平民胜。', rules: '系统给所有玩家分发词语，多数拿到相同词，1 人拿到相似词（卧底）。3 人局 2 平民 + 1 卧底，4 人局 3 平民 + 1 卧底。每人轮流用文字描述自己的词（不能直接说词），描述两轮后投票，得票最多者出局。若卧底出局则平民胜，若平民出局则卧底胜。胜方每人前进 3 格，败方每人后退 2 格。', minPlayers: 3, maxPlayers: 4, supports: (n) => n >= 3 && n <= 4 }, create: () => new Undercover() });
