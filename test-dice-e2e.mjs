// 端到端：连真实服务器，创建房间+3AI，自动推进对战，校验每个含 dice 的 state 其日志"掷出 X" == dice
const WS = globalThis.WebSocket;
if (!WS) { console.error('Node 无全局 WebSocket，请使用 Node 21+'); process.exit(2); }

const URL = 'ws://localhost:3000';
const ws = new WS(URL);
let me = null, roomId = null;
let checks = 0, mismatches = 0, lastMismatch = null;
let started = false, finished = false;
const ROUND_TIMEOUT = 35000;

function lastRollFromLog(log) {
  if (!Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i--) {
    const m = /掷出\s*(\d)/.exec(log[i]);
    if (m) return Number(m[1]);
  }
  return null;
}

const timer = setTimeout(() => {
  if (!finished) {
    finished = true;
    console.log(`\n[e2e] 超时 ${ROUND_TIMEOUT}ms，停止。checks=${checks}, mismatches=${mismatches}`);
    if (lastMismatch) console.log('  最后不一致样本:', JSON.stringify(lastMismatch));
    ws.close();
    process.exit(mismatches ? 1 : 0);
  }
}, ROUND_TIMEOUT);

ws.addEventListener('open', () => { ws.send(JSON.stringify({ type: 'create', name: 'e2e-bot' })); });

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
  if (msg.type === 'created') {
    me = msg.playerId; roomId = msg.roomId;
    ws.send(JSON.stringify({ type: 'addBot' }));
    ws.send(JSON.stringify({ type: 'addBot' }));
    ws.send(JSON.stringify({ type: 'addBot' }));
  } else if (msg.type === 'state') {
    const s = msg;
    if (s.phase === 'lobby' && !started && s.players && s.players.length >= 4) {
      started = true;
      ws.send(JSON.stringify({ type: 'start' }));
    }
    if (s.phase === 'playing') {
      // 校验：dice 与日志"掷出 X"一致
      if (s.dice != null) {
        const lr = lastRollFromLog(s.log);
        checks++;
        if (lr != null && lr !== s.dice) {
          mismatches++;
          lastMismatch = { dice: s.dice, logLastRoll: lr, logTail: s.log.slice(-3) };
        }
      }
      // 自动推进：轮到本机玩家时掷骰/走子
      if (s.currentTurn === me) {
        if (s.dice == null) ws.send(JSON.stringify({ type: 'roll' }));
        else if (Array.isArray(s.legalMoves) && s.legalMoves.length) {
          ws.send(JSON.stringify({ type: 'move', planeIndex: s.legalMoves[0] }));
        }
      }
    }
    if (s.phase === 'finished') {
      finished = true;
      clearTimeout(timer);
      console.log(`\n[e2e] 对局结束。checks=${checks}, mismatches=${mismatches}`);
      if (lastMismatch) console.log('  最后不一致样本:', JSON.stringify(lastMismatch));
      ws.close();
      process.exit(mismatches ? 1 : 0);
    }
  }
});

ws.addEventListener('error', (e) => { console.error('[e2e] ws error', e.message || e); });
