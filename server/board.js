// 棋盘逻辑常量（与渲染无关，仅描述“步数”与“格子编号”的映射）
// 思路：每架飞机用 step 表示沿本颜色专属路径前进的格数：
//   step < 0    -> 在基地（停机坪），未起飞
//   step 0..50  -> 在主轨道（共享 52 格大环）上，格子编号 = (起点 + step) % 52
//   step 51..56 -> 在回家通道（每条颜色 6 格，私有）
//   step 57     -> 到达终点（中心）

export const COLORS = ['red', 'yellow', 'blue', 'green'];

export const MAIN_LOOP = 52;   // 主轨道总长
export const MAIN_STEPS = 51;  // 飞机在主轨道上最多走 51 步（step 0..50）
export const HOME_STEPS = 6;   // 回家通道 6 格（step 51..56）
export const FINISH_STEP = 57; // 到达终点

// 四种颜色在主轨道上的“起飞格”编号（每 13 格一个象限，对应十字的四臂）
export const START_INDEX = { red: 0, yellow: 26, blue: 39, green: 13 };

// 把飞机的 step 转成主轨道格子编号（仅当在轨道上：step <= 50 时有效）
export function stepToCell(color, step) {
  return (START_INDEX[color] + step) % MAIN_LOOP;
}
