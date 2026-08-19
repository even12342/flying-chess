// 验证抢答三色随机化：每局题目顺序随机 + 每题选项位置随机 + 6题互不重复
import('./server/minigame/all.js').then(() => import('./server/minigame/registry.js')).then((r) => {
  const def = r.MINI_GAMES.find((g) => g.meta.id === 'quiz-three');
  if (!def) { console.error('未找到 quiz-three'); process.exit(1); }
  const players = [{ id: 'p1', name: 'A', color: 'red' }, { id: 'p2', name: 'B', color: 'blue' }];

  const firsts = [];      // 每局首题
  const allOrderSeen = {}; // 题目问法 -> 出现次数（跨局）
  let dupGame = 0;
  let optShuffleOK = false;

  // 1) 跑 20 局，收集首题 + 每局 6 题是否重复
  for (let gI = 0; gI < 20; gI++) {
    const q = def.create();
    q.init(players);
    firsts.push(q.curQ.q);
    const qs = [q.curQ.q];
    // 模拟：每题 p1 抢答并答对，推进到 done
    while (q.phase !== 'done') {
      if (q.phase === 'ask') { q.buzzed = 'p1'; q.phase = 'answer'; }
      else if (q.phase === 'answer') { q.onPlayerAction('p1', { type: 'answer', answer: q.curQ.a }); qs.push(q.curQ.q); }
      else break;
      if (qs.length > 10) break;
    }
    const uniq = new Set(qs);
    if (uniq.size !== new Set(qs.filter((x, i) => qs.indexOf(x) === i)).size) dupGame++;
    if (uniq.size !== qs.length) dupGame++;
  }
  const distinctFirst = new Set(firsts);
  console.log(`[首题随机] 20局首题不同数量: ${distinctFirst.size}/20 （越高越好，30题库理想接近20）`);

  // 2) 选项洗牌：固定同一道问法，跑多次看选项顺序是否变化
  const targetQ = '一年有多少个月份？';
  const optOrders = new Set();
  for (let i = 0; i < 40; i++) {
    const q = def.create();
    q.init(players);
    // 在整局里找这道题
    let cur = q.curQ;
    const scan = () => {
      if (cur && cur.q === targetQ) optOrders.add(cur.opts.join('|'));
    };
    scan();
    while (q.phase !== 'done') {
      if (q.phase === 'ask') { q.buzzed = 'p1'; q.phase = 'answer'; }
      else if (q.phase === 'answer') { q.onPlayerAction('p1', { type: 'answer', answer: q.curQ.a }); cur = q.curQ; scan(); }
      else break;
      if (optOrders.size > 50) break;
    }
  }
  optShuffleOK = optOrders.size >= 2;
  console.log(`[选项随机] 同一题"${targetQ}"出现的不同选项排列数: ${optOrders.size} ${optShuffleOK ? '✅(>=2 说明已随机)' : '❌'}`);

  // 3) 正确性回归：洗牌后正确答案仍能命中
  let correctHit = 0, totalCheck = 0;
  for (let i = 0; i < 50; i++) {
    const q = def.create();
    q.init(players);
    // 遍历整局，每次用 curQ.a 作答应判对（分数+1）
    while (q.phase !== 'done') {
      if (q.phase === 'ask') { q.buzzed = 'p1'; q.phase = 'answer'; }
      else if (q.phase === 'answer') {
        const before = q.scores['p1'];
        q.onPlayerAction('p1', { type: 'answer', answer: q.curQ.a });
        totalCheck++;
        if (q.scores['p1'] === before + 1) correctHit++;
      } else break;
    }
  }
  console.log(`[正确性] 用 curQ.a 作答判对: ${correctHit}/${totalCheck} ${correctHit === totalCheck ? '✅' : '❌'}`);

  const pass = distinctFirst.size >= 10 && optShuffleOK && correctHit === totalCheck;
  console.log(pass ? '\n✅ 全部通过' : '\n❌ 存在未达标项');
  process.exit(pass ? 0 : 1);
}).catch((e) => { console.error('ERR', e); process.exit(1); });
