// 一键全链路测试：按顺序运行 5 个测试，给出汇总结论。
// 任一“硬失败”会让进程以非 0 退出；fullmatch 的触发/结算/胜负为信息级（不阻断）。
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUITES = [
  { name: '后端集成测试 (20 游戏 ×2/3/4 人)', file: 'test-minigames.mjs', fatal: true },
  { name: '私有状态按玩家下发', file: 'test-privacy.mjs', fatal: true },
  { name: '服务器启动 + 前端托管自检', file: 'test-boot.mjs', fatal: true },
  { name: '端到端冒烟 (真实 WS)', file: 'smoke.mjs', fatal: true },
  { name: '完整对局压力探针 (跑多回合)', file: 'test-fullmatch.mjs', fatal: false },
];

function run(suite) {
  return new Promise((resolve) => {
    console.log(`\n────────── ▶ ${suite.name} ──────────`);
    const p = spawn(process.execPath, [suite.file], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    p.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    p.on('close', (code) => resolve({ suite, code, out }));
  });
}

const results = [];
for (const s of SUITES) results.push(await run(s));

console.log('\n========================================');
console.log('           全链路测试汇总');
console.log('========================================');
let hardFail = false;
for (const r of results) {
  const ok = r.code === 0;
  const tag = ok ? '✅ PASS' : (r.suite.fatal ? '❌ FAIL' : '⚠️  通过(软)');
  if (!ok && r.suite.fatal) hardFail = true;
  if (!ok && !r.suite.fatal) hardFail = hardFail; // 软失败不阻断
  console.log(`  ${tag}  ${r.suite.name}`);
}
console.log('========================================');
if (hardFail) { console.log('存在硬失败，请查看上方日志'); process.exit(1); }
console.log('全链路测试全部通过 ✅');
process.exit(0);
