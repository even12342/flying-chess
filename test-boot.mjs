// 服务器启动 + 前端静态资源自检
// 启动真实服务器，确认监听成功，并校验 index.html / client.js / style.css 可被正确托管。
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, ct: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(new Error('timeout')); });
  });
}

const proc = spawn('node', ['server/index.js'], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let log = '';
proc.stdout.on('data', (d) => (log += d));
proc.stderr.on('data', (d) => (log += d));

function fail(msg) {
  console.log('✗ ' + msg);
  proc.kill('SIGKILL');
  process.exit(1);
}

try {
  // 等待服务器就绪
  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      await get(`${BASE}/`);
      ready = true;
      break;
    } catch { /* retry */ }
  }
  if (!ready) fail('服务器未在 10s 内就绪。输出:\n' + log);

  console.log('✓ 服务器启动成功 (PORT=' + PORT + ')');

  const checks = [
    { path: '/', name: 'index.html', must: (r) => r.status === 200 && /minigame|飞行棋/i.test(r.body) },
    { path: '/client.js', name: 'client.js', must: (r) => r.status === 200 && r.body.length > 1000 && /minigame:start/.test(r.body) },
    { path: '/style.css', name: 'style.css', must: (r) => r.status === 200 && r.body.length > 500 },
  ];

  for (const c of checks) {
    const r = await get(`${BASE}${c.path}`);
    if (!c.must(r)) fail(`${c.name} 托管异常 (status=${r.status}, len=${r.body.length})`);
    console.log(`✓ ${c.name} 托管正常 (status=${r.status}, len=${r.body.length})`);
  }
} catch (e) {
  fail('自检异常: ' + e.message);
} finally {
  proc.kill('SIGKILL');
}

console.log('启动与前端自检通过 ✅');
process.exit(0);
