// 把 @fontsource 包里的 woff2 与 @font-face 规则复制到 public/fonts，生成 fonts.css
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = 'C:/Users/EE/.workbuddy/binaries/node/workspace/node_modules/@fontsource';
const OUT = __dirname;
mkdirSync(OUT, { recursive: true });

const families = ['zcool-kuaile', 'baloo-2'];
const copiedWOFF = new Set();
let cssChunks = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

for (const fam of families) {
  const base = join(PKG_ROOT, fam);
  if (!statSync(base, { throwIfNoError: true })) continue;
  const all = walk(base);
  // 复制 woff2
  for (const f of all) {
    if (f.endsWith('.woff2')) {
      const name = f.split('\\').pop();
      if (!copiedWOFF.has(name)) {
        writeFileSync(join(OUT, name), readFileSync(f));
        copiedWOFF.add(name);
      }
    }
  }
  // 收集 @font-face CSS（仅含 woff2 的）
  for (const f of all) {
    if (f.endsWith('.css') && readFileSync(f, 'utf8').includes('@font-face')) {
      let css = readFileSync(f, 'utf8');
      // 重写 woff2 url 指向 /fonts/NAME.woff2，并删除 woff 回退（本地不提供 woff）
      css = css.replace(/url\(\s*(\.\.\/|\.\/)?files\/([^)]+?\.woff2)\s*\)/g, (_m, _p, file) => `url(/fonts/${file})`);
      css = css.replace(/\s*,\s*url\(\s*(\.\.\/|\.\/)?files\/[^)]+?\.woff\s*\)\s*format\('woff'\)/g, '');
      if (css.includes('/fonts/') && css.includes('@font-face')) cssChunks.push(css);
    }
  }
}

// 去重（同一 family/weight/subset 可能多处声明）
const seen = new Set();
const uniq = cssChunks.filter((c) => {
  const key = c.replace(/\s+/g, ' ').slice(0, 200);
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

writeFileSync(join(OUT, 'fonts.css'),
  '/* 自动生成：自托管卡通字体 ZCOOL KuaiLe + Baloo 2，由 @fontsource 复制 */\n' + uniq.join('\n'));
console.log('已复制 woff2:', copiedWOFF.size, '个；生成 fonts.css，@font-face 块:', uniq.length);
