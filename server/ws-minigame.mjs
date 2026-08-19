// 真实 WebSocket 冒烟：建房(真人A) + 3 电脑，验证小游戏事件链路对前端可用
import net from 'node:net';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 3015;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeClient(str) {
  const p = Buffer.from(str);
  const len = p.length;
  let h;
  if (len < 126) {
    h = Buffer.alloc(2);
    h[1] = len;
  } else if (len < 65536) {
    h = Buffer.alloc(4);
    h[1] = 126;
    h.writeUInt16BE(len, 2);
  } else {
    h = Buffer.alloc(10);
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(len), 2);
  }
  h[0] = 0x81;
  return Buffer.concat([h, p]);
}

function connect() {
  return new Promise((res, rej) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buf = Buffer.alloc(0);
    let hd = false;
    const onMsg = [];
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!hd) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.subarray(0, i).toString();
        if (!head.includes('101')) return rej(new Error('握手失败'));
        const exp = crypto.createHash('sha1').update(key + GUID).digest('base64');
        if (!head.includes(exp)) return rej(new Error('accept 不匹配'));
        hd = true;
        buf = buf.subarray(i + 4);
        const send = (obj) => sock.write(encodeClient(JSON.stringify(obj)));
        res({ sock, send, getMsg: () => onMsg.shift() });
      }
      while (buf.length >= 2) {
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) break;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) break;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (op === 0x1) onMsg.push(JSON.parse(payload.toString('utf8')));
      }
    });
    sock.on('error', rej);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { sock, send, getMsg } = await connect();
  let meId = null;
  const seen = { start: false, state: false, result: false };

  send( { type: 'create', name: '测试A' });
  await wait(150);
  for (let i = 0; i < 3; i++) {
    send( { type: 'addBot' });
    await wait(120);
  }
  // 取一次状态拿到 meId
  for (let i = 0; i < 10; i++) {
    const m = getMsg();
    if (m && m.type === 'state') {
      const me = m.players.find((p) => !p.isAI);
      if (me) meId = me.id;
      break;
    }
    await wait(30);
  }

  send( { type: 'start' });

  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    const m = getMsg();
    if (!m) {
      await wait(30);
      continue;
    }
    if (m.type === 'state') {
      if (!meId) {
        const me = m.players.find((p) => !p.isAI);
        if (me) meId = me.id;
      }
      if (m.phase === 'playing' && m.currentTurn === meId) {
        if (m.dice == null) send({ type: 'roll' });
        else if (m.legalMoves && m.legalMoves.length) send({ type: 'move', planeIndex: m.legalMoves[0] });
      }
      continue;
    }
    if (m.type === 'minigame:start') {
      seen.start = true;
      seen.name = m.gameId;
      if (m.currentPlayerId === meId) send( { type: 'minigame:action', action: { type: 'spin' } });
    } else if (m.type === 'minigame:state') {
      seen.state = true;
      if (m.currentPlayerId === meId) send( { type: 'minigame:action', action: { type: 'spin' } });
    } else if (m.type === 'minigame:result') {
      seen.result = true;
      break;
    }
  }
  sock.end();

  let failed = 0;
  const assert = (c, msg) => {
    console.log((c ? '✓ ' : '✗ ') + msg);
    if (!c) failed++;
  };
  assert(seen.start, '收到 minigame:start (gameId=' + (seen.name || '?') + ')');
  assert(seen.state, '收到 minigame:state（转盘状态推送）');
  assert(seen.result, '收到 minigame:result（小游戏结束）');
  console.log(failed === 0 ? '\n✅ 真实 WebSocket 小游戏链路通过' : '\n❌ 失败 ' + failed);
  process.exit(failed === 0 ? 0 : 1);
})();
