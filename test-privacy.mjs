// 私有数据按玩家下发测试：直接驱动 Room 跑一个私有小游戏（UNO），
// 校验 broadcastMiniState 为每个玩家发送 getStateFor，且不含他人完整手牌（不泄露）。
import { Room } from './server/room.js';
import { MINI_GAMES } from './server/minigame/registry.js';

const unoDef = MINI_GAMES.find((g) => g.meta.id === 'uno');
if (!unoDef) { console.error('未找到 uno 定义'); process.exit(1); }

// 捕获按 playerId 下发的消息
const captured = {}; // playerId -> 最近一次 minigame:state 的 state
const broadcast = (roomId, msg, playerId) => {
  if (msg.type === 'minigame:state' && playerId) captured[playerId] = msg.state;
};

const room = new Room('TEST', broadcast);
room.addPlayer('A'); room.addPlayer('B'); room.addPlayer('C'); room.addPlayer('D');
room.start();

// 手动注入一个 UNO 小游戏
const uno = unoDef.create();
uno.init(room.players, room.getState());
uno.start();
room.phase = 'minigame';
room.mini = uno;
room.miniName = unoDef.meta.name;
room.broadcastMiniState();

let fail = 0;
const pids = room.players.map((p) => p.id);
for (const pid of pids) {
  const s = captured[pid];
  if (!s || !s.view) { console.log(`✗ ${pid} 未收到私有状态`); fail++; continue; }
  // 不能泄露他人完整手牌
  if (s.view.hands) { console.log(`✗ ${pid} 视图泄露了他人完整手牌(hands)`); fail++; }
  // 必须包含自己的手牌
  if (!Array.isArray(s.view.myHand)) { console.log(`✗ ${pid} 缺少 myHand`); fail++; }
  // 公共信息应存在
  if (!s.view.handCounts || !s.view.top) { console.log(`✗ ${pid} 缺少公共信息(handCounts/top)`); fail++; }
  // 每个玩家的 myHand 应当只等于自己手牌（长度相同、内容对应自己）
  const mine = s.view.myHand.length;
  const counts = s.view.handCounts[pid];
  if (mine !== counts) { console.log(`✗ ${pid} myHand 长度(${mine}) != 公开手牌数(${counts})`); fail++; }
}

// 校验不同玩家的 myHand 互不相同（确实是各自私有视图）
const hands = pids.map((id) => JSON.stringify(captured[id].view.myHand));
const uniq = new Set(hands);
console.log(`\n各玩家 myHand 互异数: ${uniq.size} / ${pids.length}`);
if (uniq.size !== pids.length) { console.log('✗ 不同玩家收到相同的 myHand（私有视图错误）'); fail++; }

console.log(fail === 0 ? '\n私有数据按玩家下发测试通过 ✅' : `\n私有数据测试失败：${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
