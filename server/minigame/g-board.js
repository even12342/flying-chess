// 棋盘类小游戏：井字闪电战
import { registerGame } from './registry.js';

function rollDie() { return 1 + Math.floor(Math.random() * 6); }
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

// ============ 井字闪电战（2 人，结算型） ============
class TicTac {
  constructor() { this.immediate = false; this.gameId = 'tic-tac'; }
  init(players) {
    this.players = players.map((p) => ({ id: p.id, name: p.name, color: p.color }));
    this.order = this.players.map((p) => p.id);
    this.board = Array(9).fill('');
    this.turn = 0; this.phase = 'play'; this.tieDice = {}; this.winnerSym = null;
  }
  start() {}
  getCurrentPlayerId() { return this.phase === 'play' ? this.order[this.turn] : null; }
  checkWin() {
    for (const [a, b, c] of LINES) if (this.board[a] && this.board[a] === this.board[b] && this.board[a] === this.board[c]) return this.board[a];
    return null;
  }
  randomEmpty() {
    const e = this.board.map((c, i) => (c === '' ? i : -1)).filter((i) => i >= 0);
    return e.length ? e[Math.floor(Math.random() * e.length)] : null;
  }
  onPlayerAction(pid, action) {
    if (this.phase === 'play') {
      if (pid !== this.order[this.turn]) return;
      const idx = action.type === 'timeout' ? this.randomEmpty() : action.idx;
      if (idx == null || this.board[idx] !== '') return;
      this.board[idx] = this.turn === 0 ? 'X' : 'O';
      const w = this.checkWin();
      if (w) { this.winnerSym = w; this.phase = 'done'; }
      else if (this.board.every((c) => c !== '')) this.phase = 'tiebreak';
      else this.turn = 1 - this.turn;
    } else if (this.phase === 'tiebreak') {
      if (action.type === 'timeout' || this.tieDice[pid]) return;
      this.tieDice[pid] = rollDie();
      if (this.order.every((id) => this.tieDice[id])) this.phase = 'done';
    }
  }
  isFinished() { return this.phase === 'done'; }
  getResult() {
    let winner = null;
    if (this.winnerSym) winner = this.winnerSym === 'X' ? this.order[0] : this.order[1];
    else if (this.phase === 'done') {
      const [a, b] = this.order;
      const da = this.tieDice[a] || 0, db = this.tieDice[b] || 0;
      if (da > db) winner = a; else if (db > da) winner = b;
    }
    const loser = winner ? this.order.find((id) => id !== winner) : null;
    return { winner: winner ? [winner] : [], effects: winner && loser ? [{ playerId: winner, type: 'swap', value: loser }] : [], details: [{ playerId: winner, name: '井字胜' }] };
  }
  getState() {
    return { currentPlayerId: this.getCurrentPlayerId(), finished: this.isFinished(), view: { kind: 'tic-tac', board: this.board, turn: this.turn, phase: this.phase, order: this.order, tieDice: this.tieDice } };
  }
  timeoutHint() { return this.phase === 'play' ? { mode: 'turn', ms: 5000 } : null; }
  aiAction(pid) {
    if (this.phase === 'play') {
      const e = this.board.map((c, i) => (c === '' ? i : -1)).filter((i) => i >= 0);
      return { idx: e[Math.floor(Math.random() * e.length)] };
    }
    return { type: 'roll' };
  }
  destroy() {}
}

registerGame({
  meta: { id: 'tic-tac', name: '井字闪电战', description: '3x3 井字棋，连一线胜，每步 5 秒，超时随机落子；平局掷骰决胜。胜者与对方交换位置。', rules: '3×3 网格，两人轮流放 X / O，先将三个己方符号连成一线（横、竖、斜）者获胜。每步限时 5 秒，超时随机落子。若棋盘下满仍平局，双方各掷 1 颗骰子，点数大者胜。胜者可与被击败方交换当前飞行棋位置。', minPlayers: 2, maxPlayers: 2, supports: (n) => n === 2 },
  create: () => new TicTac(),
});
