// 极简 WebSocket 服务器（RFC6455），零依赖，仅用于本游戏的小报文（JSON）通信。
// 思路：
//   - 握手：用客户端发来的 Sec-WebSocket-Key + 固定 GUID 做 SHA1，返回 Sec-WebSocket-Accept
//   - 收：解析客户端发来的“掩码帧”（客户端必带掩码，需逐字节异或解掩码）
//   - 发：服务器发“未掩码文本帧”，支持 126/65536 以上长度，覆盖本游戏的状态报文
import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

// 解析一个完整帧，返回 { fin, opcode, payload, consumed }，数据不足则返回 null
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const fin = (buf[0] & 0x80) !== 0;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
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
  let mask;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.subarray(offset, offset + 4);
    offset += 4;
  }
  if (buf.length < offset + len) return null;
  let payload = buf.subarray(offset, offset + len);
  if (masked) {
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
    payload = out;
  }
  return { fin, opcode, payload, consumed: offset + len };
}

// 编码一个服务器发往客户端的文本帧（不加掩码）
function encodeFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x81; // FIN + 文本帧
  return Buffer.concat([header, payload]);
}

// 把 WebSocket 能力挂到已有的 http.Server 上
// handlers: { onOpen(socket), onMessage(socket, obj), onClose(socket) }
// 返回 { send(socket, obj), broadcast(roomId, obj) }
export function attachWebSocketServer(httpServer, handlers) {
  const sockets = new Set();

  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`
    );
    sockets.add(socket);
    socket.roomId = null;
    socket.playerId = null;

    let buffer = Buffer.alloc(0);
    let fragBuf = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const f = decodeFrame(buffer);
        if (!f) break;
        buffer = buffer.subarray(f.consumed);
        const { opcode, payload, fin } = f;
        if (opcode === 0x8) {
          socket.end();
          return;
        }
        if (opcode === 0x9) {
          socket.write(encodeFrame('')); // ping -> pong
          continue;
        }
        if (opcode === 0x1 || opcode === 0x2) {
          if (fin) handleMessage(socket, payload);
          else {
            fragBuf = Buffer.from(payload);
          }
        } else if (opcode === 0x0) {
          fragBuf = Buffer.concat([fragBuf, payload]);
          if (fin) handleMessage(socket, fragBuf);
        }
      }
    });

    socket.on('close', () => {
      sockets.delete(socket);
      handlers.onClose && handlers.onClose(socket);
    });
    socket.on('error', () => {
      sockets.delete(socket);
    });

    handlers.onOpen && handlers.onOpen(socket);
  });

  function handleMessage(socket, payload) {
    let obj;
    try {
      obj = JSON.parse(payload.toString('utf8'));
    } catch {
      return;
    }
    handlers.onMessage && handlers.onMessage(socket, obj);
  }

  function send(socket, obj) {
    if (socket.writable) socket.write(encodeFrame(JSON.stringify(obj)));
  }

  // roomId 广播；若传入 playerId，则只发给该玩家（用于小游戏私有状态 getStateFor）
  function broadcast(roomId, obj, playerId) {
    const data = encodeFrame(JSON.stringify(obj));
    for (const s of sockets) {
      if (s.roomId !== roomId || !s.writable) continue;
      if (playerId && s.playerId !== playerId) continue;
      s.write(data);
    }
  }

  return { send, broadcast };
}
