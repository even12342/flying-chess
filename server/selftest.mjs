// 规则自测：验证起飞、前进、反弹、到达、撞机、胜利判定
import { legalMovesFor, applyMoveToPlane, resolveCapture } from './rules.js';

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + name);
  } else {
    fail++;
    console.log('  ✗ ' + name);
  }
}

console.log('合法走子:');
{
  // 全部在基地，掷 6 -> 4 架都能起飞；掷 3 -> 无棋可走
  const p = { color: 'red', planes: Array.from({ length: 4 }, () => ({ state: 'base', step: -1 })) };
  assert('掷6可起飞(4架合法)', legalMovesFor(p, 6).length === 4);
  assert('掷3不能起飞(0架合法)', legalMovesFor(p, 3).length === 0);
}
{
  // 一架在轨道(step 10)，掷 3 -> 该架合法
  const p = { color: 'red', planes: [{ state: 'active', step: 10 }, ...Array.from({ length: 3 }, () => ({ state: 'base', step: -1 }))] };
  assert('轨道上飞机可走', legalMovesFor(p, 3).includes(0));
}

console.log('移动/反弹/到达:');
{
  const pl = { state: 'base', step: -1 };
  applyMoveToPlane(pl, 6); // 起飞
  assert('起飞到 step 0', pl.state === 'active' && pl.step === 0);
}
{
  const pl = { state: 'active', step: 56 };
  applyMoveToPlane(pl, 1); // 56+1=57 精确到达终点
  assert('精确到达终点', pl.state === 'done' && pl.step === 57);
}
{
  const pl = { state: 'active', step: 55 };
  applyMoveToPlane(pl, 3); // 55+3=58 超过 -> 反弹 57-(58-57)=56
  assert('超过终点反弹', pl.state === 'active' && pl.step === 56);
}
{
  const pl = { state: 'active', step: 56 };
  applyMoveToPlane(pl, 4); // 56+4=60 超过 -> 反弹 57-(60-57)=54
  assert('末端大幅超过反弹', pl.state === 'active' && pl.step === 54);
}

console.log('撞机:');
{
  // 红方飞机在 step0(主轨道格0)；蓝方飞机 step13 -> (39+13)%52 = 0，同格
  const players = [
    { color: 'red', planes: [{ state: 'active', step: 0 }] },
    { color: 'blue', planes: [{ state: 'active', step: 13 }] },
  ];
  const captured = resolveCapture(players, { state: 'active', step: 0, color: 'red' });
  assert('蓝方被撞回基地', captured.length === 1 && players[1].planes[0].state === 'base');
}
{
  // 同色不互撞
  const players = [
    { color: 'red', planes: [{ state: 'active', step: 0 }, { state: 'active', step: 0 }] },
  ];
  const captured = resolveCapture(players, { state: 'active', step: 0, color: 'red' });
  assert('同色不互撞', captured.length === 0);
}
{
  // 在回家通道(step 52)不撞机
  const players = [
    { color: 'red', planes: [{ state: 'active', step: 52 }] },
    { color: 'blue', planes: [{ state: 'active', step: 13 }] },
  ];
  const captured = resolveCapture(players, { state: 'active', step: 52, color: 'red' });
  assert('回家通道不撞机', captured.length === 0);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
