// 反应 / 抢答 / 选择类小游戏：极速猜拳 / 反应拍灯 / 抢答挑战
import { registerGame } from './registry.js';

function rollDie() { return 1 + Math.floor(Math.random() * 6); }
const RPS_CHOICES = ['rock', 'scissors', 'paper'];
function rpsWin(a, b) {
  return (a === 'rock' && b === 'scissors') || (a === 'scissors' && b === 'paper') || (a === 'paper' && b === 'rock');
}

// ============ 极速猜拳（2 人，结算型，三局两胜） ============
class RPS {
  constructor() { this.immediate = false; this.gameId = 'rps'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.scores = {}; this.order.forEach((id) => (this.scores[id] = 0));
    this.round = 1; this.submitted = {}; this.curChoices = {}; this.phase = 'play'; this.answered = 0;
  }
  start() {}
  getCurrentPlayerId() { return null; }
  onPlayerAction(pid, action) {
    if (this.phase !== 'play' || this.submitted[pid]) return;
    this.submitted[pid] = true;
    this.curChoices[pid] = action.type === 'timeout' ? 'timeout' : action.choice;
    if (this.order.every((id) => this.submitted[id])) this.resolveRound();
  }
  resolveRound() {
    const [a, b] = this.order;
    const ca = this.curChoices[a], cb = this.curChoices[b];
    if (ca !== 'timeout' && cb !== 'timeout' && ca !== cb) {
      if (rpsWin(ca, cb)) this.scores[a]++; else this.scores[b]++;
    }
    this.answered++;
    this.submitted = {}; this.curChoices = {};
    if (this.scores[a] >= 2 || this.scores[b] >= 2 || this.answered >= 3) this.phase = 'done';
    else this.round++;
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    const [a, b] = this.order;
    let w = null;
    if (this.scores[a] > this.scores[b]) w = a; else if (this.scores[b] > this.scores[a]) w = b;
    return { winner: w ? [w] : [], effects: w ? [{ playerId: w, type: 'forward', value: 3 }] : [], details: [{ playerId: a, name: `${this.scores[a]}胜` }, { playerId: b, name: `${this.scores[b]}胜` }] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'rps', scores: this.scores, round: this.round, submitted: this.submitted, phase: this.phase, order: this.order } };
  }
  timeoutHint() { return this.phase === 'play' ? { mode: 'global', ms: 3000 } : null; }
  onGlobalTimeout() {
    for (const id of this.order) if (!this.submitted[id]) { this.submitted[id] = true; this.curChoices[id] = 'timeout'; }
    if (this.order.every((id) => this.submitted[id])) this.resolveRound();
  }
  aiAction() { return { choice: RPS_CHOICES[Math.floor(Math.random() * 3)] }; }
  destroy() {}
}

// ============ 反应拍灯（2-4 人，结算型） ============
class ReactLight {
  constructor() { this.immediate = false; this.gameId = 'react-light'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.scores = {}; this.order.forEach((id) => (this.scores[id] = 0));
    this.aiCooldown = {}; // 限制 AI 点击频率，避免 room.scheduleMiniParticipants 重复调度导致分数爆炸
    this.colors = this.players.map((p) => p.color);
    this.light = null; // 初始熄灭
    this.lastSwitch = 0; // 触发首次 _refreshLight 立即亮灯，避免开局长时间黑屏
    this.switchInterval = 700 + Math.floor(Math.random() * 800); // 0.7-1.5s 切换
    this.phase = 'play';
    this._refreshLight();
    if (!this.light) this.light = this.colors[Math.floor(Math.random() * this.colors.length)]; // 兜底：开局必定先亮一盏
  }
  start() {}
  getCurrentPlayerId() { return null; }
  _refreshLight() {
    if (this.phase !== 'play') return;
    const now = Date.now();
    if (now - this.lastSwitch < this.switchInterval) return;
    // 25% 概率熄灭，75% 概率随机亮起某个玩家颜色
    this.light = Math.random() < 0.25 ? null : this.colors[Math.floor(Math.random() * this.colors.length)];
    this.lastSwitch = now;
    this.switchInterval = 500 + Math.floor(Math.random() * 900);
  }
  onPlayerAction(pid, action) {
    if (this.phase !== 'play' || action.type === 'timeout') return;
    this._refreshLight();
    const myColor = this.players.find((p) => p.id === pid).color;
    // 正确：灯亮且为自己的颜色
    if (this.light && action.color === myColor && myColor === this.light) {
      this.scores[pid] = (this.scores[pid] || 0) + 1;
    } else {
      this.scores[pid] = (this.scores[pid] || 0) - 1;
    }
    if (this.scores[pid] >= 3) this.phase = 'done';
    else this._refreshLight(); // 点击后立刻换灯，增加节奏感
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    let best = -1, bid = null;
    for (const id of this.order) if (this.scores[id] > best) { best = this.scores[id]; bid = id; }
    return { winner: bid ? [bid] : [], effects: bid ? [{ playerId: bid, type: 'double' }] : [], details: this.order.map((id) => ({ playerId: id, name: `${this.scores[id] || 0}分` })) };
  }
  getState() {
    return { currentPlayerId: null, finished: this.isFinished(), view: { kind: 'react-light', scores: this.scores, light: this.light, phase: this.phase, players: this.players, order: this.order } };
  }
  // 由 room.startMiniTick 周期性调用，自主切换灯（亮/灭/随机颜色），不再依赖玩家点击才刷新
  tick() { this._refreshLight(); }
  timeoutHint() { return this.phase === 'play' ? { mode: 'global', ms: 30000 } : null; }
  onGlobalTimeout() { this.phase = 'done'; }
  aiAction(pid) {
    const myColor = this.players.find((p) => p.id === pid).color;
    // 只有自己的颜色亮起时才点击；否则返回 null，避免无意义扣分与 handleMiniAction 死循环
    if (this.light !== myColor) return null;
    const now = Date.now();
    if (this.aiCooldown[pid] && now - this.aiCooldown[pid] < 500) return null;
    this.aiCooldown[pid] = now;
    return { color: myColor };
  }
  destroy() {}
}

// ============ 抢答挑战（2-4 人，结算型） ============
const QUIZ = [
  { q: '一年有多少个月份？', a: 'B', opts: ['10', '12', '11', '13'] },
  { q: '太阳从哪个方向升起？', a: 'A', opts: ['东', '西', '南', '北'] },
  { q: '“一加一”在什么情况下不等于二？', a: 'C', opts: ['永远等于二', '算错时', '算错或二进制', '从不等于'] },
  { q: '哪种动物被称为“森林之王”？', a: 'B', opts: ['老虎', '狮子', '大象', '熊'] },
  { q: '地球上最大的海洋是？', a: 'D', opts: ['大西洋', '印度洋', '北冰洋', '太平洋'] },
  { q: '彩虹通常有几种颜色？', a: 'C', opts: ['5', '6', '7', '8'] },
  { q: '“画蛇添足”比喻？', a: 'A', opts: ['多此一举', '锦上添花', '雪中送炭', '画龙点睛'] },
  { q: '蜜蜂采集什么来酿蜜？', a: 'B', opts: ['树叶', '花蜜', '露水', '果汁'] },
  { q: '人体最大的器官是？', a: 'C', opts: ['心脏', '肝脏', '皮肤', '肺'] },
  { q: '“守株待兔”告诉我们？', a: 'A', opts: ['不能死等侥幸', '要勤快种树', '兔子很多', '株很好爬'] },
  { q: '一天有多少小时？', a: 'B', opts: ['12', '24', '36', '48'] },
  { q: '哪种水果“上火”常被认为？', a: 'A', opts: ['荔枝', '苹果', '梨', '西瓜'] },
  { q: '北斗七星形状像？', a: 'C', opts: ['圆形', '方形', '勺子', '三角形'] },
  { q: '“亡羊补牢”意思是？', a: 'B', opts: ['丢羊活该', '出问题后及时补救', '不补也行', '羊圈重要'] },
  { q: '水的固态叫什么？', a: 'A', opts: ['冰', '汽', '霜', '露'] },
  { q: '钢琴属于哪类乐器？', a: 'D', opts: ['弦乐', '管乐', '打击乐', '键盘乐器'] },
  { q: '“井底之蛙”比喻？', a: 'A', opts: ['见识短浅', '住得低', '水性好', '很安静'] },
  { q: '光的速度大约每秒？', a: 'C', opts: ['3百公里', '3千公里', '30万公里', '3万公里'] },
  { q: '端午节为纪念谁？', a: 'B', opts: ['李白', '屈原', '杜甫', '苏轼'] },
  { q: '“对牛弹琴”指？', a: 'D', opts: ['牛爱音乐', '琴很好听', '说话不看对象', '牛很聪明'] },
  { q: '树木通过什么制造氧气？', a: 'A', opts: ['光合作用', '呼吸', '开花', '结果'] },
  { q: '企鹅主要生活在？', a: 'C', opts: ['沙漠', '热带雨林', '南极', '草原'] },
  { q: '“滴水穿石”说明？', a: 'B', opts: ['水很硬', '持之以恒的力量', '石很软', '雨很大'] },
  { q: '长城位于哪个国家？', a: 'A', opts: ['中国', '印度', '埃及', '希腊'] },
  { q: '“杯弓蛇影”比喻？', a: 'C', opts: ['喝酒高兴', '疑神疑鬼', '弓很强', '蛇很怕'] },
  { q: '猫的听觉主要依靠？', a: 'D', opts: ['眼睛', '鼻子', '尾巴', '耳朵'] },
  { q: '“愚公移山”赞美？', a: 'A', opts: ['坚持不懈', '力气大', '山很小', '会挖土'] },
  { q: '雪花通常是几角形？', a: 'B', opts: ['五角', '六角', '八角', '四角'] },
  { q: '“破釜沉舟”表示？', a: 'C', opts: ['造船', '退路很多', '不留退路决一死战', '沉船观光'] },
  { q: '植物进行光合作用主要需要？', a: 'A', opts: ['阳光', '月亮', '风', '声音'] },
];
class QuizThree {
  constructor() { this.immediate = false; this.gameId = 'quiz-three'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.scores = {}; this.order.forEach((id) => (this.scores[id] = 0));
    this.total = 6; // 固定一轮 6 题，6 题后比总分（不再「先到 2 分提前胜」，保证稳定出满 6 题）
    this.qIndex = 0; this.answered = 0; this.buzzed = null; this.phase = 'ask';
    this.bag = this._shuffleIndices(QUIZ.length); // 每局题目顺序随机，避免每局都从同一题开始
    this.loadQ();
  }
  start() {}
  loadQ() {
    const base = QUIZ[this.bag[this.qIndex % this.bag.length]];
    this.curQ = this._shuffleOptions(base); // 题目顺序随机 + 每题选项位置随机
  }
  _shuffleIndices(n) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  _shuffleOptions(q) {
    const idx = [0, 1, 2, 3];
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const oldCorrect = 'ABCD'.indexOf(q.a);
    return { q: q.q, a: 'ABCD'[idx.indexOf(oldCorrect)], opts: idx.map((k) => q.opts[k]) };
  }
  getCurrentPlayerId() { return this.phase === 'answer' ? this.buzzed : null; }
  onPlayerAction(pid, action) {
    if (this.phase === 'ask') {
      if (action.type === 'buzz') { this.buzzed = pid; this.phase = 'answer'; }
    } else if (this.phase === 'answer') {
      if (pid !== this.buzzed) return;
      if (action.answer === this.curQ.a) this.scores[pid] = (this.scores[pid] || 0) + 1;
      else this.scores[pid] = (this.scores[pid] || 0) - 1;
      this.afterQ();
    }
  }
  afterQ() {
    this.answered++;
    if (this.answered >= this.total) { this.phase = 'done'; return; }
    this.qIndex++; this.buzzed = null; this.phase = 'ask'; this.loadQ();
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    let best = -1, bid = null;
    for (const id of this.order) if (this.scores[id] > best) { best = this.scores[id]; bid = id; }
    return { winner: bid ? [bid] : [], effects: bid ? [{ playerId: bid, type: 'forward', value: 3 }] : [], details: [{ playerId: bid, name: `${best}分` }] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'quiz-three', phase: this.phase, q: this.curQ, qIndex: this.qIndex, total: this.total, answered: this.answered, scores: this.scores, buzzed: this.buzzed, order: this.order } };
  }
  timeoutHint() { return this.phase === 'ask' ? { mode: 'global', ms: 15000 } : (this.phase === 'answer' ? { mode: 'turn', ms: 10000 } : null); }
  onGlobalTimeout() {
    if (this.phase === 'ask') { this.answered++; if (this.answered >= this.total) this.phase = 'done'; else { this.qIndex++; this.buzzed = null; this.phase = 'ask'; this.loadQ(); } }
  }
  aiAction(pid) {
    if (this.phase === 'ask') return { buzz: true };
    if (this.phase === 'answer' && this.buzzed === pid) return { answer: Math.random() < 0.7 ? this.curQ.a : ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)] };
    return null;
  }
  destroy() {}
}

// ============ 小游戏注册 ============
registerGame({ meta: { id: 'rps', name: '极速猜拳', description: '石头剪刀布三局两胜，每局限时 3 秒，超时弃权判负。胜者前进 3 格。', rules: '两人石头剪刀布，三局两胜。每局系统倒计时 3 秒，需在结束前选择；超时未选视为本局弃权判负。先赢两局者获胜，胜者前进 3 格。', minPlayers: 2, maxPlayers: 2, supports: (n) => n === 2 }, create: () => new RPS() });
registerGame({ meta: { id: 'react-light', name: '反应拍灯', description: '亮灯时点对应自己颜色的按钮，正确 +1 错/提前 -1，先到 3 分胜。胜者下回合可重掷 1 次。', rules: '屏幕中央随机亮起某玩家颜色的灯，玩家需在灯亮时点击"自己的颜色"按钮。点对自己颜色 +1 分，点错或提前点 -1 分。先达到 3 分者获胜（总时长不超过 30 秒），胜者下回合掷骰子可重掷 1 次。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new ReactLight() });
registerGame({ meta: { id: 'quiz-three', name: '抢答挑战', description: '趣味选择题抢答，先按下者答题，答对 +1 答错 -1，固定 6 题，6 题后比分高者胜。胜者前进 3 格。', rules: '系统出一道选择题，题目出现后玩家可随时用自己颜色按钮抢答。先按下者获得答题权，答对得 1 分、答错扣 1 分并换下一题。固定共 6 道题，全部答完后比分最高者获胜。胜者前进 3 格。', minPlayers: 2, maxPlayers: 4, supports: (n) => n >= 2 && n <= 4 }, create: () => new QuizThree() });
