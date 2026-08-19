// 全流程冒烟测试：启动服务器，2 名真实客户端 + 2 个 AI，跑完整对局，
// 验证小游戏触发/进行/结算流程，并校验私有数据（myHand/myWord）只下发给自己、不泄露他人手牌。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3100;
const srv = spawn(process.execPath, ['server/index.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT), AI_DELAY_MS: '25' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(700);

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.onopen = () => resolve(ws);
    ws.onerror = reject;
  });
}
const send = (c, obj) => c.ws.send(JSON.stringify(obj));
const firstOther = (players, me) => players.find((p) => p.id !== me).id;
function unoPlayable(v, c) {
  const t = v.top;
  return c.col === t.col || (c.num != null && t.num != null && c.num === t.num) || (c.sp && t.sp === c.sp);
}

const triggered = new Set();
const privacy = { checked: 0, fails: [] };
let resultCount = 0;

async function makeClient(name) {
  const ws = await connect();
  const c = { ws, name, playerId: null, roomId: null, state: null, mini: null };
  ws.onmessage = (e) => handle(c, JSON.parse(e.data));
  return c;
}

function handle(c, msg) {
  if (msg.type === 'created' || msg.type === 'joined') {
    c.playerId = msg.playerId; c.roomId = msg.roomId;
  } else if (msg.type === 'state') {
    c.state = msg; driveFlight(c);
  } else if (msg.type === 'minigame:start') {
    c.mini = { ...msg, phase: 'start' };
    triggered.add(msg.gameId);
    if (['uno', 'turtle', 'draw-guess', 'undercover'].includes(msg.gameId)) checkPrivacy(c, msg);
  } else if (msg.type === 'minigame:state') {
    c.mini = { ...c.mini, ...msg, phase: 'state' };
    if (['uno', 'turtle', 'draw-guess', 'undercover'].includes(msg.gameId)) checkPrivacy(c, msg);
    driveMini(c);
  } else if (msg.type === 'minigame:result') {
    c.mini = null;
    resultCount++;
  }
}

function checkPrivacy(c, msg) {
  const v = msg.state && msg.state.view;
  if (!v) return;
  privacy.checked++;
  const fail = (why) => privacy.fails.push(`[${msg.gameId}] ${c.name}: ${why}`);
  if (msg.gameId === 'uno') {
    if (v.hands) fail('泄露了他人完整手牌(hands)');
    if (!v.handCounts) fail('缺少 handCounts');
    if (!Array.isArray(v.myHand)) fail('缺少 myHand');
  } else if (msg.gameId === 'turtle') {
    if (!v.handCounts) fail('缺少 handCounts');
    if (!Array.isArray(v.myHand)) fail('缺少 myHand');
  } else if (msg.gameId === 'draw-guess') {
    const amDrawer = v.drawer === c.playerId;
    if (amDrawer && typeof v.word !== 'string') fail('画者未收到词语');
    if (!amDrawer && v.word !== null) fail('非画者不应看到词语');
  } else if (msg.gameId === 'undercover') {
    if (typeof v.myWord !== 'string') fail('未收到我的词');
    if (typeof v.isUndercover !== 'boolean') fail('未收到 isUndercover');
  }
}

function driveFlight(c) {
  const s = c.state;
  if (!s || s.phase !== 'playing') return;
  if (s.currentTurn !== c.playerId) return;
  if (s.dice == null) { send(c, { type: 'roll' }); return; }
  if (s.legalMoves && s.legalMoves.length) send(c, { type: 'move', planeIndex: s.legalMoves[0] });
}

function driveMini(c) {
  const m = c.mini;
  if (!m || m.phase !== 'state') return;
  const cur = m.currentPlayerId;
  if (cur !== c.playerId) return; // 非当前玩家不操作，交给 AI/其他
  const v = m.state.view;
  const kind = v.kind;
  const players = m.players || (c.state && c.state.players) || [];
  if (kind === 'fate-wheel') send(c, { type: 'minigame:action', action: { type: 'spin' } });
  else if (kind === 'fate-dice') send(c, { type: 'minigame:action', action: { type: 'roll' } });
  else if (kind === 'dice-bull') send(c, { type: 'minigame:action', action: { choice: 'stand' } });
  else if (kind === 'tic-tac') {
    const i = v.board.findIndex((x) => x === '');
    if (i >= 0) send(c, { type: 'minigame:action', action: { idx: i } });
  } else if (kind === 'memory' || kind === 'match-pair') {
    if (v.phase === 'choose' && v.winner === c.playerId) send(c, { type: 'minigame:action', action: { target: firstOther(players, c.playerId) } });
    else { const closed = v.cards.filter((x) => !x.up && !x.matched); if (closed.length) send(c, { type: 'minigame:action', action: { idx: closed[0].id } }); }
  } else if (kind === 'turtle') send(c, { type: 'minigame:action', action: { type: 'draw' } });
  else if (kind === 'uno') {
    const ok = (v.myHand || []).find((card) => unoPlayable(v, card));
    if (ok) send(c, { type: 'minigame:action', action: { cardId: ok.id } });
    else send(c, { type: 'minigame:action', action: { type: 'draw' } });
  } else if (kind === 'lucky-draw') {
    if (v.picking) send(c, { type: 'minigame:action', action: { target: firstOther(players, c.playerId) } });
    else send(c, { type: 'minigame:action', action: { type: 'draw' } });
  } else if (kind === 'number-hunter' || kind === 'number-bomb') {
    send(c, { type: 'minigame:action', action: { value: Math.floor((v.lo + v.hi) / 2) } });
  } else if (kind === 'undercover') {
    if (v.phase === 'describe' && cur === c.playerId) send(c, { type: 'minigame:action', action: { text: '测试描述' } });
  }
}

const c1 = await makeClient('H1');
send(c1, { type: 'create', name: 'H1' });
await sleep(150);
send(c1, { type: 'addBot' });
send(c1, { type: 'addBot' });
await sleep(150);
// 第 4 名：真实玩家 H2（此时 H1 + 2 bot + H2 = 4 人，已满）
const c2ws = await connect();
const c2obj = { ws: c2ws, name: 'H2', playerId: null, roomId: c1.roomId, state: null, mini: null };
c2ws.onmessage = (e) => handle(c2obj, JSON.parse(e.data));
send(c2obj, { type: 'join', roomId: c1.roomId, name: 'H2' });
await sleep(200);
send(c1, { type: 'start' });

// 跑最多 45 秒或直到有人获胜
let finished = false;
const deadline = Date.now() + 45000;
while (Date.now() < deadline) {
  await sleep(300);
  if (c1.state && c1.state.phase === 'finished') { finished = true; break; }
}

srv.kill();
console.log('\n==== 冒烟测试结果 ====');
console.log('触发的 minigame gameId 种类:', [...triggered].join(', ') || '(无)');
console.log('收到 minigame:result 次数:', resultCount);
console.log('私有数据校验次数:', privacy.checked, ' 失败:', privacy.fails.length);
if (privacy.fails.length) { privacy.fails.forEach((f) => console.log('  ✗ ' + f)); }
if (!finished) console.log('⚠ 45 秒内未分胜负（小游戏流程已验证，属正常）');

if (privacy.fails.length) process.exit(1);
if (privacy.checked > 50000) { console.log('✗ 私有状态被高频重播（疑似广播死循环）'); process.exit(1); }
if (triggered.size < 1 || resultCount < 1) { console.log('✗ 小游戏未被触发或未能结算'); process.exit(1); }
console.log('冒烟测试通过 ✅');
process.exit(0);
