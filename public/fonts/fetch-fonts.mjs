// 下载自托管卡通字体（ZCOOL KuaiLe 中文标题 + Baloo 2 数字/英文）
// 若网络不可用，本脚本失败也无妨：@font-face 引用缺失文件时浏览器自动回落系统字体，不报错。
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
mkdirSync(__dirname, { recursive: true });

async function fetchCSS(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error('css ' + r.status);
  return r.text();
}

function woff2URLs(css) {
  return [...css.matchAll(/url\((https:[^)]+?\.woff2)\)/g)].map((m) => m[1]);
}

async function download(url, file) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://fonts.gstatic.com/' } });
  if (!r.ok) throw new Error('font ' + r.status + ' ' + file);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(file, buf);
  console.log('  ✓', file, buf.length, 'bytes');
}

(async () => {
  const dir = __dirname + '/';
  try {
    const baloo = await fetchCSS('https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600;700;800&display=swap');
    const zcool = await fetchCSS('https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap');
    const urls = [...woff2URLs(baloo), ...woff2URLs(zcool)];
    if (!urls.length) throw new Error('no woff2 urls found');
    let i = 0;
    for (const u of urls) {
      const name = u.split('/').pop().split('?')[0];
      const file = dir + 'f' + (i++) + '_' + name;
      await download(u, file);
    }
    console.log('字体下载完成：', urls.length, '个文件');
  } catch (e) {
    console.error('字体下载失败（将回落系统字体）：', e.message);
    process.exit(0);
  }
})();
