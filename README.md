# ✈️ 多人联机飞行棋 · 回合小游戏

网页版 2–4 人飞行棋，通过房间号加入，原生 WebSocket 实时同步。每完成一轮全员行动，**服务器随机触发一个小游戏**，小游戏结果以「前进 / 后退 / 暂停 / 护盾 / 交换位置」等形式作用于飞行棋盘面。**零依赖**，无需 `npm install`。

## 运行

```bash
cd flying-chess
node server/index.js
# 打开 http://localhost:3000
```

自定义端口：`PORT=8080 node server/index.js`

## 怎么玩

1. 玩家 A 打开页面，输入昵称 → **创建房间**，得到 4 位房间号（如 `U2J4`）。
2. 玩家 B/C/D 在另一台设备或浏览器（建议无痕窗口）打开同一地址，输入昵称 + 房间号 → **加入房间**。
3. 房主可在开局前点 **添加电脑** 用 AI 补位（人数不足时），满 2 人即可 **开始游戏**。
4. 轮到自己时点 **掷骰子**；掷出点数后，可走的飞机会高亮，点击某架飞机完成移动。掷到 6 才能起飞，可再掷；落对方格 → 对方回基地；需精确到达终点，超则反弹。
5. 全员各行动一次记为一轮；一轮结束后服务器**弹出小游戏规则介绍页**（5 秒后自动进入，也可手动「开始」），随后进行小游戏，结算结果直接改变飞行棋盘面。某玩家 4 架全部到达终点即获胜。

## 小游戏系统

- **触发规则**：`turnsThisRound >= 玩家数` 时，按当前人数从支持的游戏中随机挑选一个（`registry.pickMiniGame(n, rng)`）。
- **统一接口**：每个游戏实现 `init(players, gameState) / start() / onPlayerAction(playerId, action) / getResult() / isFinished() / destroy()`，框架补充 `getState() / getStateFor(playerId) / timeoutHint() / aiAction() / getCurrentPlayerId() / gameId / immediate`。
- **两种结算模式**：
  - `immediate=true`：每次 `onPlayerAction` 通过 `getPendingEffects()` 即时产出效果，由 `room.applyEffect` 立即作用于盘面（如命运转轮、命运骰子）。
  - `immediate=false`：整局结束后由 `getResult().effects` 在 `endMiniGame` 时统一结算（多数策略/卡牌类游戏）。
- **任意可提交模式**：`getCurrentPlayerId() === null` 时（抢答、反应、投票、平局掷骰等），所有玩家（及 AI）均可提交，由 `room.scheduleMiniParticipants` 为 AI 各自调度一次。
- **支持的效果类型**：`forward`(前进) / `backward`(后退) / `skip`(暂停) / `shield`(护盾) / `double`(再掷一次) / `swap`(交换位置) / `swapRandom`(随机交换) / `disarm`(剥夺护盾) / `item`(道具)。

### 20 个小游戏

| 小游戏 | gameId | 人数 | 类型 |
| --- | --- | --- | --- |
| 命运转轮 | `fate-wheel` | 2-4 | 即时转盘，按指针发放效果 |
| 命运骰子 | `fate-dice` | 2-4 | 即时掷骰，好/坏卡影响盘面 |
| 骰子斗牛 | `dice-bull` | 2 | 比大小，庄闲决胜 |
| 骰子淘汰赛 | `dice-elim` | 2-4 | 每轮最小点淘汰，剩者为王 |
| 骰子大逃杀 | `dice-royale` | 2-4 | 掷 2 骰，最小淘汰，排名计分 |
| 井字闪电战 | `tic-tac` | 2 | 3×3 井字，平局掷骰决胜，胜者换位 |
| 极速猜拳 | `rps` | 2 | 三局两胜猜拳 |
| 反应拍灯 | `react-light` | 2-4 | 限时点亮对应颜色，先到 3 分胜 |
| 抢答三色 | `quiz-three` | 2-4 | 抢答常识题，答对前进 |
| 数字抱团 | `number-hug` | 3-4 | 各自选人抱团，凑成目标数前进 |
| 数字猎人 | `number-hunter` | 2 | 1-100 猜数字，先猜中获护盾 |
| 数字炸弹 | `number-bomb` | 2-4 | 1-50 报数，踩雷者后退 |
| 你画我猜 | `draw-guess` | 3-4 | 画板作画，他人猜词（**私有**） |
| 谁是卧底 | `undercover` | 3-4 | 相似词描述投票，揪出卧底（**私有**） |
| 记忆翻牌 | `memory` | 2-4 | 翻牌配对，最高分胜 |
| 翻牌对对碰 | `match-pair` | 2-4 | 同色配对，配对多者胜 |
| 抓乌龟 | `turtle` | 2-4 | 抽牌传「乌龟」，剩者输（**私有**） |
| UNO 速决 | `uno` | 2-4 | 出牌比拼，先出完胜（**私有**） |
| 运气抽卡 | `lucky-draw` | 2-4 | 抽好/坏卡，坏卡可指定他人 |

> 标注 **私有** 的游戏通过 `getStateFor(playerId)` 只向每位玩家下发自己的手牌/词语（`myHand` / `myWord` / `isUndercover`），公共广播仅含 `handCounts` 等汇总，杜绝手牌泄露。

## 测试

```bash
node test-all.mjs       # 一键全链路测试：依次跑下面 5 项并汇总（集成/隐私/启动/冒烟/完整对局）

# 后端（无需服务器）
node test-minigames.mjs  # 20 个小游戏集成测试：覆盖 2/3/4 人，校验接口/getStateFor/getResult 与效果合法性
node test-privacy.mjs    # 私有游戏的 per-player 下发：每位玩家只收到自己的手牌，不泄露他人

# 端到端（脚本自动拉起服务器实例）
node test-boot.mjs       # 服务器启动 + 前端静态资源(index.html/client.js/style.css)托管自检
node smoke.mjs           # 2 真人 + 2 AI 跑完整对局，验证小游戏触发/进行/结算与私有数据下发
node test-fullmatch.mjs  # 1 真人 + 1 AI 压缩小游戏超时跑完整一局，验证 “飞行→小游戏→结算→胜出” 全链路（可达终局）
```

测试用环境变量：
- `AI_DELAY_MS`：AI 行动间隔（默认约 600ms，测试时可设 `5`~`25` 加速）。
- `MINI_TIMEOUT_SCALE`：压缩小游戏全局/回合超时（默认 `1`；测试设 `0.001` 可让完整一局在分钟内跑完）。压缩后下限为 2000ms，避免压垮回合制游戏。

## 本轮修复记录（全链路测试发现）

- **小游戏超时重计卡死（严重）**：`room.scheduleMiniTimeout` 在全局/回合超时触发后未清空 `_miniTimer` 引用，导致「多回合 + 靠全局超时推进」的小游戏（反应拍灯、数字猎人/炸弹等）第一次超时后无法重新计时，整局永久卡死。已在超时回调入口清空引用修复。
- **memory / lucky-draw 选目标卡死（严重）**：记忆翻牌的 `choose` 阶段、运气抽卡的 `picking` 阶段需要「胜者/抽中者指定目标」，但二者 `aiAction` 均不会返回 `target`（lucky-draw 甚至没有 `aiAction`），AI 玩家抽到该角色时永久卡死。已补全 `aiAction` 选目标逻辑，并为这两个阶段增加超时兜底（超时自动随机指定），真人挂机也不会卡。


## 目录结构

```
flying-chess/
├── package.json
├── README.md
├── server/
│   ├── index.js          # HTTP 静态服务 + WebSocket 路由
│   ├── ws.js             # 零依赖 WebSocket 服务器(RFC6455)，支持按 playerId 定向下发
│   ├── board.js          # 棋盘常量(起点/步数映射)
│   ├── rules.js          # 纯规则：合法走子/移动反弹/撞机
│   ├── room.js           # 房间与回合状态机(服务器权威) + AI + 小游戏编排 + 私有状态广播
│   ├── minigame/
│   │   ├── registry.js   # 小游戏注册表：registerGame / listPlayable / pickMiniGame
│   │   ├── all.js        # 统一导入全部小游戏模块
│   │   ├── fateWheel.js  # 命运转轮
│   │   ├── g-dice.js     # 命运骰子 / 骰子斗牛 / 骰子淘汰赛 / 骰子大逃杀
│   │   ├── g-board.js    # 井字闪电战
│   │   ├── g-reaction.js # 极速猜拳 / 反应拍灯 / 抢答三色 / 数字抱团
│   │   ├── g-guess.js    # 数字猎人 / 数字炸弹 / 你画我猜 / 谁是卧底
│   │   └── g-cards.js    # 记忆翻牌 / 翻牌对对碰 / 抓乌龟 / UNO 速决 / 运气抽卡
│   ├── selftest.mjs      # 规则单测
│   ├── integration.mjs   # AI 自动对局集成测试
│   └── wssmoke.mjs       # WebSocket 握手/创建房间冒烟
├── test-minigames.mjs    # 20 小游戏后端集成测试
├── test-privacy.mjs      # 私有状态按玩家下发测试
├── test-boot.mjs         # 服务器启动 + 前端托管自检
├── smoke.mjs             # 全流程端到端冒烟测试
├── test-fullmatch.mjs    # 完整对局全链路压力探针(可达终局)
└── test-all.mjs          # 一键全链路测试汇总
└── public/
    ├── index.html
    ├── style.css
    ├── board.js          # 前端棋盘几何(仅渲染)
    └── client.js         # 大厅/对局界面 + 通用小游戏引擎(20 渲染器 + 规则介绍页)
```

## 规则要点（飞行棋本体）

- 4 色（红/黄/蓝/绿）各 4 架飞机；主轨道 52 格，每条颜色回家通道 4 格。
- 起飞需掷 6（掷 6 可再掷一次；连续 3 次 6 本回合作废）。
- 落在对方飞机所在主轨道格 → 对方该机回基地（同色不互撞，回家通道不撞）。
- 到达终点需精确点数，超过则反弹。
- 全员行动完记为一轮；某玩家 4 架全部到达终点即获胜。
