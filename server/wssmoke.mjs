// 端到端冒烟测试：用原生 net 完成 WebSocket 握手，发送 create，验证收到 created + state
import net from 'node:net';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 3000;
const key = crypto.randomBytes(16).toString('base64');
const sock = net.connect(PORT, '127.0.0.1');

let handshakeDone = false;
let buf = Buffer.alloc(0);
const got = [];

function encodeClient(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  const mask = crypto.randomBytes(4);
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81;
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeServer() {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    offset = 10;
  }
  if (buf.length < offset + len) return null;
  const payload = buf.subarray(offset, offset + len);
  buf = buf.subarray(offset + len);
  return { opcode, text: payload.toString('utf8') };
}

sock.on('connect', () => {
  sock.write(
    `GET / HTTP/1.1\r\nHost: localhost:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
      `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
  );
});

sock.on('data', (chunk) => {
  if (!handshakeDone) {
    const s = buf.length ? Buffer.concat([buf, chunk]).toString('utf8') : chunk.toString('utf8');
    const idx = s.indexOf('\r\n\r\n');
    if (idx === -1) {
      buf = Buffer.from(s);
      return;
    }
    handshakeDone = true;
    const rest = s.slice(idx + 4);
    buf = Buffer.from(rest);
    // 握手完成，发送 create
    sock.write(encodeClient(JSON.stringify({ type: 'create', name: '冒烟测试' })));
    return;
  }
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    const f = decodeServer();
    if (!f) break;
    if (f.opcode === 0x1) {
      const msg = JSON.parse(f.text);
      got.push(msg);
      if (msg.type === 'state') {
        finish();
        return;
      }
    }
  }
});

function finish() {
  const created = got.find((m) => m.type === 'created');
  const state = got.find((m) => m.type === 'state');
  if (created && created.roomId && state && state.phase === 'lobby' && state.players.length === 1) {
    console.log('✓ 握手成功，收到 created(房间号=' + created.roomId + ') 与 state(lobby, 1人)');
    sock.end();
    process.exit(0);
  } else {
    console.log('✗ 冒烟测试失败:', JSON.stringify(got));
    sock.end();
    process.exit(1);
  }
}

setTimeout(() => {
  console.log('✗ 超时未收到预期消息:', JSON.stringify(got));
  sock.destroy();
  process.exit(1);
}, 3000);
