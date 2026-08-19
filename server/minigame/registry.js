// 小游戏注册表
// 职责：维护已注册的小游戏列表，按房间当前人数筛选“可玩”的小游戏，并随机抽取一个。
// 每个游戏通过 registerGame 注册一份定义：
//   { meta: { id, name, description, minPlayers, maxPlayers, supports(n) }, create() -> MiniGame 实例 }

export const MINI_GAMES = [];

export function registerGame(def) {
  if (!def || !def.meta || !def.meta.id || typeof def.create !== 'function') {
    throw new Error('registerGame: 定义不完整');
  }
  if (MINI_GAMES.some((g) => g.meta.id === def.meta.id)) {
    throw new Error('小游戏已存在: ' + def.meta.id);
  }
  MINI_GAMES.push(def);
}

// 列出当前人数下可玩的所有小游戏
export function listPlayable(playerCount) {
  return MINI_GAMES.filter((g) => g.meta.supports(playerCount));
}

// 从可玩列表中随机抽取一个（rng 可注入，便于测试固定结果）
export function pickMiniGame(playerCount, rng = Math.random) {
  const cands = listPlayable(playerCount);
  if (cands.length === 0) return null;
  return cands[Math.floor(rng() * cands.length)];
}
