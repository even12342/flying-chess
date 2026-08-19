// 20 ä¸ªå°æ¸¸æˆåŽç«¯é›†æˆæµ‹è¯•
// å¯¹æ¯ä¸ªå·²æ³¨å†Œæ¸¸æˆï¼ŒæŒ‰æ”¯æŒäººæ•°ï¼?2/3/4ï¼‰åˆ›å»ºå®žä¾‹ã€è·‘åˆ°ç»“æŸï¼ŒéªŒè¯ç»Ÿä¸€æŽ¥å£æ— å¼‚å¸¸ä¸”äº§å‡ºåˆæ³• effectsã€?
import './server/minigame/all.js';
import { MINI_GAMES } from './server/minigame/registry.js';

const KNOWN_TYPES = new Set(['forward', 'backward', 'skip', 'item', 'shield', 'double', 'swap', 'swapRandom', 'disarm']);
const COLORS = ['red', 'yellow', 'blue', 'green'];

function fakePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, color: COLORS[i] }));
}
const pickOther = (players, id) => players.find((p) => p.id !== id).id;
function validateEffects(effects, players, ctx) {
  const ids = new Set(players.map((p) => p.id));
  for (const e of effects || []) {
    if (!ids.has(e.playerId)) throw new Error(`[${ctx}] effect.playerId éžæ³•: ${e.playerId}`);
    if (!KNOWN_TYPES.has(e.type)) throw new Error(`[${ctx}] effect.type æœªçŸ¥: ${e.type}`);
    if (e.type === 'swap' && !ids.has(e.value)) throw new Error(`[${ctx}] swap.value éžæ³•: ${e.value}`);
  }
}

function pickAction(mini, players) {
  const cur = mini.getCurrentPlayerId();
  if (cur) {
    if (mini.phase === 'choose') return { pid: cur, action: { target: pickOther(players, cur) } };
    if (mini.picking) return { pid: cur, action: { target: pickOther(players, cur) } };
    const a = mini.aiAction ? mini.aiAction(cur) : null;
    return { pid: cur, action: a || { type: 'timeout' } };
  }
  for (const p of players) {
    const a = mini.aiAction ? mini.aiAction(p.id) : null;
    if (a) return { pid: p.id, action: a };
  }
  return null;
}

function runGame(def, players) {
  const mini = def.create();
  mini.init(players, { players });
  mini.start();
  let lastSig = '';
  let stuck = 0;
  const MAX = 5000;
  for (let i = 0; i < MAX; i++) {
    if (mini.isFinished()) break;
    // ç§æœ‰æ¸¸æˆï¼šé€ä¸ªçŽ©å®¶è°ƒç”¨ getStateForï¼Œç¡®ä¿ä¸æŠ›é”™
    if (typeof mini.getStateFor === 'function') {
      for (const p of players) {
        const s = mini.getStateFor(p.id);
        if (!s || !s.view) throw new Error(`${def.meta.id}: getStateFor è¿”å›žå¼‚å¸¸`);
      }
    }
    const pub = mini.getState();
    if (!pub || !pub.view) throw new Error(`${def.meta.id}: getState è¿”å›žå¼‚å¸¸`);
    const sig = JSON.stringify(pub);
    if (sig === lastSig) stuck++;
    else { stuck = 0; lastSig = sig; }
    if (stuck >= 3) {
      if (typeof mini.onGlobalTimeout === 'function') { mini.onGlobalTimeout(); lastSig = ''; stuck = 0; continue; }
      break;
    }
    // ½ö¿¿¡°È«¾Öµ¹¼ÆÊ±¡±½áÊøµÄÓÎÏ·£¨·´Ó¦ÅÄµÆ/¼ÇÒä·­ÅÆµÈ£©ÔÚ·þÎñ¶ËÓÉ¶¨Ê±Æ÷ÊÕÎ²£»
    // ²âÊÔÎÞÕæÊµ¶¨Ê±Æ÷£¬¹ÊÔÚµü´ú½Ï¶àÊ±Ö÷¶¯´¥·¢Ò»´ÎÈ«¾Ö³¬Ê±ÒÔÊÕÎ²¡£
    const hint = typeof mini.timeoutHint === 'function' ? mini.timeoutHint() : null;
    if (hint && hint.mode === 'global' && i >= 1500) {
      if (typeof mini.onGlobalTimeout === 'function') { mini.onGlobalTimeout(); lastSig = ''; stuck = 0; continue; }
    }

    const cur = mini.getCurrentPlayerId();
    if (cur) {
      const act = pickAction(mini, players);
      if (!act) {
        if (typeof mini.onGlobalTimeout === 'function') { mini.onGlobalTimeout(); lastSig = ''; stuck = 0; continue; }
        break;
      }
      mini.onPlayerAction(act.pid, act.action);
    } else {
      // ÈÎÒâ¿ÉÌá½»Ä£Ê½£¨currentPlayerId === null£¬ÈçÇÀ´ð/·´Ó¦/Í¶Æ±/Æ½¾ÖÖÀ÷»£©£º
      // ·þÎñ¶Ë»áÎªËùÓÐ AI Íæ¼Ò¸÷×Ôµ÷¶ÈÒ»´Î£¬´Ë´¦ÈÃËùÓÐÍæ¼Ò£¨²âÊÔÀï¾ùÊÓÎª AI£©¸÷×ÔÌá½»Ò»´Î¡£
      // ´ËÇ°Ö»Ìá½»Ê×¸öÍæ¼Ò»áµ¼ÖÂÆäÓàÍæ¼ÒÓÀ²»ÐÐ¶¯¶ø¿¨ËÀ£¨ÀýÈç¾®×ÖÉÁµçÕ½Æ½¾Ö½×¶Î£©¡£
      let any = false;
      for (const p of players) {
        const a = mini.aiAction ? mini.aiAction(p.id) : null;
        if (a) { mini.onPlayerAction(p.id, a); any = true; }
      }
      if (!any) {
        if (typeof mini.onGlobalTimeout === 'function') { mini.onGlobalTimeout(); lastSig = ''; stuck = 0; continue; }
        break;
      }
    }
    if (typeof mini.getPendingEffects === 'function') {
      const pend = mini.getPendingEffects();
      validateEffects(pend, players, def.meta.id + ':pending');
    }
  }
  if (!mini.isFinished()) throw new Error(`${def.meta.id}: æœªèƒ½åœ? ${MAX} æ­¥å†…ç»“æŸï¼ˆå¯èƒ½å¡æ­»ï¼‰`);
  const r = mini.getResult();
  validateEffects(r.effects, players, def.meta.id + ':result');
  mini.destroy();
  return r;
}

let pass = 0;
let fail = 0;
const failures = [];
for (const def of MINI_GAMES) {
  const counts = [2, 3, 4].filter((n) => def.meta.supports(n));
  for (const n of counts) {
    try {
      runGame(def, fakePlayers(n));
      pass++;
    } catch (e) {
      fail++;
      failures.push(`${def.meta.name}(${def.meta.id}) x${n}: ${e.message}`);
    }
  }
}

console.log(`\næ³¨å†Œå°æ¸¸æˆæ€»æ•°: ${MINI_GAMES.length}`);
console.log(`é€šè¿‡: ${pass}  å¤±è´¥: ${fail}`);
if (failures.length) {
  console.log('\nå¤±è´¥è¯¦æƒ…:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log('å…¨éƒ¨å°æ¸¸æˆè·‘é€? âœ?');
}
