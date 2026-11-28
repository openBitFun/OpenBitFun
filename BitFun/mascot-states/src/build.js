// 毕方形象 · 构建脚本
// 用法：node src/build.js        （或 npm run build）
// 输出：bitfun-mascot.html        —— 合成的完整单文件（自己搭配 / 配色方案 / 形象与状态），放在包根目录、随仓库提交
//       dist/pages/*.html         —— 三个章节的独立页面
//       dist/assets/svg*/         —— 全部状态 SVG；dist/assets/bitfun-colors.{css,json} —— 色卡
const fs = require('fs'), path = require('path');
const SRC = __dirname, ROOT = path.join(SRC, '..'), DIST = path.join(ROOT, 'dist');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const BF_SRC = read('core/bitfun-states.js');
const BF = require('./core/bitfun-states.js');

/* ---------- 设计系统 token → CSS 变量 ---------- */
const TOK = JSON.parse(read('tokens/openbitfun-tokens.json'));
const deref = v => v.replace(/^\{(.+)\}$/, (_, k) => { if (!TOK.ref[k]) throw new Error('缺少 ref：' + k); return TOK.ref[k]; });
const cssName = n => '--openbitfun-' + n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/\./g, '-').toLowerCase();
const themed = Object.fromEntries(Object.entries(TOK.theme).map(([k, [l, d]]) => [k, { light: deref(l), dark: deref(d) }]));
const block = m => Object.entries(themed).map(([k, v]) => `  ${cssName(k)}: ${v[m]};`).join('\n');
const tokenCss = `/* 由 src/tokens/openbitfun-tokens.json 生成 */
[data-openbitfun-design-system-root] {
${block('light')}
${Object.entries(TOK.system).map(([k, v]) => `  ${cssName(k)}: ${v};`).join('\n')}
}
[data-openbitfun-design-system-root][data-color-scheme="dark"] {
${block('dark')}
}`;

/* ---------- 页面 ---------- */
// 嵌入到单文件时：去掉页面自己的大标题和满屏高度，并把内容高度报给外层
const EMBED = `<style>.bf-embedded .page{min-height:0}.bf-embedded .wrap>h1,.bf-embedded .wrap>.eyebrow,.bf-embedded .wrap>.lead:first-of-type{display:none}.bf-embedded .wrap{padding-top:var(--openbitfun-space-6)}</style>
<script>(function(){if(window.parent===window)return;document.documentElement.classList.add('bf-embedded');
const send=()=>parent.postMessage({bfHeight:Math.ceil(document.body.getBoundingClientRect().height)},'*');
addEventListener('load',send);new ResizeObserver(send).observe(document.body);setTimeout(send,300);})();</script>`;
const page = (f, embed) => read(f)
  .replace('/*__TOKENS__*/', () => tokenCss)
  .replace('/*__TOKENS_JSON__*/{}', () => JSON.stringify(themed))
  .replace('/*__BF__*/', () => BF_SRC)
  .replace('</body>', () => (embed ? EMBED : '') + '</body>');
const PAGES = { customize: 'pages/customize.html', palettes: 'pages/palettes.html', states: 'pages/states.html' };

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'pages'), { recursive: true });
for (const [name, f] of Object.entries(PAGES)) fs.writeFileSync(path.join(DIST, 'pages', name + '.html'), page(f, false));

const attr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
let shell = read('shell.html').replace('/*__TOKENS__*/', () => tokenCss).replace('/*__BUILT_AT__*/', new Date().toISOString().slice(0, 10));
for (const [name, f] of Object.entries(PAGES)) shell = shell.replace(`/*__FRAME_${name}__*/`, () => attr(page(f, true)));
fs.writeFileSync(path.join(ROOT, 'bitfun-mascot.html'), shell);

/* ---------- SVG ---------- */
const A = path.join(DIST, 'assets');
let n = 0;
const write = (dir, name, svg) => { fs.mkdirSync(path.join(A, dir), { recursive: true }); fs.writeFileSync(path.join(A, dir, name), svg); n++; };
const fileName = (s, i) => String(i + 1).padStart(2, '0') + '-' + s.id + '.svg';
for (const view of ['iso', 'flat']) for (const finish of (view === 'flat' ? ['smooth'] : ['smooth', 'metal', 'plush'])) for (const palette of Object.keys(BF.PALETTES)) {
  const sub = view === 'iso' ? `3d-${finish}-${palette}` : `flat-${palette}`;
  BF.STATES.forEach((s, i) => {
    // 毛绒文件较大：导出时降低绒毛密度，且不再单独导出 compact 版
    write('svg/' + sub, fileName(s, i), BF.render(s.id, { finish, palette, view, lod: finish === 'plush' ? .4 : 1 }));
    if (finish !== 'plush') write('svg-compact/' + sub, fileName(s, i), BF.render(s.id, { finish, palette, view, compact: true }));
  });
}
// 32px 以下用的平面图标版
for (const palette of Object.keys(BF.PALETTES)) BF.STATES.forEach((s, i) => write('svg-icon/' + palette, fileName(s, i), BF.render(s.id, { palette, tiny: true })));

/* ---------- 色卡 ---------- */
{
  let css = '/* 毕方形象色卡（由 src/build.js 生成） */\n:root {\n';
  for (const [k, v] of Object.entries(BF.BASE)) css += `  --bf-base-${k}: ${v.hex}; /* ${v.name} */\n`;
  for (const [k, v] of Object.entries(BF.CAT)) if (k !== 'idle') css += `  --bf-status-${k}: ${v.color}; --bf-status-${k}-deep: ${v.deep}; /* ${v.name} */\n`;
  css += '}\n';
  for (const [k, P] of Object.entries(BF.PALETTES)) {
    css += `\n/* ${P.name} · ${P.note} */\n[data-bf-palette="${k}"] {\n  --bf-body: ${P.side};\n  --bf-body-shade: ${P.sideL};\n  --bf-top-light: ${P.top1};\n  --bf-eye: ${P.eye};\n  --bf-stem: ${P.stem};\n  --bf-idle: ${P.accent};\n`;
    for (const c of Object.keys(BF.CAT)) if (c !== 'idle') css += `  --bf-ball-${c}: ${BF.statusColor(c, k)};${BF.isDeep(c, k) ? ' /* 加深版 */' : ''}\n`;
    css += '}\n';
  }
  fs.writeFileSync(path.join(A, 'bitfun-colors.css'), css);
  const json = { base: BF.BASE, status: Object.fromEntries(Object.entries(BF.CAT).filter(([k]) => k !== 'idle').map(([k, v]) => [k, v.color])),
    palettes: Object.fromEntries(Object.entries(BF.PALETTES).map(([k, P]) => [k, { name: P.name, body: P.side, bodyShade: P.sideL, topLight: P.top1, eye: P.eye, stem: P.stem, idle: P.accent,
      ball: Object.fromEntries(Object.keys(BF.CAT).filter(c => c !== 'idle').map(c => [c, BF.statusColor(c, k)])) }])) };
  fs.writeFileSync(path.join(A, 'bitfun-colors.json'), JSON.stringify(json, null, 2));
}
console.log(`构建完成：bitfun-mascot.html、dist/pages/ 3 个页面、${n} 个 SVG、色卡 2 个文件`);
