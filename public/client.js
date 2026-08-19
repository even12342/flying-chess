// 前端主逻辑：连接 WebSocket、渲染大厅/等待房/对局/小游戏、发送操作

// 全局错误兜底：任何运行时错误都显示出来，避免白屏难以排查
window.addEventListener('error', (e) => {
  const err = (e && e.error && e.error.stack) || (e && e.message) || '未知错误';
  const box = document.getElementById('app');
  if (box) box.innerHTML = '<div class="card"><h2>页面出错了</h2><pre style="white-space:pre-wrap;text-align:left;font-size:13px;color:#c0392b">' + String(err).replace(/</g, '&lt;') + '</pre></div>';
});


// 棋盘几何（原 public/board.js，仅前端渲染用，已内联以去掉 ES 模块依赖，兼容预览面板）
const B = (function () {
  const COLORS = ['red', 'yellow', 'blue', 'green'];
  const CELL = 64;
  const N = 15;
  const START_INDEX = { red: 0, yellow: 26, blue: 39, green: 13 };
  const MAIN = [
    [6, 13], [6, 12], [6, 11], [6, 10], [6, 9],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
    [0, 7],
    [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 6],
    [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0],
    [7, 0],
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
    [14, 7],
    [14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8],
    [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14],
    [7, 14],
    [6, 14],
  ];
  const HOME = {
    red: [[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]],
    yellow: [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]],
    blue: [[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]],
    green: [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]],
  };
  const BASE = {
    red: [[1, 13], [3, 13], [1, 11], [3, 11]],
    yellow: [[13, 1], [11, 1], [13, 3], [11, 3]],
    blue: [[13, 13], [11, 13], [13, 11], [11, 11]],
    green: [[1, 1], [3, 1], [1, 3], [3, 3]],
  };
  const CENTER = [7, 7];
  function stepToCell(color, step) {
    if (step < 0) return null;
    if (step <= 50) return MAIN[(START_INDEX[color] + step) % 52];
    if (step <= 56) return HOME[color][step - 51];
    return CENTER;
  }
  return { COLORS, CELL, N, START_INDEX, MAIN, HOME, BASE, CENTER, stepToCell };
})();

const COLOR_HEX = { red: '#FF5C7C', yellow: '#FFC53D', blue: '#4DA3FF', green: '#43D17A' };
const COLOR_HEX_D = { red: '#E23E63', yellow: '#F0A800', blue: '#2C82E0', green: '#25B25E' };
const COLOR_NAME = { red: '红', yellow: '黄', blue: '蓝', green: '绿' };
// 色弱友好：每个队伍额外用专属符号做「颜色+形状」双编码
const COLOR_SYMBOL = { red: '★', yellow: '◆', blue: '●', green: '▲' };
const RPS_ICON = { rock: '✊', scissors: '✌️', paper: '✋' };

// 命运转轮 6 格（顺序与服务器 fateWheel.js 的 CELLS 保持一致）
const WHEEL_CELLS = [
  { name: '前进 3 格', short: '前进3', color: '#FF5C7C' },
  { name: '后退 2 格', short: '后退2', color: '#FFC53D' },
  { name: '与左边玩家换位', short: '换左', color: '#4DA3FF' },
  { name: '与右边玩家换位', short: '换右', color: '#43D17A' },
  { name: '再来一次', short: '再来', color: '#7B6CF6' },
  { name: '暂停一轮', short: '暂停', color: '#FFB23E' },
];

let ws = null;
const me = { playerId: null, roomId: null, color: null };
let game = null; // 最近一次服务器状态快照
let prevDice = null; // 保留兼容
let diceRolling = false;  // 掷骰动画进行中
let dicePending = null;   // 服务端返回的真实点数
let diceRollStart = 0;    // 本次掷骰动画开始时间
let diceSettling = false; // 是否已触发定格（防重复）
let diceSettleTimer = null; // 定格定时器引用，便于竞态时清理
let mini = null; // 小游戏状态：{ phase, name, rules, gameId, players, currentPlayerId, state, result, ... }

const app = document.getElementById('app');

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => render();
  ws.onmessage = (e) => handle(JSON.parse(e.data));
  ws.onclose = () => {
    app.innerHTML = '<div class="card center">连接已断开，请刷新页面。</div>';
  };
}

function send(obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function handle(msg) {
  if (msg.type === 'created') {
    me.playerId = msg.playerId; me.roomId = msg.roomId; me.color = msg.color;
  } else if (msg.type === 'joined') {
    me.playerId = msg.playerId; me.roomId = msg.roomId; me.color = msg.color;
  } else if (msg.type === 'error') {
    alert(msg.message);
  } else if (msg.type === 'state') {
    game = msg;
    if (game.dice != null) {
      dicePending = game.dice;
      settleDice(game.dice);
    }
  } else if (msg.type === 'minigame:start') {
    // 阶段1：本轮结束，弹出“规则介绍页”，展示玩法规则
    if (mini && mini._auto) clearTimeout(mini._auto);
    mini = {
      phase: 'intro',
      name: msg.name,
      description: msg.description,
      rules: msg.rules || msg.description,
      gameId: msg.gameId,
      players: msg.players,
      currentPlayerId: msg.currentPlayerId,
      state: null,
      result: null,
      wheelAngle: 0,
      lastResultsLen: 0,
      _pendingSpin: null,
    };
    // 规则页停留 5 秒后自动进入（玩家也可手动点“开始”）
    mini._autoMs = 5000;
    mini._start = Date.now();
    mini._auto = setTimeout(() => {
      if (mini && mini.phase === 'intro') { mini.phase = 'playing'; render(); }
    }, mini._autoMs);
  } else if (msg.type === 'minigame:state') {
    // 关键修复：进入小游戏介绍页(intro)时服务端已立即下发首份状态，必须缓存下来，
    // 否则点「开始」切到 playing 时 mini.state 仍为 null，渲染器会收到 null 而崩溃。
    if (mini) {
      mini.state = msg.state;
      mini.currentPlayerId = msg.currentPlayerId;
      mini.gameId = msg.gameId || mini.gameId;
    }
  } else if (msg.type === 'minigame:result') {
    if (mini) {
      mini.phase = 'result';
      mini.result = msg.result;
    }
    setTimeout(() => { mini = null; render(); }, 2800);
  }
  render();
}

let lastViewKey = null;
function render() {
  if (!ws || ws.readyState !== 1) {
    // 未连上服务器时：仍展示大厅首页（连接成功后会自动刷新），避免白屏
    if (me.roomId) { app.innerHTML = '<div class="center">连接中…</div>'; return; }
  }
  const vk = mini ? 'mini'
    : (!me.roomId ? 'lobby'
      : (game && game.phase === 'finished' ? 'finished'
        : (game && game.phase === 'lobby' ? 'room' : 'game')));
  if (vk !== lastViewKey) {
    app.classList.remove('view-enter');
    void app.offsetWidth; // 强制重排以重启动画
    app.classList.add('view-enter');
    lastViewKey = vk;
    if (mini) {
      app.innerHTML = renderMiniGame();
      const ov = app.querySelector('.overlay');
      if (ov) ov.dataset.miniKey = mini.gameId + '|' + mini.phase;
      postRenderMiniGame();
      return;
    }
    if (!me.roomId || !game || game.phase === 'lobby') { renderLobbyOrWaiting(); return; }
    if (game.phase === 'finished') { renderFinished(); return; }
    renderGame();
    return;
  }
  // 同一视图内的增量更新：仅局部刷新动态内容，避免点击/状态推送触发整页（棋盘+骰子）重建闪动
  // 注意：mini 是覆盖在 game 上的轻量弹层，其内部 phase 变化（intro→playing→result）必须整体重建，
  //       因此必须放在 game 增量更新之前判断，否则会从 game 增量分支直接 return 导致「开始小游戏」点了没反应
  if (mini) {
    const mk = mini.gameId + '|' + mini.phase;
    const overlay = app.querySelector('.overlay');
    if (overlay && overlay.dataset.miniKey === mk) {
      updateMiniBody(); // 同 phase：仅替换卡片内容，不重建 overlay，不重播 popIn
    } else {
      app.innerHTML = renderMiniGame();
      const ov = app.querySelector('.overlay');
      if (ov) ov.dataset.miniKey = mk;
      postRenderMiniGame();
    }
    return;
  }
  if (game && game.phase !== 'lobby' && game.phase !== 'finished') { updateGame(); return; }
  // 其它视图保持原有整体重建（刷新频率低，且需反映成员/规则变化）
  if (!me.roomId || !game || game.phase === 'lobby') renderLobbyOrWaiting();
  else if (game.phase === 'finished') renderFinished();
}

// 小游戏同 phase 内的增量更新：复用现有 overlay 与 mg-card 容器，仅替换卡片内容，
// 不重建 overlay（避免半透明遮罩闪）、不重播 popIn 动画（避免卡片闪）。
// 命运转轮(fate-wheel)的 #wheel 元素需保留，否则每次 state 推送都会重置转盘角度导致重转闪烁。
function updateMiniBody() {
  // intro（规则介绍页）为静态内容，无需增量刷新；跳过可避免重渲染打断倒计时环
  if (mini && mini.phase === 'intro') return;
  const overlay = app.querySelector('.overlay');
  if (!overlay) {
    app.innerHTML = renderMiniGame();
    const ov = app.querySelector('.overlay');
    if (ov) ov.dataset.miniKey = mini.gameId + '|' + mini.phase;
    postRenderMiniGame();
    return;
  }
  const oldCard = overlay.querySelector('.mg-card');
  const holder = document.createElement('div');
  holder.innerHTML = renderMiniGame();
  const newCard = holder.querySelector('.mg-card');
  if (!oldCard || !newCard) {
    app.innerHTML = renderMiniGame();
    const ov = app.querySelector('.overlay');
    if (ov) ov.dataset.miniKey = mini.gameId + '|' + mini.phase;
    postRenderMiniGame();
    return;
  }
  // fate-wheel：先取下 #wheel，替换内容后再放回，保留其角度与过渡
  let wheel = null;
  if (mini.state && mini.state.view && mini.state.view.kind === 'fate-wheel') {
    wheel = oldCard.querySelector('#wheel');
    if (wheel && wheel.parentNode) wheel.parentNode.removeChild(wheel);
  }
  oldCard.className = newCard.className + ' no-pop';
  oldCard.innerHTML = newCard.innerHTML;
  if (wheel) {
    // newCard.innerHTML 已带回一个全新的 #wheel，需先移除，否则会与保留的旧轮盘叠加成两个
    const freshWheel = oldCard.querySelector('#wheel');
    if (freshWheel && freshWheel.parentNode) freshWheel.parentNode.removeChild(freshWheel);
    const wrap = oldCard.querySelector('.wheel-wrap');
    if (wrap) wrap.appendChild(wheel);
  }
  postRenderMiniGame();
}

// ============ 小游戏：规则介绍页 / 各游戏界面 / 结算页 ============
function nameById(id) {
  const list = (mini && mini.players) || (game && game.players) || [];
  const p = list.find((x) => x.id === id);
  return p ? p.name : id;
}
function colorById(id) {
  const list = (mini && mini.players) || (game && game.players) || [];
  const p = list.find((x) => x.id === id);
  return p ? p.color : 'red';
}

// 小游戏类型分类（用于按类型配色 + 类型徽章）
const MG_TYPE = {
  // 运气类
  'fate-wheel': 'luck', 'fate-dice': 'luck', 'lucky-draw': 'luck',
  // 骰子类
  'dice-bull': 'dice', 'dice-elim': 'dice', 'dice-royale': 'dice',
  // 竞技反应类
  'rps': 'arcade', 'react-light': 'arcade', 'tic-tac': 'arcade',
  'number-hunter': 'arcade', 'number-bomb': 'arcade',
  'quiz-three': 'arcade', 'turtle': 'arcade', 'uno': 'arcade',
  // 社交语言类
  'memory': 'social', 'match-pair': 'social',
  'draw-guess': 'social', 'undercover': 'social',
};
const MG_TYPE_LABEL = {
  luck: '🍀 运气挑战', dice: '🎲 骰子对决',
  arcade: '⚡ 竞技反应', social: '💬 社交互动',
};
// 各小游戏代表图标（过渡页 hero 徽章用）
const MG_ICON = {
  'fate-wheel': '🎡', 'fate-dice': '🎲', 'lucky-draw': '🎁',
  'dice-bull': '🎯', 'dice-elim': '🎲', 'dice-royale': '👑',
  'rps': '✊', 'react-light': '💡', 'tic-tac': '⭕',
  'number-hunter': '🔍', 'number-bomb': '💣',
  'quiz-three': '🙋', 'turtle': '🐢', 'uno': '🃏',
  'memory': '🧠', 'match-pair': '🔗',
  'draw-guess': '🎨', 'undercover': '🕵️',
};
// 每个小游戏「本局目标」——playing 页顶部统一展示，连接小游戏与飞行棋棋盘奖惩
const MG_GOAL = {
  'fate-wheel': '转盘随机结果，立即在棋盘生效',
  'fate-dice': '骰子随机结果，立即在棋盘生效',
  'dice-bull': '牛数最大者前进 2，最小者后退 2',
  'dice-elim': '点数最小者淘汰，冠军前进 4',
  'dice-royale': '最后存活者前进 5，倒数两名后退 2',
  'tic-tac': '率先三连者前进 3 格',
  'rps': '三局两胜，胜者前进 3 格',
  'react-light': '先到 3 分者获胜，并可重掷 1 次',
  'quiz-three': '固定 6 题，比分高者前进 3 格',
  'memory': '配对最多者可选一名玩家后退 2',
  'match-pair': '配对最多者可选一名玩家后退 2',
  'turtle': '最后留下乌龟者后退 2 格',
  'uno': '最先出完手牌者前进 3 格',
  'lucky-draw': '抽到整蛊卡可指定一名玩家后退 2',
  'number-hunter': '猜中目标数字者获得护盾',
  'number-bomb': '踩中炸弹者后退 3 格',
  'draw-guess': '猜中最多者前进 3 格',
  'undercover': '找出卧底阵营者前进 3 格',
};
function mgTypeOf() {
  const gid = mini && mini.gameId;
  return (gid && MG_TYPE[gid]) || 'dice';
}
// 通用小卡片容器（自动按类型注入 accent 配色 + playing 页顶部「本局目标」条）
function mgCard(inner, cls) {
  const typeCls = 'type-' + mgTypeOf();
  const isPlay = cls !== 'intro' && cls !== 'result';
  let goal = '';
  if (isPlay && mini && mini.state && mini.gameId && MG_GOAL[mini.gameId]) {
    goal = `<div class="mg-goal"><span class="g-ico">🎯</span>本局目标：${MG_GOAL[mini.gameId]}</div>`;
  }
  return `<div class="overlay"><div class="mg-card ${cls || ''} ${typeCls}">${goal}${inner}</div></div>`;
}
function turnText() {
  const cur = mini.currentPlayerId;
  if (!cur) return '<div class="mg-turn">轮到：<b>所有人</b>（可操作）</div>';
  const c = COLOR_HEX[colorById(cur)];
  const mine = cur === me.playerId;
  return `<div class="mg-turn ${mine ? 'mine' : ''}"><span class="mg-turn-dot" style="background:${c}"></span>轮到：<b style="color:${c}">${nameById(cur)}</b>${mine ? ' · 该你出手！' : ''}</div>`;
}
function scoreHtml(scores) {
  if (!scores) return '';
  return `<div class="mg-scores">${mini.players.map((p) => `<span class="score" style="border-color:${COLOR_HEX[p.color]}">${p.name}:${scores[p.id] || 0}</span>`).join('')}</div>`;
}
function isMyTurn() { return mini.currentPlayerId === me.playerId; }

function renderMiniGame() {
  if (mini.phase === 'intro') return renderMiniIntro();
  if (mini.phase === 'result') return renderMiniResult();
  // 防御：playing 阶段但状态尚未到达（如网络延迟）时，先显示加载占位，避免渲染器收到 null 崩溃
  if (!mini.state) return mgCard('<div class="mg-sub">小游戏加载中…</div>');
  const v = mini.state && mini.state.view;
  const kind = (v && v.kind) || mini.gameId;
  const fn = MINI_RENDERERS[kind];
  return fn ? fn(v) : `<div class="overlay"><div class="mg-card">未知小游戏：${kind}</div></div>`;
}

function renderMiniIntro() {
  const type = mgTypeOf();
  const icon = MG_ICON[mini.gameId] || '🎮';
  const players = mini.players || [];
  return mgCard(`
    <div class="mg-kicker">即将进入小游戏</div>
    <div class="mg-hero" aria-hidden="true">${icon}</div>
    <div class="mg-type-badge">${MG_TYPE_LABEL[type] || '🎮 小游戏'}</div>
    <div class="mg-game">${mini.name}</div>
    <div class="mg-rules"><b>玩法规则</b><br/>${mini.rules || mini.description}</div>
    <div class="mg-intro-head">本局参与者 · ${players.length} 人</div>
    <div class="mg-intro-players">
      ${players.map((p) => `<span class="mg-chip" style="--c:${COLOR_HEX[p.color]}">${p.name}</span>`).join('')}
    </div>
    <div class="mg-count" id="mgCount">
      <svg class="mg-count-ring" viewBox="0 0 44 44" aria-hidden="true">
        <circle class="mg-count-bg" cx="22" cy="22" r="19"></circle>
        <circle class="mg-count-fg" id="mgCountRing" cx="22" cy="22" r="19"></circle>
      </svg>
      <span class="mg-count-num" id="mgCountNum">5</span>
    </div>
    <div class="mg-count-txt">秒后自动开始</div>
    <button id="mgStart">开始挑战</button>
  `, 'intro');
}

function effectText(e) {
  switch (e.type) {
    case 'forward': return { icon: '🚀', label: `前进 ${e.value} 格` };
    case 'backward': return { icon: '↩️', label: `后退 ${e.value} 格` };
    case 'double': return { icon: '🔄', label: '重掷 1 次' };
    case 'shield': return { icon: '🛡️', label: '获得护盾' };
    default: return { icon: '⭐', label: e.name || '奖励' };
  }
}

function renderMiniResult() {
  const res = mini.result || {};
  const details = res.details || [];
  const effects = res.effects || [];
  const winners = res.winner || [];
  const type = mgTypeOf();
  const medal = ['🥇', '🥈', '🥉'];
  const winnerColor = winners.length ? (COLOR_HEX[colorById(winners[0])] || '#888') : '#888';
  const effectHtml = effects.length ? `
    <div class="mg-effects">
      <div class="mg-effects-title">战利品 / 后果</div>
      <div class="mg-effect-chips">
        ${effects.map((e) => {
          const t = effectText(e);
          const ec = COLOR_HEX[colorById(e.playerId)] || '#888';
          return `<span class="mg-effect ${e.type}" style="--ec:${ec}">
            <span class="mg-effect-who">${nameById(e.playerId)}</span>
            <span class="mg-effect-act">${t.icon} ${t.label}</span>
          </span>`;
        }).join('')}
      </div>
    </div>` : '';
  return mgCard(`
    <div class="mg-type-badge">${MG_TYPE_LABEL[type] || '🎮 小游戏'} · 战报</div>
    ${winners.length
      ? `<div class="mg-winner" style="--wc:${winnerColor}">
          <div class="mg-winner-trophy">🏆</div>
          <div class="mg-winner-name">${nameById(winners[0])}</div>
          <div class="mg-winner-tag">获胜</div>
        </div>`
      : `<div class="mg-winner none">
          <div class="mg-winner-trophy">🎉</div>
          <div class="mg-winner-name">本局结束</div>
        </div>`}
    ${effectHtml}
    <div class="mg-result-list">
      ${details.length
        ? details.map((d, i) => `<div class="mg-result-row rank-${i < 3 ? i + 1 : 'n'}">
            <span class="mg-medal">${i < 3 ? medal[i] : (i + 1)}</span>
            <span class="dot" style="background:${COLOR_HEX[colorById(d.playerId)]}"></span>
            <span class="mg-rname">${nameById(d.playerId)}</span>
            <b class="mg-rval">${d.name}</b>
          </div>`).join('')
        : '<div class="mg-sub">无明细</div>'}
    </div>
    <div class="mg-sub">即将回到飞行棋…</div>
  `, 'result');
}

// ---- 各小游戏渲染器（按 view.kind 分发）----
const MINI_RENDERERS = {
  'fate-wheel': renderFateWheel,
  'fate-dice': renderFateDice,
  'dice-bull': renderDiceBull,
  'dice-elim': renderDiceElim,
  'dice-royale': renderDiceElim, // 复用 dice-elim 渲染器（其内部已按 v.kind 做「骰子大逃杀」分支）
  'tic-tac': renderTicTac,
  'rps': renderRps,
  'react-light': renderReactLight,
  'quiz-three': renderQuizThree,
  'memory': renderMemory,
  'match-pair': renderMatchPair,
  'turtle': renderTurtle,
  'uno': renderUno,
  'lucky-draw': renderLuckyDraw,
  'number-hunter': renderNumberGuess,
  'number-bomb': renderNumberGuess,
  'draw-guess': renderDrawGuess,
  'undercover': renderUndercover,
};

function resultRows(results) {
  return (results && results.length)
    ? results.map((r) => `<div class="mg-result-row"><span class="dot" style="background:${COLOR_HEX[colorById(r.playerId)]}"></span>${nameById(r.playerId)}：<b>${r.name}</b></div>`).join('')
    : '<div class="mg-sub">等待第一次操作…</div>';
}

function renderFateWheel(v) {
  const results = resultRows(v.results);
  return mgCard(`
    <div class="mg-game">🎡 命运转轮</div>
    <div class="wheel-wrap"><div class="wheel-pointer"></div><div class="wheel" id="wheel">
      ${WHEEL_CELLS.map((c, i) => `<div class="wheel-label" style="transform:rotate(${i * 60 + 30}deg) translateY(-72px) rotate(${-(i * 60 + 30)}deg)">${c.short}</div>`).join('')}
    </div></div>
    ${turnText()}
    <div class="mg-results">${results}</div>
    <button id="mgSpin" ${isMyTurn() ? '' : 'disabled'}>${isMyTurn() ? '🎯 转动转盘' : '等待其他玩家…'}</button>
  `, 'playing');
}

function renderFateDice(v) {
  return mgCard(`
    <div class="mg-game">🎲 命运骰子</div>
    ${turnText()}
    <div class="mg-results">${resultRows(v.results)}</div>
    <button id="mgAct" ${isMyTurn() ? '' : 'disabled'}>${isMyTurn() ? '🎲 掷骰子' : '等待其他玩家…'}</button>
  `);
}

function renderDiceBull(v) {
  const diceHtml = mini.players.map((p) => {
    const ds = v.dice[p.id] || [];
    return `<div><span class="dot" style="background:${COLOR_HEX[p.color]}"></span>${p.name}：<b>${ds.join(' + ')} = ${ds.reduce((a, b) => a + b, 0)}</b></div>`;
  }).join('');
  return mgCard(`
    <div class="mg-game">🎲 骰子斗牛</div>
    ${diceHtml}
    ${turnText()}
    <div class="mg-actions">
      <button id="mgHit" ${isMyTurn() ? '' : 'disabled'}>跟注（+1骰）</button>
      <button id="mgStand" ${isMyTurn() ? '' : 'disabled'}>停牌</button>
    </div>
  `);
}

function renderDiceElim(v) {
  const title = v.kind === 'dice-royale' ? '骰子大逃杀' : '骰子淘汰赛';
  const alive = (v.alive || []).map((id) => `<span class="chip" style="background:${COLOR_HEX[colorById(id)]}">${nameById(id)}</span>`).join(' ');
  const rolls = Object.entries(v.lastRolls || {}).map(([id, val]) => `<div>${nameById(id)}：🎲 <b>${val}</b></div>`).join('');
  const elim = (v.elimOrder || []).map((id) => nameById(id)).join(' → ');
  const waiting = !isMyTurn() && mini.currentPlayerId ? `等待 ${nameById(mini.currentPlayerId)} 掷骰…` : '准备开始…';
  return mgCard(`
    <div class="mg-game">💀 ${title}</div>
    <div>存活：${alive}</div>
    <div class="mg-rolls">${rolls || '<div class="mg-sub">点击“掷骰”开始本轮，全员点数最小者淘汰</div>'}</div>
    ${elim ? `<div class="mg-sub">淘汰顺序：${elim}</div>` : ''}
    ${turnText()}
    <button id="mgAct" ${isMyTurn() ? '' : 'disabled'}>${isMyTurn() ? '🎲 掷骰（淘汰本轮）' : waiting}</button>
  `);
}

function renderTicTac(v) {
  const cells = v.board.map((c, i) => {
    const sym = c === 'X' ? '❌' : c === 'O' ? '⭕' : '';
    const clickable = isMyTurn() && c === '';
    return `<div class="tt-cell ${clickable ? 'clickable' : ''}" data-i="${i}">${sym}</div>`;
  }).join('');
  const extra = v.phase === 'tiebreak' ? `<div class="mg-sub">平局！掷骰决胜：${Object.entries(v.tieDice || {}).map(([id, d]) => nameById(id) + ':' + d).join(' ')}</div>` : '';
  return mgCard(`
    <div class="mg-game">⭕ 井字闪电战</div>
    ${turnText()}
    <div class="tt-grid">${cells}</div>
    ${extra}
  `);
}

function renderRps(v) {
  const submitted = v.submitted && v.submitted[me.playerId];
  const btns = ['rock', 'scissors', 'paper'].map((c) => `<button data-c="${c}">${RPS_ICON[c]}</button>`).join('');
  return mgCard(`
    <div class="mg-game">✊ 极速猜拳</div>
    <div class="mg-sub">第 ${v.round} 局 · 三局两胜</div>
    ${scoreHtml(v.scores)}
    ${submitted ? '<div class="mg-sub">已出拳，等待对手…</div>' : `<div class="mg-actions">${btns}</div>`}
  `);
}

function renderReactLight(v) {
  const meP = mini.players.find((p) => p.id === me.playerId);
  const myColor = meP ? meP.color : 'red';
  return mgCard(`
    <div class="mg-game">💡 反应拍灯</div>
    <div class="react-light" style="background:${v.light ? COLOR_HEX[v.light] : '#444'}"></div>
    <div class="mg-sub">灯亮时点击“你的颜色”按钮！</div>
    ${scoreHtml(v.scores)}
    <button id="mgReact" style="background:${COLOR_HEX[myColor]};color:#fff">拍灯（${COLOR_NAME[myColor]}）</button>
  `);
}

function renderQuizThree(v) {
  const q = v.q;
  const prog = `<div class="mg-prog">第 <b>${Math.min(v.qIndex + 1, v.total)}</b> / ${v.total} 题</div>`;
  if (v.phase === 'ask') {
    // 第一界面：只显示「抢」按钮，抢到后才弹出选项
    return mgCard(`
      <div class="mg-game">🙋 抢答挑战</div>
      ${prog}
      <div class="mg-q">${q.q}</div>
      <div class="mg-buzz-wrap">
        <button id="mgBuzz" class="mg-buzz" aria-label="抢答">抢</button>
      </div>
      <div class="mg-sub">题目已出，谁先按下「抢」谁获得答题权！</div>
    `, 'quiz');
  }
  if (v.phase === 'answer') {
    if (v.buzzed === me.playerId) {
      const opts = q.opts.map((o, i) => `<button data-opt="${'ABCD'[i]}">${'ABCD'[i]}. ${o}</button>`).join('');
      return mgCard(`<div class="mg-game">🙋 抢答挑战</div>${prog}<div class="mg-q">${q.q}</div><div class="mg-sub">你抢到了！请作答</div><div class="mg-actions col">${opts}</div>`, 'quiz');
    }
    return mgCard(`<div class="mg-game">🙋 抢答挑战</div>${prog}<div class="mg-q">${q.q}</div><div class="mg-sub">${nameById(v.buzzed)} 抢到了，正在作答…</div>${scoreHtml(v.scores)}`);
  }
  return mgCard(`<div class="mg-game">🙋 抢答挑战</div>${prog}${scoreHtml(v.scores)}`);
}

function renderMemory(v) {
  const grid = v.cards.map((c) => {
    const show = c.up || c.matched;
    return `<div class="mc ${show ? 'open' : ''} ${c.matched ? 'matched' : ''}" data-i="${c.id}">${show ? c.face : ''}</div>`;
  }).join('');
  let choose = '';
  if (v.phase === 'choose') {
    const others = mini.players.filter((p) => p.id !== v.winner);
    choose = `<div class="mg-sub">${nameById(v.winner)} 选择一名玩家后退 2 格：</div><div class="mg-actions col">${others.map((p) => `<button data-t="${p.id}">${p.name}</button>`).join('')}</div>`;
  }
  return mgCard(`
    <div class="mg-game">🃏 ${v.kind === 'memory' ? '记忆翻牌' : '翻牌对对碰'}</div>
    ${turnText()}
    <div class="mc-grid">${grid}</div>
    ${scoreHtml(v.scores)}
    ${v.reveal ? '<div class="mg-sub reveal-bad">❌ 未配对，即将翻回换人…</div>' : (choose || (isMyTurn() ? '<div class="mg-sub">点击两张牌翻面</div>' : ''))}
  `);
}

function renderMatchPair(v) { return renderMemory(v); }

function turtleCardFace(face) {
  if (face === '🐢' || face === 'TURTLE') return '🐢';
  const m = /^p(\d+)$/.exec(face || '');
  if (m) {
    // 相同数字 → 相同图标，方便玩家一眼识别「成对」的牌
    const palette = ['🍎','🍊','🍋','🍉','🍇','🍓','🍑','🍒','🥝','🍍','🥥','🥭','🫐','🍌','🥕','🌽','🍄','🌶️','🧄','🧅'];
    return palette[Number(m[1]) % palette.length];
  }
  return '🃏';
}

// 斗地主式：对手只显示牌背（不泄露牌面），自己牌在底部正面展示
function oppBacksHtml(players, handCounts, cur, finishedMap) {
  return (players || []).map((p) => {
    if (p.id === me.playerId) return '';
    const isCur = p.id === cur;
    const done = finishedMap && finishedMap[p.id];
    const count = (handCounts && handCounts[p.id]) || 0;
    let backs;
    if (done) {
      backs = '<span class="opp-done">（出完）</span>';
    } else {
      const n = Math.min(count, 6);
      let b = '';
      for (let i = 0; i < n; i++) b += '<div class="card-back"></div>';
      backs = `<div class="opp-backs">${b}${count > n ? `<span class="opp-count">×${count}</span>` : ''}</div>`;
    }
    return `<div class="opp-row ${isCur ? 'active' : ''}">
      <div class="opp-meta"><span class="opp-name"><span class="dot" style="background:${COLOR_HEX[p.color]}"></span>${p.name}</span></div>
      ${backs}
    </div>`;
  }).join('');
}

function renderTurtle(v) {
  const myHand = (mini.state.view.myHand || []);
  const handHtml = myHand.length
    ? myHand.map((f) => {
        const isTurtle = f === '🐢' || f === 'TURTLE';
        return `<div class="turtle-card ${isTurtle ? 'turtle' : ''}">${turtleCardFace(f)}</div>`;
      }).join('')
    : '<div class="mg-sub">（空手，等抽牌）</div>';
  const imTurn = isMyTurn();
  const targetId = v.drawFromId;
  const targetPlayer = mini.players.find((p) => p.id === targetId);
  const targetCount = (v.handCounts && v.handCounts[targetId]) || 0;

  // 抽牌对象（下家）：手牌渲染成一张张可点选的牌背，玩家点哪张抽哪张
  let targetBlock = '';
  if (targetPlayer) {
    const c = COLOR_HEX[targetPlayer.color];
    const sym = COLOR_SYMBOL[targetPlayer.color] || '●';
    const immediateNext = v.order[(v.order.indexOf(v.cur) + 1) % v.order.length];
    const isNext = targetId === immediateNext;
    if (targetCount === 0) {
      targetBlock = `<div class="turtle-target">
        <span class="avatar" style="--c:${c}">${sym}</span>
        <div class="tt-meta"><span class="tt-name">${targetPlayer.name}</span><span class="tt-count">${isNext ? '你的下家' : '下家（顺延）'} · 暂无牌</span></div>
      </div>`;
    } else {
      const n = Math.min(targetCount, 8);
      let backs = '';
      for (let i = 0; i < n; i++) backs += `<div class="card-back turtle-pick${imTurn ? ' on' : ''}" data-idx="${i}"></div>`;
      targetBlock = `<div class="turtle-target focus">
        <span class="avatar" style="--c:${c}">${sym}</span>
        <div class="tt-meta"><span class="tt-name">${targetPlayer.name}</span><span class="tt-count">${isNext ? '你的下家' : '下家（顺延）'} · 手牌 ${targetCount} 张</span></div>
        <div class="turtle-picks">${backs}${targetCount > n ? `<span class="opp-count">×${targetCount}</span>` : ''}</div>
        <span class="tt-act">${imTurn ? '👆 点一张抽出来' : ''}</span>
      </div>`;
    }
  }

  // 其余对手：仅展示张数（状态栏，不可点）
  const others = mini.players.filter((p) => p.id !== me.playerId && p.id !== targetId);
  const othersHtml = others.map((p) => {
    const c = COLOR_HEX[p.color];
    const done = v.finished && v.finished[p.id];
    const cnt = (v.handCounts && v.handCounts[p.id]) || 0;
    return `<div class="turtle-other ${done ? 'done' : ''}"><span class="dot" style="background:${c}"></span>${p.name} · ${done ? '已出完' : cnt + ' 张'}</div>`;
  }).join('');

  const turnLine = imTurn
    ? `<div class="mg-turn mine"><span class="mg-turn-dot" style="background:${COLOR_HEX[colorById(me.playerId)]}"></span>轮到你 · 从下家手里抽一张</div>`
    : turnText();
  const hint = imTurn
    ? '<div class="mg-sub">点选下家手里的任意一张牌背，把那张牌抽出来（相同图案成对会自动弃掉）</div>'
    : `<div class="mg-sub">等待 ${nameById(v.cur)} 抽牌…</div>`;
  return mgCard(`
    <div class="mg-game">🐢 抓乌龟</div>
    ${targetBlock}
    ${othersHtml ? `<div class="turtle-others">${othersHtml}</div>` : ''}
    <div class="mg-sub">你的手牌（相同图案成对会自动弃掉；最后留 🐢 就输）</div>
    <div class="turtle-hand">${handHtml}</div>
    ${turnLine}
    ${hint}
  `);
}

function isUnoPlayable(v, c) {
  const t = v.top;
  return c.col === t.col || (c.num != null && t.num != null && c.num === t.num) || (c.sp && t.sp === c.sp);
}
function renderUno(v) {
  const top = v.top;
  const topLabel = top.sp ? ({ skip: '⊘跳过', reverse: '⇄反转', '+2': '+2' }[top.sp]) : top.num;
  const myHand = (v.myHand || []).map((c) => {
    const label = c.sp ? ({ skip: '⊘', reverse: '⇄', '+2': '+2' }[c.sp]) : c.num;
    const ok = isUnoPlayable(v, c);
    return `<div class="uno-card ${ok ? 'playable' : ''}" style="background:${COLOR_HEX[c.col]};color:#fff" data-id="${c.id}">${label}</div>`;
  }).join('');
  const counts = oppBacksHtml(mini.players, v.handCounts, v.cur, null);
  const imTurn = v.cur === me.playerId;
  const curColor = COLOR_HEX[colorById(v.cur)];
  return mgCard(`
    <div class="mg-game">🎴 UNO 速决</div>
    <div class="mg-sub">顶牌：<span class="uno-top" style="background:${COLOR_HEX[top.col]};color:#fff">${topLabel}</span></div>
    ${counts}
    <div class="uno-hand">${myHand || '（无手牌）'}</div>
    <div class="mg-turn ${imTurn ? 'mine' : ''}"><span class="mg-turn-dot" style="background:${curColor}"></span>轮到：<b style="color:${curColor}">${nameById(v.cur)}</b>${imTurn ? ' · 该你出手！' : ''}</div>
    <div class="mg-actions"><button id="mgDraw">摸牌</button></div>
    ${imTurn ? '' : '<div class="mg-sub">等待其他玩家…</div>'}
  `);
}

function renderLuckyDraw(v) {
  if (v.picking && mini.currentPlayerId === me.playerId) {
    const others = mini.players.filter((p) => p.id !== me.playerId);
    return mgCard(`<div class="mg-game">🎴 运气抽卡</div><div class="mg-sub">你抽到整蛊卡，指定一名目标：</div><div class="mg-actions col">${others.map((p) => `<button data-t="${p.id}">${p.name}</button>`).join('')}</div><div class="mg-results">${resultRows(v.results)}</div>`);
  }
  return mgCard(`
    <div class="mg-game">🎴 运气抽卡</div>
    ${turnText()}
    <div class="mg-results">${resultRows(v.results)}</div>
    <button id="mgDraw" ${isMyTurn() ? '' : 'disabled'}>${isMyTurn() ? '🎴 抽卡' : '等待其他玩家…'}</button>
  `);
}

function renderNumberGuess(v) {
  const guesses = Object.entries(v.guesses || {}).map(([id, val]) => `${nameById(id)}：${val}`).join('，');
  return mgCard(`
    <div class="mg-game">${v.kind === 'number-hunter' ? '🔍 数字猎人' : '💣 数字炸弹'}</div>
    <div class="mg-sub">范围：<b>${v.lo}</b> ~ <b>${v.hi}</b></div>
    ${guesses ? `<div class="mg-sub">已猜：${guesses}</div>` : ''}
    ${turnText()}
    ${isMyTurn() ? `<div class="mg-actions"><input id="mgNum" type="number" min="${v.lo}" max="${v.hi}"/><button id="mgGuess">猜！</button></div>` : '<div class="mg-sub">等待其他玩家…</div>'}
  `);
}

function renderDrawGuess(v) {
  const amDrawer = v.drawer === me.playerId;
  const word = v.word;
  const canvasTag = `<canvas id="mgCanvas" width="300" height="220" class="mg-canvas" ${amDrawer ? '' : 'style="pointer-events:none"'}>你的浏览器不支持画板</canvas>`;
  if (amDrawer) {
    return mgCard(`
      <div class="mg-game">🎨 你画我猜</div>
      <div class="mg-sub">你要画：<b>${word}</b>（不能写文字！）</div>
      ${canvasTag}
      <div class="mg-actions"><button id="mgClear">清空</button><button id="mgEnd">结束本轮</button></div>
      <div class="mg-sub">进度：${v.drawerIdx + 1}/${v.totalDrawers}</div>
    `, 'draw');
  }
  return mgCard(`
    <div class="mg-game">🎨 你画我猜</div>
    <div class="mg-sub">${nameById(v.drawer)} 正在作画，猜猜是什么？</div>
    ${canvasTag}
    <div class="mg-actions"><input id="mgGuessText" placeholder="输入答案"/><button id="mgGuessBtn">猜！</button></div>
    ${scoreHtml(v.scores)}
  `, 'guess');
}

function renderUndercover(v) {
  const myWord = v.myWord;
  const isUnder = v.isUndercover;
  if (v.phase === 'describe') {
    const amI = mini.currentPlayerId === me.playerId;
    const log = (v.descLog || []).map((d) => `<div>${nameById(d.id)}：${d.text}</div>`).join('');
    return mgCard(`
      <div class="mg-game">🕵️ 谁是卧底</div>
      <div class="mg-sub">你的词：<b>${myWord}</b>${isUnder ? '（卧底）' : ''}</div>
      <div class="mg-desc">${log}</div>
      <div class="mg-sub">${nameById(v.order[v.descIndex])} 正在描述…</div>
      ${amI ? `<div class="mg-actions"><input id="mgDesc" placeholder="描述你的词（不能含原词）"/><button id="mgDescBtn">提交</button></div>` : ''}
    `);
  }
  if (v.phase === 'vote') {
    if (v.votes && v.votes[me.playerId] !== undefined) {
      return mgCard(`<div class="mg-game">🕵️ 谁是卧底</div><div class="mg-sub">已投票</div>`);
    }
    const log = (v.descLog || []).map((d) => `<div>${nameById(d.id)}：${d.text}</div>`).join('');
    return mgCard(`
      <div class="mg-game">🕵️ 谁是卧底</div>
      <div class="mg-desc">${log}</div>
      <div class="mg-sub">投票谁是卧底：</div>
      <div class="mg-actions col">${mini.players.filter((p) => p.id !== me.playerId).map((p) => `<button data-v="${p.id}">${p.name}</button>`).join('')}</div>
    `);
  }
  return mgCard(`<div class="mg-game">🕵️ 谁是卧底</div><div class="mg-sub">投票结束</div>`);
}

// ============ 小游戏事件绑定 ============
// 过渡页可见倒计时：环 + 数字同步 5→0，归零即自动开始
function startIntroCountdown() {
  const numEl = document.getElementById('mgCountNum');
  const ringEl = document.getElementById('mgCountRing');
  if (!numEl) return;
  if (mini._cdTimer) clearInterval(mini._cdTimer);
  const total = mini._autoMs || 5000;
  const start = mini._start || Date.now();
  const C = 2 * Math.PI * 19; // 环周长（r=19）
  if (ringEl) { ringEl.style.strokeDasharray = String(C); }
  const tick = () => {
    if (!mini || mini.phase !== 'intro') {
      if (mini && mini._cdTimer) { clearInterval(mini._cdTimer); mini._cdTimer = null; }
      return;
    }
    const remain = Math.max(0, total - (Date.now() - start));
    numEl.textContent = String(Math.ceil(remain / 1000));
    if (ringEl) ringEl.style.strokeDashoffset = String(C * (1 - remain / total));
    if (remain <= 0 && mini._cdTimer) { clearInterval(mini._cdTimer); mini._cdTimer = null; }
  };
  tick();
  mini._cdTimer = setInterval(tick, 100);
}

function postRenderMiniGame() {
  if (mini.phase === 'intro') {
    const btn = document.getElementById('mgStart');
    if (btn) btn.onclick = () => {
      if (mini && mini._auto) clearTimeout(mini._auto);
      if (mini && mini._cdTimer) { clearInterval(mini._cdTimer); mini._cdTimer = null; }
      if (mini) mini.phase = 'playing';
      render();
    };
    startIntroCountdown();
    return;
  }
  if (mini.phase === 'playing') {
    bindPlayingEvents();
    // 命运转轮转盘动画
    if (mini.state && mini.state.view && mini.state.view.kind === 'fate-wheel') animateWheel();
  }
}

function bindPlayingEvents() {
  const v = mini.state && mini.state.view;
  const kind = (v && v.kind) || mini.gameId;
  const click = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };

  if (kind === 'fate-wheel') click('mgSpin', () => send({ type: 'minigame:action', action: { type: 'spin' } }));
  else if (kind === 'fate-dice') click('mgAct', () => send({ type: 'minigame:action', action: { type: 'roll' } }));
  else if (kind === 'dice-bull') {
    click('mgHit', () => send({ type: 'minigame:action', action: { choice: 'hit' } }));
    click('mgStand', () => send({ type: 'minigame:action', action: { choice: 'stand' } }));
  } else if (kind === 'dice-elim' || kind === 'dice-royale') click('mgAct', () => send({ type: 'minigame:action', action: { type: 'roll' } }));
  else if (kind === 'tic-tac') {
    document.querySelectorAll('.tt-cell.clickable').forEach((c) => {
      c.onclick = () => send({ type: 'minigame:action', action: { idx: Number(c.getAttribute('data-i')) } });
    });
  } else if (kind === 'rps') {
    document.querySelectorAll('[data-c]').forEach((b) => {
      b.onclick = () => send({ type: 'minigame:action', action: { choice: b.getAttribute('data-c') } });
    });
  } else if (kind === 'react-light') click('mgReact', () => {
    const myColor = (mini.players.find((p) => p.id === me.playerId) || {}).color || 'red';
    send({ type: 'minigame:action', action: { type: 'react', color: myColor } });
  });
  else if (kind === 'quiz-three') {
    // 提问阶段：点「抢」按钮抢答；抢到后（答题阶段）点选项作答
    click('mgBuzz', () => send({ type: 'minigame:action', action: { type: 'buzz' } }));
    document.querySelectorAll('[data-opt]').forEach((b) => {
      b.onclick = () => send({ type: 'minigame:action', action: { answer: b.getAttribute('data-opt') } });
    });
  } else if (kind === 'memory' || kind === 'match-pair') {
    if (v.phase === 'choose') {
      document.querySelectorAll('[data-t]').forEach((b) => {
        b.onclick = () => send({ type: 'minigame:action', action: { target: b.getAttribute('data-t') } });
      });
    } else {
      document.querySelectorAll('.mc:not(.open):not(.matched)').forEach((c) => {
        if (!isMyTurn()) return;
        c.onclick = () => send({ type: 'minigame:action', action: { idx: Number(c.getAttribute('data-i')) } });
      });
    }
  } else if (kind === 'turtle') {
    document.querySelectorAll('.turtle-pick.on').forEach((el) => {
      if (!isMyTurn()) return;
      el.onclick = () => send({ type: 'minigame:action', action: { type: 'draw', cardIndex: Number(el.getAttribute('data-idx')) } });
    });
  }
  else if (kind === 'uno') {
    document.querySelectorAll('.uno-card.playable').forEach((c) => {
      c.onclick = () => send({ type: 'minigame:action', action: { cardId: Number(c.getAttribute('data-id')) } });
    });
    click('mgDraw', () => send({ type: 'minigame:action', action: { type: 'draw' } }));
  } else if (kind === 'lucky-draw') {
    if (v.picking && mini.currentPlayerId === me.playerId) {
      document.querySelectorAll('[data-t]').forEach((b) => {
        b.onclick = () => send({ type: 'minigame:action', action: { target: b.getAttribute('data-t') } });
      });
    } else click('mgDraw', () => send({ type: 'minigame:action', action: { type: 'draw' } }));
  } else if (kind === 'number-hunter' || kind === 'number-bomb') {
    const ipt = document.getElementById('mgNum');
    if (ipt && (ipt.value === '' || isNaN(Number(ipt.value)))) ipt.value = v.lo; // 预填合法默认，避免空值卡死
    click('mgGuess', () => {
      let n = Number(val('mgNum'));
      if (!Number.isFinite(n)) { const i = document.getElementById('mgNum'); if (i) i.value = v.lo; return; }
      n = Math.round(n);
      if (n < v.lo) n = v.lo; // 收敛到合法范围，避免服务端静默拒绝导致“点了没反应”
      if (n > v.hi) n = v.hi;
      send({ type: 'minigame:action', action: { value: n } });
    });
  } else if (kind === 'draw-guess') {
    setupCanvas();
    click('mgClear', () => { const c = document.getElementById('mgCanvas'); if (c) { const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); } });
    click('mgEnd', () => send({ type: 'minigame:action', action: { type: 'end' } }));
    click('mgGuessBtn', () => { const t = val('mgGuessText'); if (t) send({ type: 'minigame:action', action: { type: 'guess', text: t } }); });
  } else if (kind === 'undercover') {
    click('mgDescBtn', () => { const t = val('mgDesc'); if (t) send({ type: 'minigame:action', action: { text: t } }); });
    document.querySelectorAll('[data-v]').forEach((b) => {
      b.onclick = () => send({ type: 'minigame:action', action: { vote: b.getAttribute('data-v') } });
    });
  }
}

function animateWheel() {
  const wheel = document.getElementById('wheel');
  if (!wheel) return;
  wheel.style.transform = `rotate(${mini.wheelAngle}deg)`;
  const results = (mini.state.view.results || []);
  const len = results.length;
  if (len > (mini.lastResultsLen || 0)) {
    const last = results[len - 1];
    const cell = last.cell;
    const currentMod = ((mini.wheelAngle % 360) + 360) % 360;
    const desiredMod = ((330 - cell * 60) % 360 + 360) % 360;
    let delta = desiredMod - currentMod;
    if (delta < 0) delta += 360;
    mini._pendingSpin = mini.wheelAngle + 360 * 5 + delta;
  }
  mini.lastResultsLen = len;
  if (mini._pendingSpin != null) {
    const target = mini._pendingSpin;
    mini._pendingSpin = null;
    mini.wheelAngle = target;
    requestAnimationFrame(() => { wheel.style.transform = `rotate(${target}deg)`; });
  }
}

// 你画我猜：画板
function setupCanvas() {
  const canvas = document.getElementById('mgCanvas');
  if (!canvas || canvas._bound) return;
  canvas._bound = true;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#222';
  // 先重绘服务器已存储的笔迹
  drawStrokes(ctx, (mini.state.view.strokes || []));
  let drawing = false; let cur = [];
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
  canvas.onpointerdown = (e) => { drawing = true; cur = [pos(e)]; };
  canvas.onpointermove = (e) => {
    if (!drawing) return;
    const p = pos(e); cur.push(p);
    ctx.beginPath(); ctx.moveTo(cur[cur.length - 2].x, cur[cur.length - 2].y); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  canvas.onpointerup = () => { if (!drawing) return; drawing = false; if (cur.length > 1) send({ type: 'minigame:action', action: { type: 'draw', seg: cur } }); cur = []; };
}
function drawStrokes(ctx, strokes) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of strokes || []) {
    if (!s || !s.length) continue;
    ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y);
    for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
    ctx.stroke();
  }
}

// ============ 大厅 / 等待房 ============
function renderLobbyOrWaiting() {
  if (!me.roomId) {
    // 首页：仅首次挂载，避免输入过程中被 state 推送重建导致失焦/闪屏
    if (document.getElementById('createBtn')) return;
    app.innerHTML = `
      <div class="card home">
        <div class="home-hero">✈️</div>
        <h1>多人飞行棋</h1>
        <p class="home-sub">和朋友一起，来一场欢乐的飞行大冒险！</p>
        <div class="feat-chips">
          <span class="feat-chip">👥 2-4 人同玩</span>
          <span class="feat-chip">🎲 19 款小游戏</span>
          <span class="feat-chip">🏆 飞行大冒险</span>
        </div>
        <input id="name" placeholder="你的昵称" />
        <button id="createBtn">🎲 创建房间</button>
        <hr />
        <div class="join-row">
          <input id="code" placeholder="房间号（4位）" style="text-transform:uppercase" />
          <button id="joinBtn" class="btn-ghost">加入</button>
        </div>
      </div>`;
    document.getElementById('createBtn').onclick = () => send({ type: 'create', name: val('name') });
    document.getElementById('joinBtn').onclick = () => send({ type: 'join', roomId: val('code').toUpperCase(), name: val('name') });
    return;
  }
  const players = game ? game.players : [];
  const isHost = me.playerId === (game && game.hostId);
  const existing = document.getElementById('roomCode');
  if (existing) {
    // 增量更新：房间卡片只挂载一次，之后仅刷新动态区块，杜绝整卡重建闪屏
    const listEl = app.querySelector('.player-list');
    if (listEl) listEl.innerHTML = roomSlots(players);
    const countEl = app.querySelector('.room-count');
    if (countEl) countEl.textContent = `${players.length}/4`;
    const padsEl = app.querySelector('.base-pads');
    if (padsEl) padsEl.innerHTML = takenPads(players);
    const logEl = app.querySelector('.log');
    if (logEl) logEl.innerHTML = (game ? game.log : []).map((l) => `<div>${l}</div>`).join('');
    const actionsEl = app.querySelector('.actions');
    if (actionsEl) {
      actionsEl.innerHTML = isHost
        ? `<button id="addBot" class="btn-ghost">➕ 添加电脑</button><button id="startBtn" class="btn-start" ${players.length < 2 ? 'disabled' : ''}>🚀 开始游戏</button>`
        : '<p class="room-tip">等待房主开始游戏…</p>';
      const ab = document.getElementById('addBot'); if (ab) ab.onclick = () => send({ type: 'addBot' });
      const sb = document.getElementById('startBtn'); if (sb) sb.onclick = () => send({ type: 'start' });
    }
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) copyBtn.onclick = () => copyRoomCode(copyBtn);
    return;
  }
  // 首次挂载房间卡片
  app.innerHTML = `
    <div class="card room">
      <div class="home-hero" style="font-size:40px">🛫</div>
      <h2>房间大厅 <span class="room-count">${players.length}/4</span></h2>
      <div class="code-pill">
        <span class="code" id="roomCode">${me.roomId}</span>
        <button class="copy-btn" id="copyBtn">📋 复制</button>
      </div>
      <p class="room-tip">把房间号发给朋友，让他们加入一起玩～</p>
      <div class="base-pads">${takenPads(players)}</div>
      <div class="player-list">${roomSlots(players)}</div>
      <div class="actions">
        ${isHost
          ? `<button id="addBot" class="btn-ghost">➕ 添加电脑</button><button id="startBtn" class="btn-start" ${players.length < 2 ? 'disabled' : ''}>🚀 开始游戏</button>`
          : '<p class="room-tip">等待房主开始游戏…</p>'}
      </div>
      <div class="log">${(game ? game.log : []).map((l) => `<div>${l}</div>`).join('')}</div>
    </div>`;
  if (isHost) {
    document.getElementById('addBot').onclick = () => send({ type: 'addBot' });
    document.getElementById('startBtn').onclick = () => send({ type: 'start' });
  }
  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) copyBtn.onclick = () => copyRoomCode(copyBtn);
}

function copyRoomCode(btn) {
  const code = me.roomId;
  const done = () => {
    btn.textContent = '✅ 已复制';
    btn.classList.add('done');
    toast('房间号已复制：' + code);
    setTimeout(() => { btn.textContent = '📋 复制'; btn.classList.remove('done'); }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(done).catch(() => fallbackCopy(code, done));
  } else fallbackCopy(code, done);
}
function fallbackCopy(text, done) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); done();
  } catch (e) { toast('复制失败，房间号：' + text); }
}

function playerRow(p) {
  const sym = COLOR_SYMBOL[p.color] || '●';
  const c = COLOR_HEX[p.color];
  const cd = COLOR_HEX_D[p.color];
  let status = '已就位', cls = 'ready', badge = '✅';
  if (p.isHost) { status = '房主'; cls = 'host'; badge = '👑'; }
  else if (p.isAI) { status = '电脑'; cls = 'ai'; badge = '🤖'; }
  const isMe = p.playerId === me.playerId;
  return `<div class="prow ${isMe ? 'me' : ''}">
    <span class="avatar" style="--c:${c};--c-d:${cd}">${sym}</span>
    <span class="pname">${p.name}${isMe ? ' <span class="me-tag">你</span>' : ''}</span>
    <span class="pstatus ${cls}">${badge} ${status}</span>
  </div>`;
}

// 房间槽位：已加入玩家 + 空位占位（最多 4 人）
function roomSlots(players) {
  let html = players.map(playerRow).join('');
  for (let i = players.length; i < 4; i++) {
    html += `<div class="prow empty">
      <span class="avatar empty-slot">＋</span>
      <span class="pname">等待玩家加入…</span>
      <span class="pstatus wait">🔓 空位</span>
    </div>`;
  }
  return html;
}

// 队伍色板：已被占用的队伍高亮
function takenPads(players) {
  const taken = new Set(players.map((p) => p.color));
  return ['red', 'yellow', 'blue', 'green']
    .map((col) => `<span class="pad ${taken.has(col) ? 'taken' : ''}" style="background:var(--p-${col})" title="${col}队"></span>`)
    .join('');
}

// ============ 对局界面 ============
// 骰子点数 → 3x3 点阵
function dicePips(n) {
  if (n !== 1 && n !== 2 && n !== 3 && n !== 4 && n !== 5 && n !== 6) {
    return '<span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span><span class="pip"></span>';
  }
  const map = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  let h = '';
  for (let i = 0; i < 9; i++) h += `<span class="pip ${map[n].includes(i) ? 'on' : ''}"></span>`;
  return h;
}

// 骰子定格目标朝向：让点数 k 显示在正面（朝向用户）
// 各面初始法向：front=1(+Z) back=6(-Z) right=3(+X) left=4(-X) top=2(-Y) bottom=5(+Y)
// 要让目标面的法向转到 +Z（屏幕外/朝向用户），最后整体倾斜 -15deg/-25deg 保留透视
const DICE_TARGET = {
  1: 'translateZ(-44px) rotateX(-15deg) rotateY(-25deg)',                   // +Z 已朝前
  2: 'translateZ(-44px) rotateX(-15deg) rotateY(-25deg) rotateX(-90deg)',     // -Y(top 面) -> +Z
  3: 'translateZ(-44px) rotateX(-15deg) rotateY(-25deg) rotateY(-90deg)',    // +X -> +Z
  4: 'translateZ(-44px) rotateX(-15deg) rotateY(-25deg) rotateY(90deg)',    // -X -> +Z
  5: 'translateZ(-44px) rotateX(-15deg) rotateY(-25deg) rotateX(90deg)',    // +Y(bottom 面) -> +Z
  6: 'translateZ(-44px) rotateX(-15deg) rotateY(-25deg) rotateY(180deg)',    // -Z -> +Z
};

// 侧栏 3D 立体骰子（常驻元素，靠 display 控制显隐，避免每次重建）
function dice3dHtml() {
  return `
    <svg width="0" height="0" style="position:absolute" aria-hidden="true">
      <defs>
        <filter id="pencil" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035 0.05" numOctaves="3" seed="11" result="n"></feTurbulence>
          <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap>
        </filter>
      </defs>
    </svg>
    <div class="dice3d-pos" id="dicePos" style="display:none">
      <div class="dice3d-wrap">
        <div class="cube" id="cube">
          <div class="face front">${dicePips(1)}</div>
          <div class="face back">${dicePips(6)}</div>
          <div class="face right">${dicePips(3)}</div>
          <div class="face left">${dicePips(4)}</div>
          <div class="face top">${dicePips(2)}</div>
          <div class="face bottom">${dicePips(5)}</div>
        </div>
      </div>
    </div>`;
}

// 收到真实点数后定格：保证最少滚动 400ms，并播放落地弹跳
function settleDice(value) {
  dicePending = value; // 始终记录最新真实点数（竞态兜底：动画期间来新点数也以最新为准）
  if (!diceRolling) {
    // 非主动滚动状态（AI 掷骰 / 重连 / 被动同步）：直接定格，不弹
    const c2 = document.getElementById('cube');
    if (c2) {
      c2.classList.remove('rolling');
      c2.style.transition = 'none';
      c2.style.transform = DICE_TARGET[value] || DICE_TARGET[1];
    }
    return;
  }
  if (diceSettling) return; // 已在定格流程中，定时器会读取最新 dicePending，无需重启
  diceSettling = true;
  const elapsed = Date.now() - diceRollStart;
  const remain = Math.max(0, 400 - elapsed);
  if (diceSettleTimer) clearTimeout(diceSettleTimer);
  diceSettleTimer = setTimeout(() => {
    diceSettling = false;
    diceRolling = false;
    if (diceSettleTimer) { clearTimeout(diceSettleTimer); diceSettleTimer = null; }
    const c2 = document.getElementById('cube');
    const p2 = document.getElementById('dicePos');
    if (c2) {
      c2.classList.remove('rolling');
      c2.style.transition = 'transform .5s cubic-bezier(.2,.8,.3,1)';
      c2.style.transform = DICE_TARGET[dicePending] || DICE_TARGET[1]; // 定格到最新点数，避免与日志脱节
    }
    if (p2) {
      p2.classList.remove('rolling');
      p2.classList.add('landed');
      setTimeout(() => { const p = document.getElementById('dicePos'); if (p) p.classList.remove('landed'); }, 480);
    }
  }, remain);
}

// 点击掷骰：侧栏 3D 骰子跳动 + 翻滚，收到真实点数后定格（不重建页面）
function startDiceRoll() {
  if (diceRolling || !canRoll()) return;
  diceRolling = true;
  diceSettling = false;
  dicePending = null;
  diceRollStart = Date.now();
  const pos = document.getElementById('dicePos');
  const cube = document.getElementById('cube');
  const rb = document.getElementById('rollBtn');
  if (rb) rb.disabled = true;
  if (pos) { pos.style.display = ''; pos.classList.add('rolling'); }
  if (cube) { cube.classList.add('rolling'); cube.style.transition = 'none'; cube.style.transform = ''; }
  send({ type: 'roll' });
}

// 挂载一次：构建对局 DOM 结构（带稳定 id），后续状态更新走 updateGame() 局部刷新
function renderGame() {
  app.innerHTML = `
    <div class="game">
      <div class="boardWrap" id="boardWrap">
        ${boardSVG()}
        <div class="game-tools">
          <button class="tool" id="toolSettings" title="设置">⚙</button>
          <button class="tool" id="toolExit" title="退出">✕</button>
        </div>
      </div>
      <div class="side">
        <div class="side-section">
          <div class="side-h">🎲 骰子</div>
          <div class="dice-stage">${dice3dHtml()}</div>
          <div id="rollWrap">${canRoll() && !diceRolling ? '<button id="rollBtn" class="rollHint">🎲 掷骰子</button>' : ''}</div>
        </div>
        <div class="side-section">
          <h3>第 <span id="roundNum">${game.round}</span> 轮 · 玩家</h3>
          <div id="players">${game.players.map(playerCard).join('')}</div>
        </div>
        <div class="side-section">
          <div class="side-h">📜 对局日志</div>
          <div class="log" id="log">${(game.log || []).map((l) => `<div>${l}</div>`).join('')}</div>
        </div>
      </div>
    </div>`;
  for (const k in planePos) delete planePos[k];
  // 重建棋盘时必须同步清空防抖缓存，否则新建的飞机元素会被 positionPlanes 的
  // 「planeTargetStep[k] === desiredStep 提前 return」判定卡在 (0,0)（如小游戏结束后回到棋盘）
  for (const k in planeState) delete planeState[k];
  for (const k in planeStep) delete planeStep[k];
  for (const k in planeTargetStep) delete planeTargetStep[k];
  for (const k in planeAnimToken) delete planeAnimToken[k];
  const ts = document.getElementById('toolSettings');
  if (ts) ts.onclick = toggleSettings;
  const te = document.getElementById('toolExit');
  if (te) te.onclick = () => { if (confirm('确定退出房间？')) location.reload(); };
  const pos = document.getElementById('dicePos');
  if (pos) { pos.style.cursor = 'pointer'; pos.onclick = startDiceRoll; }
  // 首次挂载时若服务端已带骰子点数，直接定格（避免显示初始面 2）
  const cubeInit = document.getElementById('cube');
  if (cubeInit && game.dice != null) {
    cubeInit.classList.remove('rolling');
    cubeInit.style.transition = 'none';
    cubeInit.style.transform = DICE_TARGET[game.dice] || DICE_TARGET[1];
  }
  prevLogLen = (game.log || []).length;
  updateGame();
}

// 从当前 game 状态重算每个飞机的目标格子，更新 .plane 的 data-x/data-y 与 current/movable 类
function syncPlaneTargets() {
  const C = B.CELL;
  const byCell = {};
  for (const p of game.players) {
    p.planes.forEach((pl, i) => {
      const cell = pl.state === 'base' ? B.BASE[p.color][i] : B.stepToCell(p.color, pl.step);
      const key = cell[0] + ',' + cell[1];
      (byCell[key] = byCell[key] || []).push({ color: p.color, idx: i, cur: p.id === game.currentTurn, state: pl.state, step: pl.step });
    });
  }
  for (const key in byCell) {
    const list = byCell[key];
    const [c, r] = key.split(',').map(Number);
    const x = c * C + C / 2;
    const y = r * C + C / 2;
    list.forEach((o, k) => {
      const off = list.length > 1 ? (k - (list.length - 1) / 2) * 13 : 0;
      const g = document.querySelector(`.plane[data-color="${o.color}"][data-idx="${o.idx}"]`);
      if (!g) return;
      g.dataset.x = x + off;
      g.dataset.y = y;
      g.dataset.state = o.state;
      g.dataset.step = o.state === 'base' ? -1 : o.step;
      g.classList.toggle('current', !!o.cur);
      g.classList.toggle('movable', isMovable(o.color, o.idx));
    });
  }
}

// 同视图增量刷新：只更新动态内容，不重建 DOM（点击/状态推送不再整页"刷新"）
function updateGame() {
  const roundEl = document.getElementById('roundNum');
  if (roundEl) roundEl.textContent = String(game.round);
  const playersEl = document.getElementById('players');
  if (playersEl) playersEl.innerHTML = game.players.map(playerCard).join('');
  const logEl = document.getElementById('log');
  if (logEl) { logEl.innerHTML = (game.log || []).map((l) => `<div>${l}</div>`).join(''); logEl.scrollTop = logEl.scrollHeight; }
  const rollWrap = document.getElementById('rollWrap');
  if (rollWrap) {
    if (canRoll() && !diceRolling) {
      if (!document.getElementById('rollBtn')) {
        rollWrap.innerHTML = '<button id="rollBtn" class="rollHint">🎲 掷骰子（也可点上方骰子）</button>';
        const rb = document.getElementById('rollBtn');
        if (rb) rb.onclick = startDiceRoll;
      }
    } else {
      rollWrap.innerHTML = '';
    }
  }
  if (!diceRolling) {
    const pos = document.getElementById('dicePos');
    if (pos) pos.style.display = (game.dice != null || canRoll()) ? '' : 'none';
    // 兜底：静止态下骰子必须严格等于当前 game.dice（与下方日志同源），杜绝任何竞态导致的显示脱节
    if (game.dice != null) {
      const c2 = document.getElementById('cube');
      const want = DICE_TARGET[game.dice] || DICE_TARGET[1];
      if (c2 && c2.style.transform !== want) {
        c2.classList.remove('rolling');
        c2.style.transition = 'none';
        c2.style.transform = want;
      }
    }
  }
  syncPlaneTargets();
  attachPlaneClicks();
  positionPlanes();
  detectCrash();
}

function playerCard(p) {
  const active = p.id === game.currentTurn;
  const skip = p.skipTurns > 0 ? ` · 暂停${p.skipTurns}轮` : '';
  const tags = [];
  if (p.shield) tags.push('🛡');
  if (p.doubleNext) tags.push('⏩');
  const prog = Math.max(0, Math.min(100, ((p.doneCount || 0) / 4) * 100));
  return `<div class="pcard ${active ? 'active' : ''}" style="border-left:6px solid ${COLOR_HEX[p.color]}">
    <div class="pcard-row">
      <b>${p.name}</b>${p.isHost ? ' 👑' : ''}${p.isAI ? ' 🤖' : ''} ${tags.join(' ')}
      ${active ? '<span class="turn">← 行动中</span>' : ''}
    </div>
    <div class="pcard-prog"><div class="pcard-prog-fill" style="width:${prog}%;background:${COLOR_HEX[p.color]}"></div></div>
    <div class="pcard-meta">到达终点 ${p.doneCount}/4${skip}</div>
  </div>`;
}

const planePos = {};
const planeState = {};      // 每架飞机上一次状态 base/field
const planeStep = {};       // 每架飞机上一次 committed step（-1 表示仍在 base）
const planeTargetStep = {}; // 当前已发起动画的目标 step（动画进行中也保持），用于防抖避免重复触发
const planeAnimToken = {};  // 逐格动画令牌：新移动启动即自增，用于取消未完成的旧动画

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// 棋盘格内的彩色方向箭头（指向行进方向，四色轮换）
function arrowSVG(ax, ay, dx, dy, col, isSafe) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const px = -uy, py = ux;
  const s = 5.5;
  const tipX = ax + ux * s, tipY = ay + uy * s;
  const b1x = ax - ux * s * 0.5 + px * s * 0.75, b1y = ay - uy * s * 0.5 + py * s * 0.75;
  const b2x = ax - ux * s * 0.5 - px * s * 0.75, b2y = ay - uy * s * 0.5 - py * s * 0.75;
  const op = isSafe ? 0.55 : 0.30;
  return `<polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${b1x.toFixed(1)},${b1y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)}" fill="${col}" opacity="${op}"></polygon>`;
}

function planeSVG(color) {
  const g = `url(#grad-${color})`;
  const DARK = { red: '#5a0f1a', yellow: '#6b4e00', blue: '#0c2c50', green: '#143a05' };
  const ds = DARK[color] || '#333';
  const SW = 2.4;
  return `
    <ellipse cx="0" cy="17.5" rx="9" ry="2.6" fill="rgba(20,16,40,0.10)"></ellipse>
    <path d="M-1,-3 L-17,-9 L-19.5,-2.5 L-1,2.5 Z" fill="${g}" stroke="${ds}" stroke-width="${SW}" stroke-linejoin="round"></path>
    <path d="M1,-3 L17,-9 L19.5,-2.5 L1,2.5 Z" fill="${g}" stroke="${ds}" stroke-width="${SW}" stroke-linejoin="round"></path>
    <path d="M-1,8 L-8,13 L-9.5,15.5 L-1,11 Z" fill="${g}" stroke="${ds}" stroke-width="${SW}" stroke-linejoin="round"></path>
    <path d="M1,8 L8,13 L9.5,15.5 L1,11 Z" fill="${g}" stroke="${ds}" stroke-width="${SW}" stroke-linejoin="round"></path>
    <path d="M0,-17 C5,-15 5.6,-7 4.6,2 C4.6,9 3,14 0,17 C-3,14 -4.6,9 -4.6,2 C-5.6,-7 -5,-15 0,-17 Z" fill="${g}" stroke="${ds}" stroke-width="2.8" stroke-linejoin="round"></path>
    <path d="M-1.6,-13 C-2.7,-6 -2.4,4 -1.3,12" stroke="rgba(255,255,255,0.6)" stroke-width="1.5" fill="none" stroke-linecap="round"></path>
    <ellipse cx="0" cy="-5" rx="2.4" ry="4.3" fill="url(#cockpit)" stroke="${ds}" stroke-width="1.4"></ellipse>
    <circle cx="0" cy="-16.4" r="2.3" fill="#3a3a3a"></circle>
    <line x1="0" y1="-20.5" x2="0" y2="-12.3" stroke="#3a3a3a" stroke-width="1.3" stroke-linecap="round"></line>
    <line x1="-3.2" y1="-16.4" x2="3.2" y2="-16.4" stroke="#3a3a3a" stroke-width="1.3" stroke-linecap="round"></line>`;
}

function boardSVG() {
  const C = B.CELL;
  const W = B.N * C;

  // 安全格（四色起点）
  const safe = new Set();
  for (const color of B.COLORS) safe.add(B.MAIN[B.START_INDEX[color]].join(','));

  // ── 精确还原经典中国飞行棋参考图配色 ──
  const BC = {           // 基地纯色（高饱和扁平）
    red: '#E53935', yellow: '#FDD835', blue: '#1E88E5', green: '#43A047',
  };
  // 路径格：纯白填充 + 加粗彩色边框（用边框线条表达格子的颜色身份，见 ③ 主跑道）

  // 基地角落：居中对齐 B.BASE 的 2×2 停机位中心点
  const BASE_RECTS = {
    green:  { x: 0.55 * C, y: 0.55 * C },
    yellow: { x: 10.55 * C, y: 0.55 * C },
    red:    { x: 0.55 * C, y: 10.55 * C },
    blue:   { x: 10.55 * C, y: 10.55 * C },
  };

  // ════════════════════════════════════════
  // 路径着色：每个格子都套上颜色 —— 四色循环（红→黄→蓝→绿）
  //   按 B.MAIN 顺序逐格上色，相邻格颜色不同（连续 0,1,2,3 循环），不会糊成同色长串
  // ════════════════════════════════════════
  const pathColorMap = {};
  {
    let tick = 0;
    B.MAIN.forEach((_, i) => {
      pathColorMap[B.MAIN[i].join(',')] = B.COLORS[tick % 4];
      tick++;
    });
  }

  const defs = `<defs>
    <!-- 飞机渐变（保留金属质感） -->
    <linearGradient id="grad-red" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF9DB4"/><stop offset=".55" stop-color="#FF5C7C"/><stop offset="1" stop-color="#D8355C"/>
    </linearGradient>
    <linearGradient id="grad-yellow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFE08A"/><stop offset=".55" stop-color="#FFC53D"/><stop offset="1" stop-color="#E09200"/>
    </linearGradient>
    <linearGradient id="grad-blue" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9CCBFF"/><stop offset=".55" stop-color="#4DA3FF"/><stop offset="1" stop-color="#2270D6"/>
    </linearGradient>
    <linearGradient id="grad-green" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9BF0C0"/><stop offset=".55" stop-color="#43D17A"/><stop offset="1" stop-color="#1F9E5B"/>
    </linearGradient>
    <radialGradient id="cockpit" cx=".4" cy=".32" r=".85">
      <stop offset="0" stop-color="#eaffff"/><stop offset=".55" stop-color="#7fd4ff"/><stop offset="1" stop-color="#2f8fd6"/>
    </radialGradient>
    <filter id="bs" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.16"/>
    </filter>
  </defs>`;

  let cells = '';

  // ════════════════════════════════════════
  // ① 底板：纯白 + 粗黑圆角外框
  // ════════════════════════════════════════
  cells += `<rect x="0" y="0" width="${W}" height="${W}" rx="8" fill="#FFFFFF" stroke="#222" stroke-width="4"/>`;

  // ════════════════════════════════════════
  // ② 四角基地：扁平纯色大块 + 大白色停机位圆圈
  // ════════════════════════════════════════
  for (const color of B.COLORS) {
    const br = BASE_RECTS[color];
    // 纯色底块（无渐变，扁平风格）
    cells += `<rect x="${br.x + 2}" y="${br.y + 2}" width="${4 * C - 4}" height="${4 * C - 4}" rx="6"
      fill="${BC[color]}" stroke="#222" stroke-width="2.8"/>`;
    // 4 个大白色停机位圆圈（r=0.56C > 飞机尺寸，飞机完整落入圈内）
    B.BASE[color].forEach(([cc, rr], k) => {
      const cx = cc * C + C / 2;
      const cy = rr * C + C / 2;
      cells += `<circle cx="${cx}" cy="${cy}" r="${C * 0.56}" fill="#FFF" stroke="#222" stroke-width="2.5"/>`;
      cells += `<text x="${cx}" y="${cy + 5.5}" text-anchor="middle" font-size="14" font-weight="900" fill="${BC[color]}">${k + 1}</text>`;
    });
  }

  // ════════════════════════════════════════
  // ③ 主跑道：长彩色段(13格/色) + 纯白中性格 + 内圈 + 粗黑边框
  // ════════════════════════════════════════
  B.MAIN.forEach(([c, r], i) => {
    const x = c * C, y = r * C;
    const key = c + ',' + r;
    const pc = pathColorMap[key];

    // 纯白填充；有颜色身份的格子用「加粗彩色边框」表达颜色，中性白格保持细黑边
    if (pc) {
      cells += `<rect x="${x + 2}" y="${y + 2}" width="${C - 4}" height="${C - 4}" rx="6"
        fill="#FFFFFF" stroke="${BC[pc]}" stroke-width="7"/>`;
    } else {
      cells += `<rect x="${x + 2}" y="${y + 2}" width="${C - 4}" height="${C - 4}" rx="6"
        fill="#FFFFFF" stroke="#222" stroke-width="2.0"/>`;
    }

    // 每格内圈（所有格子都有，参考图特征）
    cells += `<circle cx="${x + C / 2}" cy="${y + C / 2}" r="${C * 0.13}"
      fill="rgba(0,0,0,0.05)" stroke="rgba(0,0,0,0.10)" stroke-width="0.8"/>`;

    // 起点格：深色实心圆标记 + 符号
    if (safe.has(key)) {
      const sc = B.COLORS.find((col) => B.MAIN[B.START_INDEX[col]].join(',') === key);
      if (sc) {
        cells += `<circle cx="${x + C / 2}" cy="${y + C / 2}" r="${C * 0.28}"
          fill="${BC[sc]}" stroke="#FFF" stroke-width="2.2"/>`;
        cells += `<text x="${x + C / 2}" y="${y + C / 2 + 5}" text-anchor="middle"
          font-size="14" font-weight="900" fill="#FFF">${COLOR_SYMBOL[sc]}</text>`;
      }
    }

    // 方向箭头
    const nxt = B.MAIN[(i + 1) % 52];
    const acol = COLOR_HEX[B.COLORS[i % 4]];
    cells += arrowSVG(x + C / 2, y + C / 2, nxt[0] - c, nxt[1] - r, acol, safe.has(key));
  });

  // ════════════════════════════════════════
  // ④ 回家路：独立彩色走廊 + 白色圆圈（与主轨道清晰隔开）
  // ════════════════════════════════════════
  for (const color of B.COLORS) {
    const home = B.HOME[color];
    // 走廊背景：比主轨道格略窄，两侧留白形成物理间隔
    let mnR = 99, mxR = -1, mnC = 99, mxC = -1;
    home.forEach(([c, r]) => { mnR = Math.min(mnR, r); mxR = Math.max(mxR, r); mnC = Math.min(mnC, c); mxC = Math.max(mxC, c); });
    const laneX = Math.min(mnC, mxC) * C + C * 0.16;
    const laneY = Math.min(mnR, mxR) * C + C * 0.16;
    const laneW = (Math.abs(mxC - mnC) + 1) * C - C * 0.32;
    const laneH = (Math.abs(mxR - mnR) + 1) * C - C * 0.32;
    cells += `<rect x="${laneX}" y="${laneY}" width="${laneW}" height="${laneH}" rx="${C * 0.28}"
      fill="${hexToRgba(BC[color], 0.18)}" stroke="${BC[color]}" stroke-width="2.4" stroke-opacity="0.6"/>`;
    // 白色圆圈 + 本色描边
    home.forEach(([c, r], hi) => {
      const cx = c * C + C / 2, cy = r * C + C / 2;
      cells += `<circle cx="${cx}" cy="${cy}" r="${C * 0.40}"
        fill="#FFFFFF" stroke="${BC[color]}" stroke-width="3.0"/>`;
      cells += `<circle cx="${cx}" cy="${cy}" r="${C * 0.17}"
        fill="${hexToRgba(BC[color], 0.16)}" stroke="${BC[color]}" stroke-width="1.1" stroke-opacity="0.7"/>`;
      if (hi > 0) {
        const dx = B.CENTER[0] - c, dy = B.CENTER[1] - r;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        const px = -uy, py = ux;
        const sz = 7;
        for (let j = 0; j < 3; j++) {
          const off = (j - 1) * sz * 0.7;
          const tipX = cx + ux * sz + px * off;
          const tipY = cy + uy * sz + py * off;
          const b1x = cx - ux * sz * 0.4 + px * (sz * 0.55 + off);
          const b1y = cy - uy * sz * 0.4 + py * (sz * 0.55 + off);
          const b2x = cx - ux * sz * 0.4 - px * (sz * 0.55 + off);
          const b2y = cy - uy * sz * 0.4 - py * (sz * 0.55 - off);
          cells += `<polygon points="${tipX.toFixed(1)},${tipY.toFixed(1)} ${b1x.toFixed(1)},${b1y.toFixed(1)} ${b2x.toFixed(1)},${b2y.toFixed(1)}"
            fill="${BC[color]}" opacity="0.7"/>`;
        }
      }
    });
  }

  // ════════════════════════════════════════
  // ⑤ 中心终点：四色三角汇聚 + 白圆心 ★
  // ════════════════════════════════════════
  const [cc_, cr_] = B.CENTER;
  const cxc = cc_ * C + C / 2, cyc = cr_ * C + C / 2, csz = C * 0.50;
  cells += `<polygon points="${cxc},${cyc - csz} ${cxc - csz},${cyc} ${cxc + csz},${cyc}"
    fill="${BC.red}" stroke="#222" stroke-width="2.2" stroke-linejoin="round"/>`;
  cells += `<polygon points="${cxc + csz},${cyc} ${cxc},${cyc - csz} ${cxc},${cyc + csz}"
    fill="${BC.yellow}" stroke="#222" stroke-width="2.2" stroke-linejoin="round"/>`;
  cells += `<polygon points="${cxc},${cyc + csz} ${cxc - csz},${cyc} ${cxc + csz},${cyc}"
    fill="${BC.blue}" stroke="#222" stroke-width="2.2" stroke-linejoin="round"/>`;
  cells += `<polygon points="${cxc - csz},${cyc} ${cxc},${cyc - csz} ${cxc},${cyc + csz}"
    fill="${BC.green}" stroke="#222" stroke-width="2.2" stroke-linejoin="round"/>`;
  cells += `<circle cx="${cxc}" cy="${cyc}" r="${C * 0.18}" fill="#FFF" stroke="#222" stroke-width="2.2"/>`;
  cells += `<text x="${cxc}" y="${cyc + 5.5}" text-anchor="middle" font-size="15"
    font-weight="900" fill="${BC.red}">★</text>`;

  // ════════════════════════════════════════
  // ⑥ 飞机（坐标与②中停机位圆圈严格一致）
  // ════════════════════════════════════════
  const byCell = {};
  for (const p of game.players) {
    p.planes.forEach((pl, i) => {
      const cell = pl.state === 'base' ? B.BASE[p.color][i] : B.stepToCell(p.color, pl.step);
      const key = cell[0] + ',' + cell[1];
      (byCell[key] = byCell[key] || []).push({ color: p.color, idx: i, cur: p.id === game.currentTurn });
    });
  }
  let planes = '';
  for (const key in byCell) {
    const list = byCell[key];
    const [c, r] = key.split(',').map(Number);
    const x = c * C + C / 2;
    const y = r * C + C / 2;
    const n = list.length;
    list.forEach((o, k) => {
      const off = n > 1 ? (k - (n - 1) / 2) * 18 : 0;
      const movable = isMovable(o.color, o.idx);
      planes += `<g class="plane ${movable ? 'movable' : ''} ${o.cur ? 'current' : ''}"
        data-color="${o.color}" data-idx="${o.idx}" data-x="${x + off}" data-y="${y}">
        <circle class="planeBase" cx="0" cy="0" r="${C * 0.42}"></circle>
        ${o.cur ? `<circle class="planeRing" cx="0" cy="0" r="${C * 0.48}"></circle>` : ''}
        <g class="planeScale" transform="scale(1.28)"><g class="planeBody">${planeSVG(o.color)}</g></g>
        <text class="planeNum" y="3.6" text-anchor="middle" font-size="9" fill="#fff">${o.idx + 1}</text>
      </g>`;
    });
  }
  return `<svg width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${defs}${cells}${planes}</svg>`;
}

// 平滑位移
// 平滑位移
// 平滑位移：保留飞机元素，按上次位置做过渡动画：保留飞机元素，按上次位置做过渡动画
// 平滑位移：保留飞机元素，按上次位置做过渡动画
// 改为沿路径逐格推进：从旧 step 到新 step 走每一格，形成“一格一格往前推”的节奏
function positionPlanes() {
  document.querySelectorAll('.plane').forEach((g) => {
    const tx = Number(g.dataset.x), ty = Number(g.dataset.y);
    const k = g.dataset.color + '-' + g.dataset.idx;
    const newState = g.dataset.state;
    const newStep = Number(g.dataset.step);
    const desiredStep = (newState === 'base') ? -1 : newStep;
    const oldState = planeState[k];
    const oldStep = planeStep[k];

    // 防抖：目标步数未变（含动画进行中）则不重复触发，避免逐格动画被反复打断
    if (planeTargetStep[k] === desiredStep) return;

    // 从基地起飞：base -> field，逐格走到目标
    if (oldState === 'base' && newState === 'field') {
      const coords = [];
      for (let s = 0; s <= desiredStep; s++) {
        const [c, r] = B.stepToCell(g.dataset.color, s);
        coords.push([c * B.CELL + B.CELL / 2, r * B.CELL + B.CELL / 2]);
      }
      planeTargetStep[k] = desiredStep;
      startStepwise(g, k, coords);
      planeState[k] = newState; planeStep[k] = desiredStep;
      return;
    }
    // 场上前进：field -> field 且步数增加，逐格推进
    if (newState === 'field' && oldState === 'field' && Number.isFinite(oldStep) && desiredStep > oldStep) {
      const coords = [];
      for (let s = oldStep + 1; s <= desiredStep; s++) {
        const [c, r] = B.stepToCell(g.dataset.color, s);
        coords.push([c * B.CELL + B.CELL / 2, r * B.CELL + B.CELL / 2]);
      }
      planeTargetStep[k] = desiredStep;
      startStepwise(g, k, coords);
      planeState[k] = newState; planeStep[k] = desiredStep;
      return;
    }
    // 其它（被吃回基地 / 重置 / 异常 / 首次挂载）：取消旧动画并直接过渡
    planeTargetStep[k] = desiredStep;
    planeAnimToken[k] = (planeAnimToken[k] || 0) + 1; // 取消未完成的旧逐格动画
    // 首次挂载（重建后 planePos 为空）不加过渡，直接落位，避免从角落 (0,0) 滑入
    const firstMount = !planePos[k];
    g.style.transition = firstMount ? 'none' : 'transform .45s cubic-bezier(.2,.8,.3,1)';
    g.style.transform = `translate(${tx}px, ${ty}px)`;
    planePos[k] = [tx, ty];
    planeState[k] = newState; planeStep[k] = desiredStep;
  });
}

// 逐格推进动画：每格短滑行 + 明显停顿，形成“一格一格往前跳”的节奏
function startStepwise(g, k, coords) {
  const token = (planeAnimToken[k] || 0) + 1;
  planeAnimToken[k] = token;
  const SLIDE = 240;  // 单格滑行(ms)
  const PER = 320;    // 每格节奏(ms)：滑行后停顿，清楚体现逐格推进
  let i = 0;
  function next() {
    if (planeAnimToken[k] !== token) return; // 已被新移动/重置取代，停止
    if (i >= coords.length) {
      planePos[k] = coords[coords.length - 1];
      return;
    }
    const [x, y] = coords[i];
    g.style.transition = `transform ${SLIDE}ms cubic-bezier(.3,.7,.4,1)`;
    g.style.transform = `translate(${x}px, ${y}px)`;
    i++;
    setTimeout(next, PER);
  }
  next();
}

// 右上角设置面板（轻量浮层）
function toggleSettings() {
  let p = document.getElementById('settingsPanel');
  if (p) { p.remove(); return; }
  p = document.createElement('div');
  p.id = 'settingsPanel';
  p.className = 'settings-panel';
  p.innerHTML = `<div class="sp-card">
    <h3>⚙ 设置</h3>
    <p>当前为纯视觉版本（无音效）。</p>
    <button id="spExit" class="btn-danger">退出房间</button>
    <button id="spClose">关闭</button>
  </div>`;
  document.body.appendChild(p);
  document.getElementById('spExit').onclick = () => { if (confirm('确定退出房间？')) location.reload(); };
  document.getElementById('spClose').onclick = () => p.remove();
}

function rect(c, r, fill, stroke, round) {
  const C = B.CELL;
  return `<rect x="${c * C + 2}" y="${r * C + 2}" width="${C - 4}" height="${C - 4}" rx="${round ? C / 3 : 6}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"></rect>`;
}

function isMovable(color, idx) {
  if (!game) return false;
  if (game.currentTurn !== me.playerId) return false;
  if (game.dice == null) return false;
  const me_player = game.players.find((p) => p.id === me.playerId);
  if (!me_player || me_player.color !== color) return false;
  return game.legalMoves.includes(idx);
}

function canRoll() { return game && game.currentTurn === me.playerId && game.dice == null && game.phase === 'playing'; }

let prevLogLen = 0;
function floatText(g, txt) {
  const gr = g.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'floatText';
  f.textContent = txt;
  f.style.color = COLOR_HEX[g.dataset.color];
  f.style.left = (gr.left + gr.width / 2) + 'px';
  f.style.top = (gr.top + gr.height / 2) + 'px';
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1000);
}
function triggerCrash() {
  const bw = document.querySelector('.boardWrap');
  if (bw) { bw.classList.add('shake'); setTimeout(() => { const b = document.querySelector('.boardWrap'); if (b) b.classList.remove('shake'); }, 500); }
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  const colors = ['#FF5C7C', '#FFC53D', '#4DA3FF', '#43D17A', '#FFB23E'];
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const ang = Math.random() * Math.PI * 2;
    const dist = 40 + Math.random() * 70;
    s.style.left = cx + 'px';
    s.style.top = cy + 'px';
    s.style.background = colors[i % colors.length];
    s.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    s.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 650);
  }
}
function detectCrash() {
  const logs = game.log || [];
  if (logs.length > prevLogLen) {
    const added = logs.slice(prevLogLen);
    if (added.some((t) => /吃|撞|击败|淘汰|kick/i.test(t))) triggerCrash();
  }
  prevLogLen = logs.length;
}
function attachPlaneClicks() {
  // 幂等：先清除所有飞机旧绑定，再只给可移动的飞机绑定点击
  document.querySelectorAll('.plane').forEach((g) => { g.onclick = null; g.style.cursor = 'default'; });
  document.querySelectorAll('.plane.movable').forEach((g) => {
    g.style.cursor = 'pointer';
    g.onclick = () => {
      const steps = game.dice;
      if (steps != null) floatText(g, '+' + steps);
      send({ type: 'move', planeIndex: Number(g.getAttribute('data-idx')) });
    };
  });
}

function renderFinished() {
  const w = game.players.find((p) => p.id === game.winner);
  app.innerHTML = `<div class="card center"><h1>🏆 ${w ? w.name : '某玩家'} 获胜！</h1><button onclick="location.reload()">再来一局（刷新页面）</button></div>`;
}

function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

// 顶部 Toast 提示条
function toast(msg) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// 全局动态背景装饰（漂浮的飞机/云朵/星星），只注入一次
function decorateBackground() {
  if (document.querySelector('.bg-deco')) return;
  const deco = document.createElement('div');
  deco.className = 'bg-deco';
  const items = ['✈️', '☁️', '⭐', '🎈', '🌈', '✈️', '☁️', '⭐', '🍬', '🎉'];
  items.forEach((e, i) => {
    const s = document.createElement('span');
    s.textContent = e;
    s.style.left = (Math.random() * 88 + 4) + '%';
    s.style.top = (Math.random() * 86 + 6) + '%';
    s.style.animationDelay = (i * 1.3) + 's';
    s.style.fontSize = (22 + Math.random() * 24) + 'px';
    deco.appendChild(s);
  });
  document.body.appendChild(deco);
}

decorateBackground();
connect();
render(); // 立即渲染首页，避免等 WS 连接期间白屏
