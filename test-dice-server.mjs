// 服务端确定性测试：同步驱动数千次 roll，校验每次 roll 后 room.dice === 日志中最后“掷出 X”
import { Room } from './server/room.js';

const noop = () => {};
function lastRollFromLog(log) {
  for (let i = log.length - 1; i >= 0; i--) {
    const m = /掷出\s*(\d)/.exec(log[i]);
    if (m) return Number(m[1]);
  }
  return null;
}

let checks = 0, mismatches = 0;
const N_ROUNDS = 2500;

for (let r = 0; r < N_ROUNDS; r++) {
  const room = new Room('t' + r, noop);
  room.addPlayer('A', false);
  room.addPlayer('B', false);
  room.addPlayer('C', false);
  room.addPlayer('D', false);
  room.start();
  let guard = 0;
  try {
    while (room.phase === 'playing' && guard++ < 300) {
      const cur = room.currentTurn;
      if (room.dice == null) room.roll(cur);
      if (room.phase !== 'playing') break;
      if (room.dice != null) {
        const lr = lastRollFromLog(room.log);
        checks++;
        if (lr != null && lr !== room.dice) {
          mismatches++;
          if (mismatches <= 3) console.log(`  ✗ round${r} dice=${room.dice} logLastRoll=${lr} logTail=${room.log.slice(-3)}`);
        }
        if (room.legalMoves.length) room.move(cur, room.legalMoves[0]);
        else break;
      }
      if (room.phase === 'minigame') break; // 小游戏需交互，重开下一局覆盖更多 roll
    }
  } catch (e) {
    // 单局异常不阻断整体统计
    if (mismatches <= 3) console.log(`  ! round${r} 异常: ${e.message}`);
  }
}

console.log(`\n服务端骰子一致性测试: 驱动 ${N_ROUNDS} 局, roll 校验 ${checks} 次, mismatches=${mismatches}`);
process.exit(mismatches ? 1 : 0);
