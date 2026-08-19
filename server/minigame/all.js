// 统一引入并注册全部小游戏
// 只要本文件被 room.js 引入一次，下面所有 registerGame 调用即完成注册。
import './fateWheel.js';   // 命运转轮（即时型示例）
import './g-dice.js';      // 命运骰子 / 骰子斗牛 / 骰子淘汰赛 / 骰子大逃杀
import './g-board.js';     // 井字闪电战
import './g-reaction.js';  // 极速猜拳 / 反应拍灯 / 抢答挑战
import './g-guess.js';     // 数字猎人 / 数字炸弹 / 你画我猜 / 谁是卧底
import './g-cards.js';     // 记忆翻牌 / 翻牌对对碰 / 抓乌龟 / UNO速决 / 运气抽卡
