// 集成测试（确定性）：两个电脑玩家自动对局，强制每次掷骰为 6，
// 验证 roll/move/回合轮转/AI 调度/3连6作废 都能正常推进、不卡死。
import { Room } from './room.js';

const states = [];
const room = new Room('T', (rid, msg) => states.push(msg));

room.addPlayer('A', true);
room.addPlayer('B', true);

const origRandom = Math.random;
Math.random = () => 0.99; // floor(0.99*6)=5 -> +1 = 6，强制每次掷出 6

let maxActive = 0;
room.start();

const timer = setInterval(() => {
  let active = 0;
  for (const p of room.players) for (const pl of p.planes) if (pl.state !== 'base') active++;
  if (active > maxActive) maxActive = active;
}, 150);

setTimeout(() => {
  Math.random = origRandom;
  clearInterval(timer);
  const ok = maxActive >= 2 && room.phase === 'playing' && states.length > 5;
  if (ok) {
    console.log(`✓ 集成测试通过：AI 自动对局推进正常，最多 ${maxActive} 架飞机离基地，广播 ${states.length} 次，未卡死`);
    process.exit(0);
  } else {
    console.log(`✗ 集成测试失败：maxActive=${maxActive}, phase=${room.phase}, 广播=${states.length}`);
    process.exit(1);
  }
}, 6000);
