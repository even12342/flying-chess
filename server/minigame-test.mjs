// 小游戏（命运转轮）集成测试
// 验证：回合检测触发 / 小游戏会话 / 效果回写 / 结束回到飞行棋 / 全 AI 真实对联机流程
import { Room } from './room.js';

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('✗ ' + msg);
    failed++;
  } else {
    console.log('✓ ' + msg);
  }
}

// ---- A. 同步流程 + applyEffect 单测 ----
{
  const events = [];
  const room = new Room('A', (rid, m) => events.push(m));
  room.addPlayer('A');
  room.addPlayer('B');
  room.start();
  // 让 A 有一架在飞飞机，便于验证效果回写
  const pa = room.playerById(room.players[0].id);
  pa.planes[0].state = 'active';
  pa.planes[0].step = 5;

  room.triggerMiniGame();
  assert(room.phase === 'minigame', '触发后进入 minigame 阶段');
  const startEvt = events.find((e) => e.type === 'minigame:start');
  assert(startEvt && startEvt.gameId === 'fate-wheel', 'minigame:start 为命运转轮');

  let guard = 0;
  while (room.phase === 'minigame' && guard++ < 30) {
    const pid = room.mini.getCurrentPlayerId();
    room.handleMiniAction(pid, { type: 'spin' });
  }
  assert(room.phase === 'playing', '小游戏结束后回到 playing');
  assert(room.mini === null, '小游戏实例已清理（destroy）');
  const resEvt = events.find((e) => e.type === 'minigame:result');
  assert(!!resEvt, '收到 minigame:result');
  assert(
    resEvt.result.effects.length >= 2,
    '命运转轮为每位玩家产生至少一次效果 (effects=' + resEvt.result.effects.length + ')'
  );

  // applyEffect 正确性（前进/后退/停一轮）
  const A = room.playerById(room.players[0].id);
  A.planes[0].state = 'active';
  A.planes[0].step = 5;
  A.skipTurns = 0;
  room.applyEffect({ playerId: A.id, type: 'forward', value: 3 });
  assert(A.planes[0].step === 8, '前进3格: 5->8 (实际 ' + A.planes[0].step + ')');
  room.applyEffect({ playerId: A.id, type: 'backward', value: 2 });
  assert(A.planes[0].step === 6, '后退2格: 8->6 (实际 ' + A.planes[0].step + ')');
  room.applyEffect({ playerId: A.id, type: 'skip', value: 1 });
  assert(A.skipTurns === 1, '暂停一轮: skipTurns=1');
}

// ---- B. 全 AI 端到端：真实触发并跑完一次命运转轮 ----
{
  const events = [];
  const room = new Room('B', (rid, m) => events.push(m));
  room.addBot();
  room.addBot();
  room.addBot();
  room.addBot();
  room.start();
  const result = await new Promise((res) => {
    const t = setTimeout(() => res('timeout'), 8000);
    const iv = setInterval(() => {
      const s = events.find((e) => e.type === 'minigame:start');
      const r = events.find((e) => e.type === 'minigame:result');
      if (s && r) {
        clearTimeout(t);
        clearInterval(iv);
        res('ok');
      }
    }, 40);
  });
  assert(result === 'ok', '全 AI 对局真实触发并跑完一次命运转轮');
  assert(
    events.some((e) => e.type === 'minigame:start' && e.gameId === 'fate-wheel'),
    '全 AI: 触发命运转轮'
  );
}

if (failed === 0) {
  console.log('\n✅ 小游戏集成测试全部通过');
  process.exit(0);
} else {
  console.log('\n❌ 有 ' + failed + ' 项失败');
  process.exit(1);
}
