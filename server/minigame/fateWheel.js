// 小游戏示例：命运转轮
// 规则：转盘分 6 格 —— 前进 3 格 / 后退 2 格 / 与左边玩家换位 / 与右边玩家换位 / 再来一次 / 暂停一轮
// 每位玩家各转一次（"再来一次"则当前玩家再转），结果即时回写到飞行棋。
// 支持 2-4 人。
//
// 统一接口（服务器权威）：
//   init(players, gameState)        初始化，传入玩家列表和当前飞行棋状态快照
//   start()                         开始小游戏
//   onPlayerAction(playerId, action) 处理某玩家操作（命运转轮中 action 仅作触发，结果由服务器随机决定防作弊）
//   getResult()                     返回 { winner:[], effects:[{playerId,type,value}], details }
//   getPendingEffects()             取出并清空"本次操作应即时应用"的效果（即时型游戏用）
//   getCurrentPlayerId()            当前应操作的玩家 id（null 表示任意/全体可提交）
//   isFinished()                    是否所有玩家都完成
//   destroy()                       清理资源
// 说明：getCurrentPlayerId / getPendingEffects / isFinished / destroy 是为通用小游戏框架补充的，
//       命运转轮用它们实现"轮流转盘 + 即时回写"；后续 19 个游戏也遵循同一套。

import { registerGame } from './registry.js';

// 6 格定义（顺序即转盘扇区顺序）
const CELLS = [
  { id: 'forward3', name: '前进 3 格', short: '前进3', type: 'forward', value: 3 },
  { id: 'back2', name: '后退 2 格', short: '后退2', type: 'backward', value: 2 },
  { id: 'swapLeft', name: '与左边玩家换位', short: '换左', type: 'swap', value: 'left' },
  { id: 'swapRight', name: '与右边玩家换位', short: '换右', type: 'swap', value: 'right' },
  { id: 'again', name: '再来一次', short: '再来', type: 'again', value: 0 },
  { id: 'skip', name: '暂停一轮', short: '暂停', type: 'skip', value: 1 },
];

export class FateWheel {
  constructor() {
    this.immediate = true; // 即时应用型：每次转盘结果立即回写棋盘（而非结束时统一回写）
    this.players = [];
    this.order = []; // 座位顺序的玩家 id 列表
    this.idx = 0; // 当前轮到第几位（越界即结束）
    this.results = []; // 每次转盘记录 { playerId, cell, name, effect }
    this.pending = []; // 本次 onPlayerAction 产生的待即时应用效果
  }

  init(players /* , gameState */) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.idx = 0;
  }

  start() {}

  getCurrentPlayerId() {
    return this.idx < this.order.length ? this.order[this.idx] : null;
  }

  onPlayerAction(playerId, /* action */) {
    if (playerId !== this.getCurrentPlayerId()) return; // 仅当前玩家可操作
    const cellIdx = Math.floor(Math.random() * CELLS.length);
    const cell = CELLS[cellIdx];
    let effect = null;
    if (cell.type === 'forward' || cell.type === 'backward' || cell.type === 'skip') {
      effect = { playerId, type: cell.type, value: cell.value };
    } else if (cell.type === 'swap') {
      const other = this.neighbor(playerId, cell.value);
      if (other) effect = { playerId, type: 'swap', value: other };
    }
    this.results.push({ playerId, cell: cellIdx, name: cell.name, effect });
    this.pending = effect ? [effect] : [];
    if (cell.type === 'again') {
      // 再来一次：不推进 idx，当前玩家再转
    } else {
      this.idx++;
    }
  }

  // 取出并清空本次待即时应用效果（manager 取走后立即 apply 到棋盘）
  getPendingEffects() {
    const p = this.pending;
    this.pending = [];
    return p;
  }

  isFinished() {
    return this.idx >= this.order.length;
  }

  // 返回结果：effects 含每次产生的效果（即时型已回写，这里仅用于展示/汇总）
  getResult() {
    return {
      winner: [],
      effects: this.results.filter((r) => r.effect).map((r) => r.effect),
      details: this.results.map((r) => ({ playerId: r.playerId, name: r.name })),
    };
  }

  destroy() {}

  // 按座位顺序取左/右邻居
  neighbor(playerId, side) {
    const i = this.order.indexOf(playerId);
    if (i < 0) return null;
    const n = this.order.length;
    const j = side === 'left' ? (i - 1 + n) % n : (i + 1) % n;
    return this.order[j];
  }

  // 给客户端渲染用
  getState() {
    return {
      currentPlayerId: this.getCurrentPlayerId(),
      finished: this.isFinished(),
      view: {
        kind: 'fate-wheel',
        results: this.results.map((r) => ({
          playerId: r.playerId,
          name: r.name,
          cell: r.cell,
          applied: !!r.effect,
        })),
      },
    };
  }
}

registerGame({
  meta: {
    id: 'fate-wheel',
    name: '命运转轮',
    description:
      '转盘分 6 格：前进 3 格 / 后退 2 格 / 与左边玩家换位 / 与右边玩家换位 / 再来一次 / 暂停一轮。每位玩家各转一次，即时生效。',
    minPlayers: 2,
    maxPlayers: 4,
    supports: (n) => n >= 2 && n <= 4,
  },
  create: () => new FateWheel(),
});
