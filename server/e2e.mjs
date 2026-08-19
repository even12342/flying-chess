// 端到端：通过真实 WebSocket（自己实现的握手+帧编解码）打完整一局，
// 覆盖 index.js + ws.js 的真实网络路径，找出运行时错误。
import crypto from 'node:crypto';
import net from 'node:net';

const PORT = process.env.PORT || 3000;
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeClient(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) { header = Buffer.alloc(2); header[1] = 0x80 | len; }
  else { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
  header[0] = 0x81;
  const mask = crypto.randomBytes(4);
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}
function decodeServer(buf) {
  let offset = 2; let len = buf[1] & 0x7f;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  return buf.subarray(offset, offset + len).toString('utf8');
}

function connect() {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(PORT, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buf = Buffer.alloc(0);
    let handshakeDone = false;
    let latestState = null;
    const handlers = [];
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshakeDone) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.subarray(0, idx).toString();
        if (!head.includes('101 Switching Protocols')) { reject(new Error('握手失败: ' + head)); return; }
        const expected = crypto.createHash('sha1').update(key + GUID).digest('base64');
        if (!head.includes(expected)) { reject(new Error('Sec-WebSocket-Accept 不匹配')); return; }
        handshakeDone = true;
        buf = buf.subarray(idx + 4);
        resolve({ sock, send, getState: () => latestState, onState: (fn) => handlers.push(fn) });
      }
      while (buf.length >= 2) {
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f; let off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) break;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 0x1) {
          const msg = JSON.parse(payload.toString('utf8'));
          if (msg.type === 'state') { latestState = msg; handlers.forEach((h) => h(msg)); }
        }
      }
    });
    function send(obj) { sock.write(encodeClient(JSON.stringify(obj))); }
    sock.on('error', reject);
  });
}

async function main() {
  const c = await connect();
  let meId = null;
  let stateCount = 0;
  c.onState(() => { stateCount++; });

  c.send({ type: 'create', name: '小明' });
  await wait(150);
  c.send({ type: 'addBot' }); // 加一个电脑，凑成 2 人
  await wait(150);
  const created = c.getState();
  if (created) meId = created.players.find((p) => !p.isAI).id;
  c.send({ type: 'start' });

  let finished = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 30000 && !finished) {
    const s = c.getState();
    if (!s) { await wait(50); continue; }
    if (s.phase === 'finished') { finished = true; break; }
    if (s.phase !== 'playing') { await wait(50); continue; }
    if (s.currentTurn !== meId) { await wait(40); continue; } // 等 AI / 等自己
    if (s.dice == null) { c.send({ type: 'roll' }); }
    else if (s.legalMoves && s.legalMoves.length) { c.send({ type: 'move', planeIndex: s.legalMoves[0] }); }
    await wait(60);
  }

  if (finished) {
    const last = c.getState();
    const w = last.players.find((p) => p.id === last.winner);
    console.log(`✓ 端到端通过：真实 WebSocket 打完整一局（${last.round} 轮，${stateCount} 次状态广播），胜者=${w ? w.name : '?'}`);
    process.exit(0);
  } else {
    console.log(`✗ 端到端未结束：收到 ${stateCount} 次状态，最后 phase=${c.getState() ? c.getState().phase : '无'}`);
    process.exit(1);
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
main().catch((e) => { console.error('✗ 端到端异常:', e); process.exit(1); });
