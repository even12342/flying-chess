// 复刻修复后的 settleDice 状态机（去 DOM 化），验证竞态时序下骰子最终 == 最新 dice（= 日志点数）
const DICE_TARGET = { 1: 't1', 2: 't2', 3: 't3', 4: 't4', 5: 't5', 6: 't6' };
const fallback = 't1';

let diceRolling = false, diceSettling = false, dicePending = null, diceSettleTimer = null, diceRollStart = 0;
let cubeTransform = null; // 模拟 cube.style.transform

function settleDice(value) {
  dicePending = value;
  if (!diceRolling) { cubeTransform = DICE_TARGET[value] || fallback; return; }
  if (diceSettling) return;
  diceSettling = true;
  const elapsed = Date.now() - diceRollStart;
  const remain = Math.max(0, 400 - elapsed);
  if (diceSettleTimer) clearTimeout(diceSettleTimer);
  diceSettleTimer = setTimeout(() => {
    diceSettling = false; diceRolling = false;
    if (diceSettleTimer) { clearTimeout(diceSettleTimer); diceSettleTimer = null; }
    cubeTransform = DICE_TARGET[dicePending] || fallback; // 定格到最新点数
  }, remain);
}
function startRoll() { diceRolling = true; diceSettling = false; dicePending = null; diceRollStart = Date.now(); }
function updateGameFallback(gameDice) {
  if (!diceRolling && gameDice != null) {
    const want = DICE_TARGET[gameDice] || fallback;
    if (cubeTransform !== want) cubeTransform = want;
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function assert(c, m) { if (c) pass++; else { fail++; console.log('  ✗ ' + m); } }

(async () => {
  // 场景1：竞态——玩家动画未结束时收到新回合点数（修复前会定格到旧的 3）
  startRoll();
  await sleep(50); settleDice(3);  // 玩家掷出 3，启动 ~350ms 定时器
  await sleep(50); settleDice(5);  // 新回合点数 5 到达，diceSettling 跳过但 dicePending=5
  assert(cubeTransform !== DICE_TARGET[3], '动画中不应提前定格到 3');
  await sleep(400);                // 定时器触发
  assert(cubeTransform === DICE_TARGET[5], '竞态下应定格到最新点数 5（而非旧的 3），got ' + cubeTransform);
  diceRolling = false; updateGameFallback(5);
  assert(cubeTransform === DICE_TARGET[5], '静止兜底应保持 5');

  // 场景2：正常单人掷骰
  diceRolling = false; diceSettling = false; dicePending = null; cubeTransform = null;
  startRoll();
  await sleep(50); settleDice(2);
  await sleep(400);
  assert(cubeTransform === DICE_TARGET[2], '正常掷骰应定格到 2，got ' + cubeTransform);

  // 场景3：被动同步（AI 掷骰，diceRolling 一直 false）立即定格
  diceRolling = false; diceSettling = false; cubeTransform = null;
  settleDice(6);
  assert(cubeTransform === DICE_TARGET[6], '被动同步应直接定格到 6，got ' + cubeTransform);

  // 场景4：网络抖动重复推送同一值
  diceRolling = false; diceSettling = false; cubeTransform = null;
  startRoll();
  await sleep(10); settleDice(4); await sleep(10); settleDice(4); await sleep(10); settleDice(4);
  await sleep(400);
  assert(cubeTransform === DICE_TARGET[4], '重复推送应定格到 4，got ' + cubeTransform);

  // 场景5：连续两回合（第一回合动画中来了第二回合真实点数）
  diceRolling = false; diceSettling = false; cubeTransform = null; diceSettleTimer = null;
  startRoll();
  await sleep(30); settleDice(1);                 // 回合A 点数1
  await sleep(20); diceRolling = false; diceSettling = false; updateGameFallback(1); // A 定格1
  startRoll();                                    // 回合B 开始动画
  await sleep(30); settleDice(6);                 // 回合B 点数6
  await sleep(400);
  assert(cubeTransform === DICE_TARGET[6], '第二回合应定格到 6，got ' + cubeTransform);

  console.log(`\n骰子竞态逻辑测试: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
