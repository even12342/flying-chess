// 房间与回合状态机（服务器权威）
// 思路：房间持有所有玩家与棋盘状态；任何改变状态的动作都由 Room 的方法执行，
//       执行后通过 broadcast 把完整状态广播给房间内所有人，客户端只负责渲染。
import { COLORS } from './board.js';
import { legalMovesFor, applyMoveToPlane, resolveCapture } from './rules.js';
import { pickMiniGame } from './minigame/registry.js';
import './minigame/all.js'; // 统一引入并注册全部小游戏

let pidCounter = 0;

export class Room {
  constructor(roomId, broadcast) {
    this.roomId = roomId;
    this.broadcast = broadcast; // (roomId, msg) => void
    this.players = [];
    this.phase = 'lobby'; // lobby | playing | minigame | finished
    this.currentTurn = null;
    this.dice = null; // 当前回合已掷出的点数，null 表示还没掷
    this.legalMoves = [];
    this.lastRoll = null; // { playerId, value }
    this.winner = null;
    this.round = 0;
    this.consecutiveSix = 0; // 连续掷出 6 的次数（>=3 作废本回合）
    this.turnsThisRound = 0; // 本轮已轮到的玩家数（含被跳过的），满员即一轮结束
    this.log = [];
    this.hostId = null;
    this.mini = null; // 当前进行中的小游戏实例
    this.miniName = ''; // 当前小游戏名称（供状态快照携带）
    this._miniTimer = null; // 小游戏倒计时定时器
    this._miniTimeoutSig = null; // 当前倒计时对应的阶段签名（避免无操作重置计时器）
    this._miniAITimers = []; // 小游戏内 AI 参与定时器集合
  }

  // ---- 日志（顺带广播）----
  pushLog(s) {
    this.log.push(s);
    if (this.log.length > 12) this.log.shift();
    this.broadcastState();
  }

  // ---- 大厅相关 ----
  addPlayer(name, isAI = false) {
    if (this.players.length >= 4) throw new Error('房间已满');
    const color = COLORS[this.players.length]; // 按加入顺序分配颜色
    const id = 'p' + ++pidCounter;
    const botCount = this.players.filter((p) => p.isAI).length;
    const player = {
      id,
      name: name || (isAI ? '电脑' + (botCount + 1) : '玩家' + (this.players.length + 1)),
      color,
      isAI,
      isHost: this.players.length === 0,
      planes: Array.from({ length: 4 }, () => ({ state: 'base', step: -1 })),
      skipTurns: 0, // 被“暂停一轮”等效果累积的跳过次数
      items: [], // 后续小游戏可能发放的道具
      shield: false, // 护盾：被撞机时免疫一次
      doubleNext: false, // 下次移动双倍步数
    };
    this.players.push(player);
    if (this.players.length === 1) this.hostId = id;
    return player;
  }

  addBot() {
    return this.addPlayer(undefined, true);
  }

  start() {
    if (this.phase !== 'lobby') throw new Error('游戏已开始');
    if (this.players.length < 2) throw new Error('至少需要 2 名玩家');
    this.phase = 'playing';
    this.round = 1;
    this.currentTurn = this.players[0].id;
    this.dice = null;
    this.legalMoves = [];
    this.lastRoll = null;
    this.winner = null;
    this.consecutiveSix = 0;
    this.turnsThisRound = 0;
    this.mini = null;
    this.miniName = '';
    this.pushLog('游戏开始！');
    this.checkAndScheduleAI();
  }

  playerById(id) {
    return this.players.find((p) => p.id === id);
  }

  // ---- 掷骰子 ----
  roll(playerId) {
    if (this.phase !== 'playing') return;
    const player = this.playerById(playerId);
    if (!player || player.id !== this.currentTurn) return;
    if (this.dice !== null) return; // 已掷，等待移动

    const value = 1 + Math.floor(Math.random() * 6);
    this.consecutiveSix = value === 6 ? this.consecutiveSix + 1 : 0;

    // 连续三次 6：本回合作废，直接换手
    if (this.consecutiveSix === 3) {
      this.lastRoll = { playerId, value };
      this.pushLog(`${player.name} 连续三次掷出 6，本回合作废`);
      this.dice = null;
      this.advanceTurn();
      if (this.phase !== 'playing') return;
      this.broadcastState();
      this.checkAndScheduleAI();
      return;
    }

    this.dice = value;
    this.lastRoll = { playerId, value };
    const legal = legalMovesFor(player, value);

    // 没有任何可走的棋：自动跳过
    if (legal.length === 0) {
      this.pushLog(`${player.name} 掷出 ${value}，无棋可走，跳过`);
      this.dice = null;
      this.advanceTurn();
      if (this.phase !== 'playing') return;
      this.broadcastState();
      this.checkAndScheduleAI();
      return;
    }

    this.legalMoves = legal;
    this.pushLog(`${player.name} 掷出 ${value}`);
    this.broadcastState();
    if (player.isAI) this.scheduleAIMove(player);
  }

  // ---- 移动 ----
  move(playerId, planeIndex) {
    if (this.phase !== 'playing') return;
    const player = this.playerById(playerId);
    if (!player || player.id !== this.currentTurn) return;
    if (this.dice === null) return;
    if (!this.legalMoves.includes(planeIndex)) return;

    const plane = player.planes[planeIndex];
    let steps = this.dice;
    if (player.doubleNext) {
      steps = steps * 2;
      player.doubleNext = false;
      this.pushLog(`${player.name} 触发双倍前进！`);
    }
    applyMoveToPlane(plane, steps); // 先移动（含起飞/反弹/到达）
    const captured = resolveCapture(this.players, { ...plane, color: player.color }); // 再判定撞机
    if (captured.length) {
      let knocked = 0;
      for (const c of captured) {
        const victim = this.players.find((p) => p.color === c.color);
        if (victim && victim.shield) {
          victim.shield = false;
          this.pushLog(`${victim.name} 的护盾抵消了一次撞机！`);
        } else knocked++;
      }
      if (knocked > 0) this.pushLog(`${player.name} 撞机，击落 ${knocked} 架！`);
    } else this.pushLog(`${player.name} 移动了飞机`);

    this.dice = null;
    this.legalMoves = [];

    // 胜利判定：4 架全部到达终点
    if (player.planes.every((p) => p.state === 'done')) {
      this.phase = 'finished';
      this.winner = player.id;
      this.pushLog(`${player.name} 获胜！`);
      this.broadcastState();
      return;
    }

    // 掷到 6：同一玩家再掷一次
    if (this.lastRoll && this.lastRoll.value === 6 && this.consecutiveSix < 3) {
      this.broadcastState(); // dice 已清空，currentTurn 不变 -> 客户端显示可再次掷骰
      const cur = player;
      if (cur.isAI) this.scheduleAIRoll(cur);
      return;
    }

    this.advanceTurn();
    if (this.phase !== 'playing') return; // 进入小游戏则等待其结束
    this.broadcastState();
    this.checkAndScheduleAI();
  }

  // ---- 回合轮转 ----
  // 推进一步：切换 currentTurn、重置“连续6”计数、本轮计数 +1
  _step() {
    const idx = this.players.findIndex((p) => p.id === this.currentTurn);
    const next = (idx + 1) % this.players.length;
    this.currentTurn = this.players[next].id;
    this.consecutiveSix = 0; // 换手时重置“连续6”计数（只针对同一玩家的连续回合）
    this.turnsThisRound++;
  }

  // 跳过被“暂停一轮”标记的玩家（可能在轮转中连续跳过多个）
  ensureActiveTurn() {
    let guard = 0;
    while (guard++ < this.players.length) {
      const p = this.playerById(this.currentTurn);
      if (p && p.skipTurns > 0) {
        p.skipTurns--;
        this.pushLog(`${p.name} 暂停一轮`);
        this._step();
      } else break;
    }
  }

  advanceTurn() {
    this._step();
    this.ensureActiveTurn();
    // 一轮结束：所有座位都轮到过一次（含被跳过的） -> 触发回合间小游戏
    if (this.turnsThisRound >= this.players.length && this.phase === 'playing') {
      this.turnsThisRound = 0;
      this.round++;
      this.triggerMiniGame();
    }
  }

  // ---- 小游戏：触发 / 会话 / 回写 ----
  triggerMiniGame() {
    const def = pickMiniGame(this.players.length, Math.random);
    if (!def) {
      // 理论上 2-4 人都有命运转轮可玩；若未来某人数无可用游戏则直接开始下一轮
      this.broadcastState();
      this.checkAndScheduleAI();
      return;
    }
    this.mini = def.create();
    this.mini.init(this.players, this.getState());
    this.mini.start();
    this.phase = 'minigame';
    this.miniName = def.meta.name;
    this.broadcast(this.roomId, {
      type: 'minigame:start',
      gameId: def.meta.id,
      name: def.meta.name,
      description: def.meta.description,
      rules: def.meta.rules || def.meta.description, // 玩法规则（前端规则介绍页展示）
      players: this.players.map((p) => ({ id: p.id, name: p.name, color: p.color, isAI: p.isAI })),
      currentPlayerId: this.mini.getCurrentPlayerId(),
    });
    this._miniTimeoutSig = null;
    this.broadcastMiniState();
    this.scheduleMiniAI();
    this.scheduleMiniParticipants(); // “任意可提交”类游戏（抢答/反应）让 AI 也参与
    if (typeof this.mini.tick === 'function') this.startMiniTick(); // 反应拍灯等需服务端自主推进状态
  }

  broadcastMiniState() {
    if (!this.mini) return;
    const gid = this.miniGameId();
    const cur = this.mini.getCurrentPlayerId();
    const usePrivate = typeof this.mini.getStateFor === 'function';
    for (const p of this.players) {
      // 实现了 getStateFor 的游戏（抓乌龟/UNO/你画我猜/谁是卧底等）按玩家分别下发私有视图，
      // 其余游戏所有玩家收到同一份公开状态。
      const state = usePrivate ? this.mini.getStateFor(p.id) : this.mini.getState();
      this.broadcast(
        this.roomId,
        {
          type: 'minigame:state',
          state,
          currentPlayerId: cur,
          gameId: gid,
        },
        usePrivate ? p.id : undefined
      );
    }
    this.scheduleMiniTimeout(); // 若游戏声明了倒计时，则安排超时
  }

  miniGameId() {
    return this.mini && this.mini.gameId ? this.mini.gameId : null;
  }

  // 客户端/AI 提交一次小游戏操作
  handleMiniAction(playerId, action) {
    if (this.phase !== 'minigame' || !this.mini) return;
    const cur = this.mini.getCurrentPlayerId();
    if (cur && playerId !== cur) return; // 非当前玩家忽略（null 表示任意玩家可提交）
    const before = JSON.stringify(this.mini.getState());
    this.mini.onPlayerAction(playerId, action || {});
    // 即时型游戏：取出本次产生的效果，立即回写到棋盘
    const pend = typeof this.mini.getPendingEffects === 'function' ? this.mini.getPendingEffects() : [];
    for (const e of pend) this.applyEffect(e);
    if (this.mini.isFinished()) {
      this.endMiniGame();
      return;
    }
    const after = JSON.stringify(this.mini.getState());
    // 无效操作（如重复投票 / 已提交后再提交）：不改变状态，无需重播，更不能重置倒计时
    if (after === before && pend.length === 0) return;
    this.broadcastMiniState();
    // 揭示阶段（翻牌类不匹配）：延迟后由游戏自行翻回并换人，期间不安排 AI/参与者
    const revealDelay = typeof this.mini.getRevealDelay === 'function' ? this.mini.getRevealDelay() : 0;
    if (revealDelay) {
      const game = this.mini;
      setTimeout(() => {
        if (this.phase !== 'minigame' || this.mini !== game) return;
        if (typeof game.onRevealTimeout === 'function') game.onRevealTimeout();
        if (this.mini !== game) return;
        if (game.isFinished()) { this.endMiniGame(); return; }
        this.broadcastMiniState();
        this.scheduleMiniAI();
      }, revealDelay);
      return;
    }
    this.scheduleMiniAI();
    this.scheduleMiniParticipants();
  }

  // 为小游戏安排倒计时：游戏通过 timeoutHint() 声明 {mode,ms}，到点触发超时/全局结束。
  // 关键：同一阶段（签名相同）不重复重置计时器，否则“无操作重提交”会让全局超时永远无法触发。
  scheduleMiniTimeout() {
    if (!this.mini || typeof this.mini.timeoutHint !== 'function') return;
    const hint = this.mini.timeoutHint();
    if (!hint) { this.clearMiniTimeout(); return; }
    // MINI_TIMEOUT_SCALE：测试时压缩小游戏等待（默认 1，不影响生产行为）
    const scale = Number(process.env.MINI_TIMEOUT_SCALE) || 1;
    const ms = scale > 0 && scale !== 1 ? Math.max(2000, Math.round(hint.ms * scale)) : hint.ms;
    const sig = hint.mode + ':' + ms + ':' + (this.mini.getCurrentPlayerId() || '');
    if (this._miniTimeoutSig === sig && this._miniTimer) return;
    this.clearMiniTimeout();
    this._miniTimeoutSig = sig;
    this._miniTimer = setTimeout(() => {
      // 超时已触发：立即清空引用，否则签名守卫会误判“定时器仍在”而不重新计时，
      // 导致多回合、靠全局超时推进的小游戏（如反应拍灯/数字猎人）在第一次超时后卡死。
      this._miniTimer = null;
      this._miniTimeoutSig = null;
      if (this.phase !== 'minigame' || !this.mini) return;
      if (hint.mode === 'turn') {
        const cur = this.mini.getCurrentPlayerId();
        if (cur) this.handleMiniAction(cur, { type: 'timeout' });
      } else if (hint.mode === 'global') {
        if (typeof this.mini.onGlobalTimeout === 'function') this.mini.onGlobalTimeout();
        if (this.mini.isFinished()) this.endMiniGame();
        else this.broadcastMiniState();
      }
    }, ms);
  }

  clearMiniTimeout() {
    if (this._miniTimer) { clearTimeout(this._miniTimer); this._miniTimer = null; }
    this._miniTimeoutSig = null;
  }

  // 当前玩家是 AI 时，按游戏类型自动提交合理操作
  scheduleMiniAI() {
    if (this.phase !== 'minigame' || !this.mini) return;
    const cur = this.playerById(this.mini.getCurrentPlayerId());
    if (cur && cur.isAI) {
      setTimeout(() => {
        if (this.phase === 'minigame' && this.mini && this.mini.getCurrentPlayerId() === cur.id) {
          let action = { type: 'spin' }; // 默认（命运转轮）
          if (typeof this.mini.aiAction === 'function') {
            const a = this.mini.aiAction(cur.id);
            if (a) action = a;
          }
          this.handleMiniAction(cur.id, action);
        }
      }, Room.aiDelayMs());
    }
  }

  // “任意可提交”类游戏（currentPlayerId === null，如抢答/反应拍灯）：让 AI 玩家随机延时提交一次
  scheduleMiniParticipants() {
    if (!this.mini || typeof this.mini.getCurrentPlayerId !== 'function') return;
    if (this.mini.getCurrentPlayerId() !== null) return; // 仅“任意可提交”模式
    if (typeof this.mini.aiAction !== 'function') return;
    const ais = this.players.filter((p) => p.isAI);
    ais.forEach((ai) => {
      const delay = 300 + Math.floor(Math.random() * 1400);
      const t = setTimeout(() => {
        if (this.phase !== 'minigame' || !this.mini) return;
        const a = this.mini.aiAction(ai.id);
        if (a) this.handleMiniAction(ai.id, a);
      }, delay);
      this._miniAITimers.push(t);
    });
  }

  clearMiniTimers() {
    this.clearMiniTimeout();
    this.clearMiniTick();
    this._miniAITimers.forEach((t) => clearTimeout(t));
    this._miniAITimers = [];
  }

  // 需要服务端自主推进状态的游戏（如反应拍灯）：周期性 tick 并仅在状态变化时广播，
  // 避免“无事件则不刷新”导致灯长期不亮。仅对声明了 tick() 的游戏启用。
  startMiniTick() {
    this.clearMiniTick();
    this._miniTickTimer = setInterval(() => {
      if (this.phase !== 'minigame' || !this.mini) { this.clearMiniTick(); return; }
      if (typeof this.mini.tick !== 'function') { this.clearMiniTick(); return; }
      const before = JSON.stringify(this.mini.getState());
      this.mini.tick();
      const after = JSON.stringify(this.mini.getState());
      if (after !== before) this.broadcastMiniState();
    }, 200);
  }
  clearMiniTick() {
    if (this._miniTickTimer) { clearInterval(this._miniTickTimer); this._miniTickTimer = null; }
  }

  endMiniGame() {
    this.clearMiniTimers();
    const r = this.mini.getResult();
    // 结算型游戏（immediate=false）在此统一回写；即时型已回写，跳过以免重复
    if (!this.mini.immediate) {
      for (const e of r.effects) this.applyEffect(e);
    }
    this.broadcast(this.roomId, { type: 'minigame:result', result: r });
    this.mini.destroy();
    this.mini = null;
    this.phase = 'playing';

    // 小游戏可能让某玩家 4 机抵达终点 -> 直接判胜利
    const champ = this.players.find((p) => p.planes.every((pl) => pl.state === 'done'));
    if (champ) {
      this.phase = 'finished';
      this.winner = champ.id;
      this.pushLog(`${champ.name} 获胜！`);
      this.broadcastState();
      return;
    }

    this.ensureActiveTurn(); // 小游戏可能新增“暂停一轮”
    this.pushLog('小游戏结束，继续飞行棋');
    this.broadcastState();
    this.checkAndScheduleAI();
  }

  // 把小游戏效果应用到飞行棋
  applyEffect(e) {
    const p = this.playerById(e.playerId);
    if (!p) return;
    if (e.type === 'forward' || e.type === 'backward') {
      const plane = this.frontmostActivePlane(p);
      if (plane) {
        this.movePlaneBy(plane, e.type === 'forward' ? e.value : -e.value);
        this.pushLog(`${p.name}：${e.type === 'forward' ? '前进' : '后退'}${e.value} 格`);
      } else {
        this.pushLog(`${p.name}：无在飞飞机，效果落空`);
      }
    } else if (e.type === 'skip') {
      p.skipTurns += e.value;
      this.pushLog(`${p.name}：暂停 ${e.value} 轮`);
    } else if (e.type === 'item') {
      p.items = p.items || [];
      p.items.push(e.value);
      this.pushLog(`${p.name}：获得道具 ${e.value}`);
    } else if (e.type === 'shield') {
      p.shield = true;
      this.pushLog(`${p.name}：获得护盾（撞机免疫一次）`);
    } else if (e.type === 'double') {
      p.doubleNext = true;
      this.pushLog(`${p.name}：下次移动双倍步数`);
    } else if (e.type === 'disarm') {
      p.shield = false;
      this.pushLog(`${p.name}：护盾被剥夺`);
    } else if (e.type === 'swapRandom') {
      // “与任意玩家换位”：随机挑一名其他玩家交换领先飞机位置
      const others = this.players.filter((q) => q.id !== e.playerId);
      if (others.length) this.swapFrontmost(p, others[Math.floor(Math.random() * others.length)]);
    } else if (e.type === 'swap') {
      const other = this.playerById(e.value);
      if (other) this.swapFrontmost(p, other);
    }
  }

  // 取某玩家“最靠前”的在飞飞机（用于前进/后退/换位的作用对象）
  frontmostActivePlane(p) {
    let best = null;
    for (const pl of p.planes) {
      if (pl.state === 'active' && (!best || pl.step > best.step)) best = pl;
    }
    return best;
  }

  // 移动一架飞机 delta 格（正前进、负后退；后退越界则退回基地）
  movePlaneBy(plane, delta) {
    if (plane.state === 'done') return;
    if (delta > 0) {
      applyMoveToPlane(plane, delta);
    } else {
      const ns = plane.step + delta;
      if (ns < 0) {
        plane.state = 'base';
        plane.step = -1;
      } else {
        plane.step = ns;
      }
    }
  }

  // 交换两名玩家“最靠前”的飞机位置（任一方无在飞飞机则该效果无效）
  swapFrontmost(a, b) {
    const pa = this.frontmostActivePlane(a);
    const pb = this.frontmostActivePlane(b);
    if (!pa || !pb) {
      this.pushLog(`${a.name} 与 ${b.name} 换位：有人无在飞飞机`);
      return;
    }
    const t = { state: pa.state, step: pa.step };
    pa.state = pb.state;
    pa.step = pb.step;
    pb.state = t.state;
    pb.step = t.step;
    this.pushLog(`${a.name} 与 ${b.name} 交换了领先飞机的位置`);
  }

  // 若当前行动者是 AI 且还没掷骰，则调度它自动行动
  checkAndScheduleAI() {
    if (this.phase !== 'playing') return;
    const cur = this.playerById(this.currentTurn);
    if (cur && cur.isAI && this.dice === null) this.scheduleAIRoll(cur);
  }

  scheduleAIRoll(player) {
    setTimeout(() => {
      if (this.phase === 'playing' && this.currentTurn === player.id && this.dice === null) {
        this.roll(player.id);
      }
    }, Room.aiDelayMs());
  }

  scheduleAIMove(player) {
    setTimeout(() => {
      if (this.phase !== 'playing') return;
      if (this.currentTurn !== player.id || this.dice === null) return;
      const idx = this.chooseAIMove(player);
      if (idx != null) this.move(player.id, idx);
    }, Room.aiDelayMs());
  }

  // AI 决策：1) 优先撞机 2) 能起飞则起飞 3) 否则把最靠前的飞机往前推
  chooseAIMove(player) {
    const legal = this.legalMoves;
    let bestCapture = null;
    let bestCaptureCount = 0;
    for (const i of legal) {
      const sim = { ...player.planes[i] };
      applyMoveToPlane(sim, this.dice);
      const cap = resolveCapture(this.players, { ...sim, color: player.color });
      if (cap.length > bestCaptureCount) {
        bestCaptureCount = cap.length;
        bestCapture = i;
      }
    }
    if (bestCapture != null) return bestCapture;

    const baseIdx = legal.find((i) => player.planes[i].state === 'base');
    if (baseIdx != null) return baseIdx;

    let best = null;
    let bestStep = -1;
    for (const i of legal) {
      if (player.planes[i].step > bestStep) {
        bestStep = player.planes[i].step;
        best = i;
      }
    }
    return best;
  }

  // ---- 对外状态快照 ----
  getState() {
    return {
      type: 'state',
      roomId: this.roomId,
      phase: this.phase,
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        isAI: p.isAI,
        isHost: p.isHost,
        doneCount: p.planes.filter((pl) => pl.state === 'done').length,
        skipTurns: p.skipTurns,
        items: p.items,
        shield: p.shield,
        doubleNext: p.doubleNext,
        planes: p.planes.map((pl) => ({ state: pl.state, step: pl.step })),
      })),
      currentTurn: this.currentTurn,
      dice: this.dice,
      legalMoves: this.legalMoves,
      lastRoll: this.lastRoll,
      winner: this.winner,
      round: this.round,
      log: this.log.slice(-8),
      minigame:
        this.phase === 'minigame' && this.mini
          ? {
              name: this.miniName,
              gameId: this.miniGameId(),
              currentPlayerId: this.mini.getCurrentPlayerId(),
              state: this.mini.getState(),
            }
          : null,
    };
  }

  broadcastState() {
    this.broadcast(this.roomId, this.getState());
  }

  // AI 行动间隔（毫秒）。可用环境变量 AI_DELAY_MS 缩短，便于自动化测试；
  // 生产环境默认 800ms，给玩家留阅读/动画时间。
  static aiDelayMs() {
    const v = Number(process.env.AI_DELAY_MS);
    return Number.isFinite(v) && v >= 0 ? v : 800;
  }
}
