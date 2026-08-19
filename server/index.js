// 入口：HTTP 静态文件服务 + WebSocket 路由
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachWebSocketServer } from './ws.js';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 自动探测 public 目录位置：兼容本地、Render、以及子目录部署等多种布局
function resolvePublicDir() {
  const candidates = [
    path.join(__dirname, '..', 'public'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'flying-chess', 'public'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      console.log('[启动诊断] 找到 public 目录:', dir);
      return dir;
    }
  }
  console.error('[启动诊断] 未找到包含 index.html 的 public 目录，候选路径:', candidates);
  return candidates[0]; // 兜底返回默认位置，让后续读取失败时日志更清晰
}
const PUBLIC_DIR = resolvePublicDir();
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// ---- 静态文件 ----
const httpServer = http.createServer((req, res) => {
  let urlPath = (req.url || '/').split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 回退：未知 GET 路径（刷新/深链/误打路径）统一返回首页，避免浏览器直接显示 “Not found” 黑屏
      if (req.method === 'GET') {
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); res.end('Not found'); return; }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(html);
        });
        return;
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

// ---- WebSocket ----
const rooms = new Map();

function broadcast(roomId, msg, playerId) {
  ws.broadcast(roomId, msg, playerId);
}

const ws = attachWebSocketServer(httpServer, {
  onOpen() {},
  onClose() {},
  onMessage(socket, m) {
    try {
      switch (m.type) {
        case 'create': {
          const roomId = genRoomId();
          const room = new Room(roomId, broadcast);
          rooms.set(roomId, room);
          const player = room.addPlayer(m.name);
          socket.roomId = roomId;
          socket.playerId = player.id;
          ws.send(socket, { type: 'created', roomId, playerId: player.id, color: player.color });
          room.broadcastState();
          break;
        }
        case 'join': {
          const room = rooms.get(m.roomId);
          if (!room) return ws.send(socket, { type: 'error', message: '房间不存在' });
          if (room.phase !== 'lobby') return ws.send(socket, { type: 'error', message: '游戏已开始，无法加入' });
          if (room.players.length >= 4) return ws.send(socket, { type: 'error', message: '房间已满' });
          const player = room.addPlayer(m.name);
          socket.roomId = room.roomId;
          socket.playerId = player.id;
          ws.send(socket, { type: 'joined', roomId: room.roomId, playerId: player.id, color: player.color });
          room.broadcastState();
          break;
        }
        case 'start': {
          const room = rooms.get(socket.roomId);
          if (!room) break;
          if (socket.playerId !== room.hostId) return ws.send(socket, { type: 'error', message: '只有房主能开始游戏' });
          try {
            room.start();
          } catch (e) {
            ws.send(socket, { type: 'error', message: e.message });
          }
          break;
        }
        case 'addBot': {
          const room = rooms.get(socket.roomId);
          if (!room) break;
          if (socket.playerId !== room.hostId) return ws.send(socket, { type: 'error', message: '只有房主能添加电脑' });
          if (room.phase !== 'lobby') return ws.send(socket, { type: 'error', message: '游戏已开始' });
          if (room.players.length >= 4) return ws.send(socket, { type: 'error', message: '房间已满' });
          room.addBot();
          room.broadcastState();
          break;
        }
        case 'roll': {
          const room = rooms.get(socket.roomId);
          if (room) room.roll(socket.playerId);
          break;
        }
        case 'move': {
          const room = rooms.get(socket.roomId);
          if (room) room.move(socket.playerId, m.planeIndex);
          break;
        }
        case 'minigame:action': {
          const room = rooms.get(socket.roomId);
          if (room) room.handleMiniAction(socket.playerId, m.action);
          break;
        }
        default:
          break;
      }
    } catch (e) {
      ws.send(socket, { type: 'error', message: e.message });
    }
  },
});

// 生成不重复、去掉易混淆字符（0/O/1/I）的 4 位房间号
function genRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id;
  do {
    id = '';
    for (let i = 0; i < 4; i++) id += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(id));
  return id;
}

// HOST 默认绑定所有网卡，便于容器/云主机通过环境变量指定（如 127.0.0.1 仅本机）
const HOST = process.env.HOST || '0.0.0.0';
httpServer.listen(PORT, HOST, () => {
  console.log(`飞行棋服务器已启动: http://${HOST}:${PORT}`);
});
