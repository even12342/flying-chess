// 飞行棋纯规则函数（无副作用设计，便于测试）
import { START_INDEX, MAIN_LOOP, FINISH_STEP } from './board.js';

// 计算某玩家在掷出 dice 后，哪些飞机“可以走”
// 思路：
//   - 基地里的飞机：只有掷到 6 才能起飞
//   - 轨道上/回家通道的飞机：只要 step<=56 就能走（超过终点会反弹，所以永远可走）
//   - 已到达终点的飞机：不可走
export function legalMovesFor(player, dice) {
  const moves = [];
  player.planes.forEach((pl, i) => {
    if (pl.state === 'done') return;
    if (pl.state === 'base') {
      if (dice === 6) moves.push(i);
    } else if (pl.state === 'active') {
      if (pl.step <= 56) moves.push(i); // 主轨道(step<=50) + 回家通道(step 51..56) 都可走；step 57 已到达终点不可走
    }
  });
  return moves;
}

// 只处理单架飞机的移动（起飞 / 前进 / 反弹 / 到达），不含撞机
// 思路：
//   - 基地 -> 起飞到 step 0
//   - 轨道上前进 dice 步；若 target === 57 表示精确到达终点
//   - 若 target > 57 表示超过终点，按“反弹”处理：newStep = 57 - (target - 57)
export function applyMoveToPlane(plane, dice) {
  if (plane.state === 'base') {
    plane.state = 'active';
    plane.step = 0;
    return;
  }
  if (plane.state === 'done') return;
  const target = plane.step + dice;
  if (target > FINISH_STEP) {
    const over = target - FINISH_STEP;
    plane.step = FINISH_STEP - over; // 反弹回来
  } else if (target === FINISH_STEP) {
    plane.state = 'done';
    plane.step = FINISH_STEP;
  } else {
    plane.step = target;
  }
}

// 撞机判定：mover 落点（仅当在主轨道上 step<=50）上的“对方”飞机全部送回基地
// 思路：算出 mover 所在主轨道格子编号，遍历其他玩家仍在主轨道上的飞机，
//       若格子编号相同则判定被撞，状态置回 base。自己同色飞机不互撞。
// 返回被撞飞机列表（用于日志/提示）。
export function resolveCapture(players, mover) {
  if (mover.state !== 'active' || mover.step > 50) return [];
  const cell = (START_INDEX[mover.color] + mover.step) % MAIN_LOOP;
  const captured = [];
  for (const p of players) {
    if (p.color === mover.color) continue; // 同色不撞
    for (const pl of p.planes) {
      if (pl.state === 'active' && pl.step <= 50) {
        const c = (START_INDEX[p.color] + pl.step) % MAIN_LOOP;
        if (c === cell) {
          pl.state = 'base';
          pl.step = -1;
          captured.push({ color: p.color });
        }
      }
    }
  }
  return captured;
}
