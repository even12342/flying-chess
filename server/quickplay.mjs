// 一键人机房：以“房主+电脑”身份建房，等待真人用浏览器加入后自动开始，
// 房主一方由本脚本自动掷骰/走子（等价于一个 AI 对手）。真人加入后只需操作自己一方。
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
        if (!head.includes('101 Switching Protocols')) { reject(new Error('握手失败')); return; }
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
          else if (msg.type === 'created') { myId = msg.playerId; roomId = msg.roomId; console.log('ROOM:' + msg.roomId); }
          else if (msg.type === 'error') { console.log('服务器错误: ' + msg.message); }
        }
      }
    });
    function send(obj) { sock.write(encodeClient(JSON.stringify(obj))); }
    sock.on('error', reject);
  });
}

let myId = null, roomId = null;

async function main() {
  const c = await connect();
  let started = false;
  let rollSent = false, moveSent = false;

  c.onState((st) => {
    // 等待房：真人加入后（>=2 人）房主自动开始
    if (st.phase === 'lobby') {
      if (st.players.length >= 2 && !started) { started = true; c.send({ type: 'start' }); }
      return;
    }
    if (st.phase === 'finished') { console.log('本局结束。'); process.exit(0); }
    if (st.phase !== 'playing') return;
    if (st.currentTurn !== myId) { rollSent = false; moveSent = false; return; }

    if (st.dice == null) {
      if (!rollSent) { rollSent = true; moveSent = false; c.send({ type: 'roll' }); }
    } else if (st.legalMoves && st.legalMoves.length) {
      if (!moveSent) { moveSent = true; rollSent = false; c.send({ type: 'move', planeIndex: st.legalMoves[0] }); }
    }
  });

  c.send({ type: 'create', name: 'AI对手' });
  console.log('建房请求已发送，等待你用浏览器加入…');
}

main().catch((e) => { console.error('异常:', e); process.exit(1); });
