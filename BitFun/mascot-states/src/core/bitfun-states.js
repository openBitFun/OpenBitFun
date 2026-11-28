/* 毕方 BitFun · 多状态形象生成器 v1.0
 * 形象来源：等距视角的圆角方块 + 顶面中心白色短天线 + 球；右侧面两只白色竖椭圆小眼（参考 飞书20261116 视频）。
 * 语义：天线球 = 状态灯（颜色区分大类），眼睛 = 注意力/情绪，道具 = 具体任务（仅大尺寸），胶囊 = 精确进度。
 * 选项：finish = smooth（光滑，视频原版）| metal（金属）| plush（毛绒：长绒玩具质感）；palette = PALETTES 中的配色。
 */
(function (root) {
  const C = { line: '#E3E5EA', sub: '#C9CED6', ink: '#2A2D35' };
  // 道具里的内容线条用当前状态色的浅调，随配色和状态变化
  const mixHex = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0')).join('');
  const tint = (h, k = .62) => /^#[0-9a-f]{6}$/i.test(h) ? '#' + [1, 3, 5].map(i => Math.round(parseInt(h.substr(i, 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0')).join('') : h;

  const BASE = {
    ink: { hex: '#171717', name: '墨 · 正文' }, muted: { hex: '#706F6A', name: '暖灰 · 次要文字' }, subtle: { hex: '#A5A39B', name: '浅暖灰 · 辅助' },
    line: { hex: '#E9E7E2', name: '分隔线' }, soft: { hex: '#F4F3F0', name: '浅底' }, sidebar: { hex: '#F8F8F9', name: '侧栏底' }, page: { hex: '#FFFFFF', name: '页面底' }
  };
  /* ---------- 统一色板：身体色 + 天线球色（“自己搭配”和全部页面共用这一份） ----------
     tok 为 OpenBitFun 设计系统 token，hex 为它在浅色主题下的取值（页面里会按主题替换）。 */
  const BOARD = {
    bodies: [
      { key: 'white',    name: '纯白',     hex: '#F7F7F7', ball: '#2FCFD8' },
      { key: 'gray',     name: '中灰',     hex: '#7B7B7B', ball: '#F4F3EE' },
      { key: 'black',    name: '终端黑',   hex: '#0B0B0B', ball: '#2FCFD8', note: '视频原版' },
      { key: 'red',      name: '红',       hex: '#C95765', tok: 'color.identity.project.red' },
      { key: 'tomato',   name: '番茄',     hex: '#FF4A2E' },
      { key: 'orange',   name: '橙',       hex: '#D47628', tok: 'color.identity.project.orange' },
      { key: 'yellow',   name: '黄',       hex: '#D5A910', tok: 'color.identity.project.yellow' },
      { key: 'lime',     name: '荧光柠',   hex: '#D9F23F', ball: '#2E323A' },
      { key: 'green',    name: '绿',       hex: '#269F70', tok: 'color.identity.project.green' },
      { key: 'phthalo',  name: '酞菁绿',   hex: '#123E34' },
      { key: 'cyan',     name: '青',       hex: '#07879A', tok: 'color.identity.project.cyan' },
      { key: 'blue',     name: '蓝',       hex: '#2563EB', tok: 'color.identity.project.blue' },
      { key: 'midnight', name: '午夜',     hex: '#17213A' },
      { key: 'lavender', name: '数字薰衣草', hex: '#DCD2F7', ball: '#2FCFD8' },
      { key: 'purple',   name: '紫',       hex: '#7B43F8', tok: 'color.identity.project.purple' },
      { key: 'pink',     name: '粉',       hex: '#DB2777', tok: 'color.identity.project.pink' },
      { key: 'hotpink',  name: '热粉',     hex: '#FF4FA7' },
      { key: 'bifang',   name: '毕方',     hex: '#2E8C86', note: '《山海经》特别版 · 青质赤文白喙', bifang: true }
    ],
    balls: [
      { key: 'highlight', name: '设计系统高亮', hex: '#059CB0', tok: 'color.control.highlight.background' },
      { key: 'cyan',  name: '青',   hex: '#2FCFD8' }, { key: 'lime', name: '青柠', hex: '#9AD94A' }, { key: 'berry', name: '莓果', hex: '#E66FE0' },
      { key: 'graphite', name: '石墨', hex: '#2E323A' }, { key: 'pearl', name: '珍珠白', hex: '#F4F3EE' }, { key: 'same', name: '和身体同色（浅一档）', same: true }
    ]
  };
  // 感知亮度（OKLab L）：L < 0.70 的身体用白眼睛，否则黑眼睛
  const okL = h => { const f = i => { const v = parseInt(h.substr(i, 2), 16) / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
    const [r, g, b] = [f(1), f(3), f(5)]; return .2104542553 * Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b) + .793617785 * Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b) - .0040720468 * Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b); };
  const hsl = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255), M = Math.max(r, g, b), m = Math.min(r, g, b), l = (M + m) / 2, d = M - m;
    if (!d) return [0, 0, l * 100]; const s2 = d / (1 - Math.abs(2 * l - 1)), hh = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(hh * 60 + 360) % 360, s2 * 100, l * 100]; };
  const fromHsl = (h, s2, l) => { s2 = Math.max(0, Math.min(100, s2)) / 100; l = Math.max(0, Math.min(100, l)) / 100; const k = n => (n + h / 30) % 12, a = s2 * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''); };
  const adjust = (hex, dl, ds = 0) => { const [h, s2, l] = hsl(hex); return fromHsl(h, s2 < 4 ? s2 : s2 + ds, l + dl); };
  // 由身体色 + 球色得到整套配色（“自己搭配”页也用它，只是另外传入主题相关的值）
  function makePalette(body, ball, o = {}) {
    const chroma = (() => { const v = [1, 3, 5].map(i => parseInt(body.substr(i, 2), 16) / 255); return Math.max(...v) - Math.min(...v); })();
    const L = hsl(body)[2], dark = L < 40, solid = !dark && chroma > .35;
    const W = o.onDark || '#ffffff', K = o.onLight || '#000000';
    const eye = o.eye === 'white' ? W : o.eye === 'black' ? K : (okL(body) < .70 ? W : K);
    if (ball === 'same') ball = L < 20 ? adjust(body, 22) : adjust(body, 12, 4);
    return { name: o.name || '自定义', note: o.note || '', side: body, sideL: adjust(body, dark ? -2 : -5, dark ? 0 : 6), top0: adjust(body, 3), top1: dark ? adjust(body, 16) : adjust(body, 9, -10),
      eye, stem: dark ? '#e9ecf0' : adjust(body, -22, 4), accent: ball, hand: adjust(body, -3), blush: body, seam: body,
      fur: '#ffffff', furOp: .18, rim: dark ? .25 : solid ? .45 : .9, shade: dark ? 1 : solid ? .7 : .3,
      ring: solid || dark ? (o.ring || '#ffffff') : null, status: o.status, bifang: !!o.bifang };
  }
  const PALETTES = Object.fromEntries(BOARD.bodies.map(b => [b.key, makePalette(b.hex, b.ball || '#F4F3EE', { name: b.name, note: b.note || (b.tok ? '设计系统身份色' : ''), bifang: b.bifang })]));


  const CAT = {
    idle:  { key: 'idle',  name: '待命',     color: '#2BBFD8', hue: '随配色', mean: '品牌主色，随配色变化，但必须避开下面 5 个状态色相' },
    think: { key: 'think', name: '感知·思考', color: '#9C7CFF', deep: '#6E45F0', hue: '紫 ≈255°', mean: '在听、在想、在规划——还没动手' },
    work:  { key: 'work',  name: '执行',     color: '#5B8CFF', deep: '#2F62E8', hue: '蓝 ≈222°', mean: '正在改文件、跑命令、读资料' },
    ask:   { key: 'ask',   name: '需要你',   color: '#FFB547', deep: '#E08A00', hue: '琥珀 ≈36°', mean: '唯一需要用户行动的颜色' },
    ok:    { key: 'ok',    name: '完成',     color: '#3CCB7F', deep: '#139B55', hue: '绿 ≈148°', mean: '与产品成功色同一色相，略提亮' },
    err:   { key: 'err',   name: '异常',     color: '#FF6B6B', deep: '#E5293F', hue: '红 ≈0°', mean: '失败且需要处理' },
    off:   { key: 'off',   name: '离线',     color: '#B9B7B0', deep: '#8F8D86', hue: '暖灰', mean: '与产品文字暖灰同源，不抢眼' }
  };

  // 等距方块几何（viewBox 0..120）
  const SIL = 'M60 38 L87 53.6 L87 77.6 L60 93.2 L33 77.6 L33 53.6Z';
  const TOP = 'M60 38 L87 53.6 L60 69.2 L33 53.6Z';
  const LEFT = 'M33 53.6 L60 69.2 L60 93.2 L33 77.6Z';
  const FACE = 'matrix(1 -0.577 0 1 60 69.2)'; // 3D：右侧面局部坐标系
  const FLATFACE = 'matrix(1.35 0 0 1.35 37.05 56.8)'; // 平面：正面居中
  const TINYFACE = 'matrix(1.6 0 0 1.6 32.8 51)'; // 图标：眼睛更大
  const face = x => x.tiny ? TINYFACE : x.flat ? FLATFACE : FACE;

  const STYLE = `
.bf [class]{transform-box:fill-box}
.bf .f{animation:bf-f 3.2s ease-in-out infinite}
@keyframes bf-f{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
.bf .f-slow{animation:bf-f 4.8s ease-in-out infinite}
.bf .idle{animation:bf-jelly 4.4s ease-in-out infinite;transform-origin:50% 100%}
@keyframes bf-jelly{0%,34%,100%{transform:translateY(0) rotate(0) scale(1,1)}40%{transform:translateY(0) rotate(0) scale(1.035,.955)}49%{transform:translateY(-2px) rotate(-4.5deg) scale(.985,1.02)}59%{transform:translateY(0) rotate(3.5deg) scale(1,1)}68%{transform:rotate(-1.8deg)}77%{transform:rotate(.6deg)}81%{transform:rotate(0)}}
.bf .ant-idle{animation:bf-antj 4.4s ease-in-out infinite;transform-origin:50% 100%}
@keyframes bf-antj{0%,38%,100%{transform:rotate(0)}49%{transform:rotate(-10deg)}59%{transform:rotate(8deg)}68%{transform:rotate(-4deg)}77%{transform:rotate(1.5deg)}84%{transform:rotate(0)}}
.bf .hop{animation:bf-hop 1.2s ease-in-out infinite;transform-origin:50% 100%}
@keyframes bf-hop{0%,100%{transform:translateY(0) scale(1,1)}12%{transform:translateY(0) scale(1.06,.92)}32%{transform:translateY(-9px) scale(.97,1.04)}52%{transform:translateY(0) scale(1.04,.95)}64%{transform:translateY(-2px)}76%{transform:translateY(0)}}
.bf .breathe{animation:bf-br 4.2s ease-in-out infinite;transform-origin:50% 100%}
@keyframes bf-br{0%,100%{transform:scale(1,1)}50%{transform:scale(1.025,.965)}}
.bf .shake{animation:bf-shake 2.4s ease-in-out infinite;transform-origin:50% 100%}
@keyframes bf-shake{0%,22%,100%{transform:translateX(0)}4%,12%{transform:translateX(-2px) rotate(-3deg)}8%,16%{transform:translateX(2px) rotate(3deg)}}
.bf .ant{animation:bf-bob 3.2s ease-in-out infinite;transform-origin:50% 100%}
@keyframes bf-bob{0%,100%{transform:rotate(0)}50%{transform:rotate(5deg)}}
.bf .droop{transform-origin:50% 100%;transform:rotate(-28deg)}
.bf .blink{animation:bf-blink 4.6s infinite;transform-origin:center}
@keyframes bf-blink{0%,91%,97%,100%{transform:scaleY(1)}94%{transform:scaleY(.1)}}
.bf .glow{animation:bf-glow 1.6s ease-out infinite;transform-origin:center}
@keyframes bf-glow{0%{transform:scale(1);opacity:.45}100%{transform:scale(1.7);opacity:0}}
.bf .rip{animation:bf-rip 1.8s ease-out infinite both;transform-origin:center}
.bf .rip2{animation-delay:.9s}
@keyframes bf-rip{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.2);opacity:0}}
.bf .flash{animation:bf-flash 1s ease-in-out infinite}
@keyframes bf-flash{0%,100%{opacity:1}50%{opacity:.35}}
.bf .pulse{animation:bf-pulse 1.4s ease-in-out infinite;transform-origin:center}
@keyframes bf-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
.bf .dot{animation:bf-dot 1.2s ease-in-out infinite both;transform-origin:center}
.bf .d2{animation-delay:.16s}.bf .d3{animation-delay:.32s}
@keyframes bf-dot{0%,60%,100%{transform:translateY(0);opacity:.35}30%{transform:translateY(-3px);opacity:1}}
.bf .eq{animation:bf-eq .9s ease-in-out infinite both;transform-origin:50% 50%}
.bf .e2{animation-delay:.2s}.bf .e3{animation-delay:.4s}
@keyframes bf-eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
.bf .tapL{animation:bf-tap .3s ease-in-out infinite alternate}
.bf .tapR{animation:bf-tap .3s ease-in-out infinite alternate-reverse}
@keyframes bf-tap{from{transform:translateY(0)}to{transform:translateY(-3px)}}
.bf .code{animation:bf-code 3s ease-out infinite both;transform-origin:0 50%}
.bf .c2{animation-delay:.35s}.bf .c3{animation-delay:.7s}.bf .c4{animation-delay:1.05s}
@keyframes bf-code{0%{transform:scaleX(0)}18%,86%{transform:scaleX(1);opacity:1}100%{transform:scaleX(1);opacity:0}}
.bf .caret{animation:bf-flash .8s steps(1) infinite}
.bf .sweep{animation:bf-sweep 2.8s ease-in-out infinite}
@keyframes bf-sweep{0%,100%{transform:translate(0,0)}25%{transform:translate(14px,0)}50%{transform:translate(14px,14px)}75%{transform:translate(0,14px)}}
.bf .look{animation:bf-look 2.8s ease-in-out infinite}
@keyframes bf-look{0%,100%{transform:translate(0,-.5px)}25%{transform:translate(2.5px,-.5px)}50%{transform:translate(2.5px,1.5px)}75%{transform:translate(0,1.5px)}}
.bf .lookLR{animation:bf-lr 3s ease-in-out infinite}
@keyframes bf-lr{0%,100%{transform:translateX(-2.5px)}45%,55%{transform:translateX(2.5px)}}
.bf .spin{animation:bf-spin .9s linear infinite;transform-origin:center}
@keyframes bf-spin{to{transform:rotate(360deg)}}
.bf .prog{animation:bf-prog 2.6s ease-in-out infinite;transform-origin:0 50%}
@keyframes bf-prog{0%{transform:scaleX(.05)}80%,100%{transform:scaleX(1)}}
.bf .chk{stroke-dasharray:12;animation:bf-chk 3.6s ease-out infinite both}
.bf .k2{animation-delay:.6s}.bf .k3{animation-delay:1.2s}
@keyframes bf-chk{0%,10%{stroke-dashoffset:12}22%,90%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
.bf .wave{animation:bf-wave 1.1s ease-in-out infinite;transform-origin:0% 100%}
@keyframes bf-wave{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(14deg)}}
.bf .sweat{animation:bf-sweat 2s ease-in infinite}
@keyframes bf-sweat{0%{transform:translateY(0);opacity:0}15%{opacity:1}100%{transform:translateY(9px);opacity:0}}
.bf .crawl{animation:bf-crawl 2.4s ease-in-out infinite}
@keyframes bf-crawl{0%,100%{transform:translateX(-3px)}50%{transform:translateX(3px)}}
.bf .spark{animation:bf-spark 1.6s ease-in-out infinite both;transform-origin:center}
.bf .s2{animation-delay:.4s}.bf .s3{animation-delay:.8s}.bf .s4{animation-delay:1.2s}
@keyframes bf-spark{0%,100%{transform:scale(0);opacity:0}40%{transform:scale(1);opacity:1}70%{transform:scale(.6);opacity:.6}}
.bf .puff{animation:bf-puff 2s ease-out infinite both;transform-origin:center}
.bf .p2{animation-delay:.7s}
@keyframes bf-puff{0%{transform:translateY(0) scale(.5);opacity:0}25%{opacity:.8}100%{transform:translateY(-12px) scale(1.4);opacity:0}}
.bf .zz{animation:bf-z 3s ease-out infinite both}
.bf .z2{animation-delay:1s}.bf .z3{animation-delay:2s}
@keyframes bf-z{0%{transform:translate(0,0);opacity:0}20%{opacity:1}100%{transform:translate(8px,-16px);opacity:0}}
.bf .flow{stroke-dasharray:2 4;animation:bf-flow .8s linear infinite}
@keyframes bf-flow{to{stroke-dashoffset:-12}}
.bf .mini1{animation:bf-f 2.6s ease-in-out infinite}
.bf .mini2{animation:bf-f 2.6s ease-in-out -1.3s infinite}
.bf .ac-breathe{animation:bf-acb 3.2s ease-in-out infinite;transform-origin:center}
@keyframes bf-acb{0%,100%{opacity:.45;transform:scale(.85)}50%{opacity:1;transform:scale(1)}}
.bf .ac-ping{animation:bf-acp 1.8s ease-out infinite;transform-origin:center}
@keyframes bf-acp{0%{opacity:.8;transform:scale(.4)}100%{opacity:0;transform:scale(1.25)}}
.bf .ac-draw{stroke-dasharray:30;animation:bf-acd 2.6s ease-in-out infinite both}
@keyframes bf-acd{0%{stroke-dashoffset:30}35%,85%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
.bf .ac-travel{animation:bf-act 2s ease-in-out infinite}
@keyframes bf-act{0%,100%{transform:translateX(-5px)}50%{transform:translateX(5px)}}
.bf .ac-spin{animation:bf-spin 3s linear infinite;transform-origin:center}
.bf .ac-spin-r{animation:bf-spin 4.5s linear infinite reverse;transform-origin:center}
.bf .fur{animation:bf-fur 4.2s ease-in-out infinite;transform-origin:60px 100px}
@keyframes bf-fur{0%,100%{transform:scale(1,1)}50%{transform:scale(1.008,.994)}}
.bf .fw{transform-origin:60px 66px;animation:bf-fw 3.4s ease-in-out infinite}
.bf .fw1{animation-duration:4.1s;animation-delay:-1.3s}.bf .fw2{animation-duration:3.7s;animation-delay:-2.2s}.bf .fw3{animation-duration:4.6s;animation-delay:-.6s}
@keyframes bf-fw{0%,100%{transform:rotate(-.9deg)}50%{transform:rotate(.9deg)}}
.bf:hover .fw{animation:bf-ruffle .55s ease-in-out 3}.bf:hover .fw1{animation-delay:.08s}.bf:hover .fw2{animation-delay:.16s}.bf:hover .fw3{animation-delay:.24s}
@keyframes bf-ruffle{0%,100%{transform:rotate(0)}30%{transform:rotate(-3deg) translateY(-.3px)}70%{transform:rotate(3deg) translateY(-.3px)}}
@media (prefers-reduced-motion: reduce){.bf *{animation:none!important}}
`;

  let UID = 0;

  /* ---------- 部件（x = {P, u, plush}） ---------- */
  function defs(x) {
    const { P, u } = x;
    const hex = h => [1, 3, 5].map(i => (parseInt(h.substr(i, 2), 16) / 255).toFixed(3));
    const furHex = tint(P.side, relLum(P.side) < .05 ? .2 : .32);
    const [fr, fg, fb] = hex(furHex);
    return `<defs>
<filter id="ps${u}" x="-30%" y="-30%" width="160%" height="170%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1.4" stdDeviation="1.8" flood-color="#0b1220" flood-opacity=".16"/></filter>
<linearGradient id="tg${u}" gradientUnits="userSpaceOnUse" x1="60" y1="40" x2="60" y2="69.2"><stop offset="0" stop-color="${P.top0}"/><stop offset="1" stop-color="${P.top1}"/></linearGradient>
<linearGradient id="ao${u}" gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="105"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${.22 * (P.shade ?? 1)}"/></linearGradient>
<linearGradient id="rf${u}" gradientUnits="userSpaceOnUse" x1="0" y1="54" x2="0" y2="100"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="${.06 * (P.shade ?? 1)}"/></linearGradient>
<linearGradient id="lf${u}" gradientUnits="userSpaceOnUse" x1="0" y1="54" x2="0" y2="100"><stop offset="0" stop-color="#000" stop-opacity="${.02 * (P.shade ?? 1)}"/><stop offset="1" stop-color="#000" stop-opacity="${.1 * (P.shade ?? 1)}"/></linearGradient>
<radialGradient id="sh${u}"><stop offset="0" stop-color="#000" stop-opacity=".22"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<filter color-interpolation-filters="sRGB" id="hb${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".7"/></filter>
<linearGradient id="cr${u}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7C828C"/><stop offset=".28" stop-color="#F4F5F7"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset=".68" stop-color="#A9AEB7"/><stop offset="1" stop-color="#6A707A"/></linearGradient>
<linearGradient id="cc${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#C9CDD4"/><stop offset=".7" stop-color="#8D939D"/><stop offset="1" stop-color="#D7DAE0"/></linearGradient>
<linearGradient id="mt${u}" gradientUnits="userSpaceOnUse" x1="33" y1="38" x2="87" y2="69"><stop offset="0" stop-color="#fff" stop-opacity=".15"/><stop offset=".34" stop-color="#fff" stop-opacity=".75"/><stop offset=".4" stop-color="#fff" stop-opacity=".1"/><stop offset=".7" stop-color="#fff" stop-opacity=".0"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>
<linearGradient id="ms${u}" x1="0" y1="0" x2="0" y2="1"><stop offset=".2" stop-color="#fff" stop-opacity=".45"/><stop offset=".42" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".3"/></linearGradient>
<filter color-interpolation-filters="sRGB" id="br${u}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9 .03" numOctaves="2" seed="3" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1.6 -.75" result="a"/><feComposite in="a" in2="SourceAlpha" operator="in"/></filter>
<linearGradient id="mf${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".3"/></linearGradient>
<radialGradient id="bm${u}" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".45" stop-color="#fff" stop-opacity=".06"/><stop offset=".8" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></radialGradient>
<linearGradient id="bs${u}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
<filter color-interpolation-filters="sRGB" id="tb${u}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="${x.plush ? 3.6 : 2.6}"/></filter>
<filter color-interpolation-filters="sRGB" id="pf${u}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation=".2"/></filter>
<filter color-interpolation-filters="sRGB" id="ev${u}" x="-40%" y="-40%" width="180%" height="190%"><feGaussianBlur in="SourceAlpha" stdDeviation=".7"/><feOffset dx="-.3" dy="-.9" result="o"/><feComposite in="SourceAlpha" in2="o" operator="out" result="ring"/><feFlood flood-color="#000" flood-opacity=".16"/><feComposite in2="ring" operator="in" result="ish"/><feGaussianBlur in="SourceAlpha" stdDeviation=".35"/><feOffset dy=".45" result="d"/><feFlood flood-color="#000" flood-opacity=".22"/><feComposite in2="d" operator="in" result="ds"/><feMerge><feMergeNode in="ds"/><feMergeNode in="SourceGraphic"/><feMergeNode in="ish"/></feMerge></filter>
<filter color-interpolation-filters="sRGB" id="hl${u}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
<filter color-interpolation-filters="sRGB" id="fz${u}" x="-25%" y="-25%" width="150%" height="150%"><feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="2" seed="5" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale=".7" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter color-interpolation-filters="sRGB" id="fur${u}" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency="1.5 2.4" numOctaves="3" seed="9" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 ${fr} 0 0 0 0 ${fg} 0 0 0 0 ${fb} 0 0 0 2.2 -.95" result="a"/><feGaussianBlur in="a" stdDeviation=".55" result="ab"/><feComposite in="ab" in2="SourceAlpha" operator="in"/></filter>
</defs>`;
  }

  const relLum = h => { const c = [1, 3, 5].map(i => { const v = parseInt(h.substr(i, 2), 16) / 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
  const shadeHex = (h, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(h.substr(i, 2), 16) * (1 - k)).toString(16).padStart(2, '0')).join('');
  // 浅色（接近白）的身体 / 球放在浅底上会消失：自动加一圈同色系的细轮廓
  const edgeOf = h => /^#[0-9a-f]{6}$/i.test(h) && relLum(h) > .72 ? shadeHex(h, .2) : null;

  /* ---------- 毛绒：毕方是《山海经》里的神鸟，毛绒做成羽绒——表面一层顺向的绒羽，边缘一圈蓬松的绒毛 ---------- */
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const f2 = n => n.toFixed(2);
  // 毛绒：参考 3D 渲染的长毛——绒毛成簇（一簇 6 根从根部散开、向尖端收拢），根暗尖亮；
  // 颜色按受光位置取（左上方来光，顶面亮、右侧暗、越往下越暗），全部不透明。先画所有暗根，再画亮尖。
  const f1 = n => (Math.round(n * 10) / 10).toString();
  function down(x) {
    const { P, u } = x, r = rng(7), black = relLum(P.side) < .05, L0 = x.lod;
    const mixc = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - t) + parseInt(b.substr(i, 2), 16) * t).toString(16).padStart(2, '0')).join('');
    const hi = black ? '#3c3c44' : tint(P.side, .42), lo = black ? '#000000' : shadeHex(P.side, .26);
    const N = 14, tones = Array.from({ length: N }, (_, k) => { const t = k / (N - 1); return t < .5 ? mixc(lo, P.side, t * 2) : mixc(P.side, hi, (t - .5) * 2); });
    // 毕方“赤文”：羽根是身体的青色，往羽尖渐变成朱砂珊瑚色（像仙鹤翅尖那样，颜色长在羽毛末端）
    const CORAL = ['#b45a42', '#c76a4f', '#d67c5d', '#e2906e', '#eca683', '#f4bc9e'];
    // 低密度（小卡片）时毛变粗一点，覆盖率不掉，不会显得秃
    const WS = Math.sqrt(1 / Math.max(.35, Math.min(1, x.lod))), G = 4, SEG = 3, W = [.34, .24, .15].map(v => v * WS);   // 4 组分别摆动；每根毛分根 / 中 / 尖三段，越往尖越细越亮
    const buf = [{}, {}, {}]; let LY = 0, NOFLOW = false; const add = (g, s, col, d) => { const k = g + '|' + s + '|' + col; buf[LY][k] = (buf[LY][k] || '') + d; };  // 第 0 层是绒毛，第 1 层是毕方的羽
    const bin = v => tones[Math.max(0, Math.min(N - 1, Math.round(v * (N - 1))))];
    const cbin = v => CORAL[Math.max(0, Math.min(CORAL.length - 1, Math.round(v * (CORAL.length - 1))))];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const at = (q, s2, t) => lerp(lerp(q[0], q[1], s2), lerp(q[3], q[2], s2), t);
    // 受光压得很弱：各面明暗只差一点点，看到的是毛本身的颜色，而不是被光照成灰/黑两截
    const light = (px, py, base) => Math.max(0, Math.min(1, .62 + (base - (py - 53) * .011 - (px - 60) * .004 - .62) * .42 + (r() - .5) * .05));
    // 顺毛的流向场：相邻的毛方向和弯度一致，像梳过一样，而不是乱糟糟的噪点
    const flow = (px, py) => .32 * Math.sin(px * .19 + py * .11) + .18 * Math.sin(py * .27 - px * .07);
    const bendF = (px, py) => 2.2 * Math.sin(px * .15 - py * .12 + 1.3);
    const Q = (a, c, e, t0, t1) => { // 截取二次贝塞尔的 t0–t1 段
      const p = t => { const m = 1 - t; return [m * m * a[0] + 2 * m * t * c[0] + t * t * e[0], m * m * a[1] + 2 * m * t * c[1] + t * t * e[1]]; };
      const s = p(t0), f = p(t1), tm = (t0 + t1) / 2, mid = p(tm);
      const cx = 2 * mid[0] - (s[0] + f[0]) / 2, cy = 2 * mid[1] - (s[1] + f[1]) / 2;
      return `M${f1(s[0])} ${f1(s[1])}Q${f1(cx)} ${f1(cy)} ${f1(f[0])} ${f1(f[1])}`;
    };
    // 一簇毛：n 根从根部散开、向尖端收拢；coral>0 时羽尖渐变为珊瑚色
    function clump(px, py, ang, L, w, shade, g, n = 5, coral = 0) {
      if (!NOFLOW) ang += flow(px, py) * .6;
      const ux = Math.cos(ang), uy = Math.sin(ang), vx = -uy, vy = ux, bend = bendF(px, py) + (r() - .5) * .5;
      const tx = px + ux * L, ty = py + uy * L;
      for (let j = 0; j < n; j++) {
        const t = n > 1 ? (j / (n - 1) - .5) * 2 : 0, a = [px + vx * t * w, py + vy * t * w];
        const e = [tx + vx * t * w * .2 + (r() - .5) * .4, ty + vy * t * w * .2 + (r() - .5) * .4];
        const c = [(a[0] + e[0]) / 2 + vx * bend, (a[1] + e[1]) / 2 + vy * bend];
        const sh = shade + (r() - .5) * .06;
        // 赤文：羽根仍是身体色，越往毛尖越偏珊瑚色；coral 是 0–1 的浓度，斑块边缘自然变淡
        const cw = coral ? Math.round(coral * 4) / 4 : 0;
        add(g, 0, cw ? mixc(bin(sh - .2), cbin(sh), cw * .25) : bin(sh - .2), Q(a, c, e, 0, .45));
        add(g, 1, cw >= 1 ? mixc(cbin(.7), '#ffffff', .15) : cw ? mixc(bin(sh), cbin(sh + .25), cw * .7) : bin(sh), Q(a, c, e, .38, .74));
        add(g, 2, cw >= 1 ? mixc(cbin(1), '#ffffff', .3) : cw ? mixc(bin(sh + .22), cbin(sh + .45), cw) : bin(sh + .22), Q(a, c, e, .68, 1));
      }
    }
    const grp = () => Math.floor(r() * G);
    const faces = [
      { q: [[60, 38], [87, 53.6], [60, 69.2], [33, 53.6]], n: 420, top: true, base: .8 },
      { q: [[33, 53.6], [60, 69.2], [60, 93.2], [33, 77.6]], n: 380, d: 1.4, base: .7 },
      { q: [[60, 69.2], [87, 53.6], [87, 77.6], [60, 93.2]], n: 380, d: 1.74, base: .64 }
    ];
    if (!x.front) {
    // 脸：右侧面两只眼睛之间。脸上的毛短一些、顺着从脸中心向外梳，表情才看得清
    const EYE = [[69.5, 76.2], [84.5, 67.6]], FC = [77, 72];
    const faceK = (px, py) => { const d = Math.min(...EYE.map(e => Math.hypot(px - e[0], py - e[1]))); return Math.max(0, Math.min(1, (d - 3) / 9)); };
    // 毕方的“赤文”做成一对腮红：落在两颊（右侧面、眼睛外下方）的毛，毛尖渐变成珊瑚色
    const CHEEK = [[4.5, 18.8], [27.5, 18.8]];
    const warmAt = (px, py) => {
      if (!P.bifang) return 0;
      const lx = px - 60, ly = py - 69.2 + .577 * lx;
      let w = 0; for (const [cx2, cy2] of CHEEK) { const dx = (lx - cx2) / 4, dy = (ly - cy2) / 2.6; w = Math.max(w, Math.exp(-(dx * dx + dy * dy) * 1.4)); }
      return w < .18 ? 0 : Math.min(1, (w - .18) / .5);
    };
    // 底绒（第 4 组，不摆动）：先铺一层短而密的绒毛盖住整个身体（含圆角外沿），长毛之间不会露出光滑的底色
    {
      const UL = Math.max(L0, .45), hexP = [[60, 38], [87, 53.6], [87, 77.6], [60, 93.2], [33, 77.6], [33, 53.6]];
      for (const [fi, f] of faces.entries()) {
        const m = Math.round(f.n * 1.5 * UL), gs = Math.ceil(Math.sqrt(m));
        for (let i = 0; i < m; i++) {
          const su = ((i % gs) + r()) / gs, sv = Math.min(1, (Math.floor(i / gs) + r()) / Math.ceil(m / gs)), p = at(f.q, su, sv);
          const ang = f.top ? Math.atan2(p[1] - 53.6, p[0] - 60) + (r() - .5) * .5 : f.d + (r() - .5) * .4;
          clump(p[0], p[1], ang, 3 + r() * 2.2, .7, light(p[0], p[1], f.base) - .08, grp(), 3);
        }
      }
      for (let k = 0; k < 6; k++) {
        const a = hexP[k], b = hexP[(k + 1) % 6], seg = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = (b[1] - a[1]) / seg, ny = -(b[0] - a[0]) / seg;
        const base = ny < -.3 ? .8 : nx < -.5 ? .7 : nx > .5 ? .64 : .58;
        for (let i = 0, m = Math.round(seg * 4 * UL); i < m; i++) {
          const p = lerp(a, b, r()), off = r() * 9, sx = p[0] + nx * off, sy = p[1] + ny * off;
          clump(sx, sy, Math.atan2(ny, nx) + (r() - .5) * .8, 3 + r() * 2.5, .7, light(sx, sy, base) - .08, grp(), 3);
        }
        const cx0 = 60, cy0 = 65.6, vx = b[0] - cx0, vy = b[1] - cy0, vl = Math.hypot(vx, vy);
        for (let i = 0; i < 34; i++) { const o = r() * 10, sx = b[0] + vx / vl * o + (r() - .5) * 7, sy = b[1] + vy / vl * o + (r() - .5) * 7; clump(sx, sy, Math.atan2(vy, vx) + (r() - .5) * 1, 3 + r() * 2.5, .7, light(sx, sy, base) - .08, grp(), 3); }
      }
    }
    for (const [fi, f] of faces.entries()) {
      // 分层抖动采样：每个格子放一簇，分布均匀，不会一块密一块稀
      const m = Math.round(f.n * L0 * (fi === 2 ? 1.15 : 1)), gs = Math.ceil(Math.sqrt(m));
      for (let i = 0; i < m; i++) {
        const su = ((i % gs) + r()) / gs, sv = (Math.floor(i / gs) + r()) / Math.ceil(m / gs), p = at(f.q, su, Math.min(1, sv));
        let ang, L = (f.top ? 6 : 7.5) + r() * 4.5, sh = light(p[0], p[1], f.base);
        if (f.top) { ang = Math.atan2(p[1] - 53.6, p[0] - 60) + (r() - .5) * .3; sh -= Math.hypot((p[0] - 60) / 27, (p[1] - 53.6) / 15.6) * .12; }
        else ang = f.d + (r() - .5) * .25;
        if (fi === 2) { const k = faceK(p[0], p[1]); L *= .5 + .5 * k; const ox = p[0] - FC[0], oy = p[1] - FC[1], ol = Math.hypot(ox, oy) || 1, mk = .6 * (1 - k); ang = Math.atan2(Math.sin(ang) * (1 - mk) + oy / ol * mk, Math.cos(ang) * (1 - mk) + ox / ol * mk); sh += (1 - k) * .06; }
        const w = fi === 2 ? warmAt(p[0], p[1]) : 0;
        clump(p[0], p[1], ang, L * (1 - .45 * w), .6 + r() * .5, sh + w * .08, grp(), 5, w * .25);
      }
    }
    const poly = [[60, 38], [87, 53.6], [87, 77.6], [60, 93.2], [33, 77.6], [33, 53.6]], cx = 60, cy = 65.6;
    for (let k = 0; k < 6; k++) {
      const a = poly[k], b = poly[(k + 1) % 6], seg = Math.hypot(b[0] - a[0], b[1] - a[1]), nx = (b[1] - a[1]) / seg, ny = -(b[0] - a[0]) / seg;
      const base = ny < -.3 ? .8 : nx < -.5 ? .7 : nx > .5 ? .64 : .58;
      for (let i = 0, m = Math.round(seg * 3.4 * Math.max(L0, .45)); i < m; i++) {
        const p = lerp(a, b, r()), off = r() * 8, sx = p[0] + nx * off, sy = p[1] + ny * off;
        clump(sx, sy, Math.atan2(ny, nx) * .5 + Math.PI / 4 + (r() - .5) * .5, 5 + r() * 3.5, .5 + r() * .3, light(sx, sy, base), grp());
      }
      // 外缘长毛：轮廓上蓬出去的那一圈最能看出“毛”，也是摆动最明显的部分
      for (let i = 0, m = Math.round(seg * 3.8 * Math.max(L0, .45)); i < m; i++) {
        const p = lerp(a, b, r()), off = 5 + r() * 4, sx = p[0] + nx * off, sy = p[1] + ny * off;
        clump(sx, sy, Math.atan2(ny, nx) + (r() - .5) * .7, 5.5 + r() * 5.5, .45 + r() * .3, light(sx, sy, base - .04), grp(), 3);
      }
      const vx = b[0] - cx, vy = b[1] - cy, vl = Math.hypot(vx, vy);
      for (let i = 0; i < 10; i++) {
        const sx = b[0] + vx / vl * (4 + r() * 3), sy = b[1] + vy / vl * (4 + r() * 3);
        clump(sx, sy, Math.atan2(vy, vx) + (r() - .5) * 1.1, 4.5 + r() * 4, .45 + r() * .3, light(sx, sy, base), grp(), 3);
      }
    }
    // 嵌入感：喙上沿补几根短绒压边，像从毛里露出来；毛绒版天线不放金属托盘，直接插进毛里（底部一圈软阴影）
    LY = 2; NOFLOW = true;
    {
      const W2 = (lx, ly) => [60 + lx, 69.2 - .577 * lx + ly], D2 = (dx, dy) => Math.atan2(-.577 * dx + dy, dx);
      if (P.bifang) {
        for (let i = 0; i < 9; i++) { const [px, py] = W2(15 + i * .5 + (r() - .5) * .4, 14.1 + r() * .4); clump(px, py, D2(.1, 1), 1.6 + r() * .6, .25, light(px, py, .62), 0, 2); }
      }
    }
    NOFLOW = false;
    } else {
      // 正面毛绒：圆角矩形（与平面视图同形），毛从头顶向四周、向下梳；两眼周围毛短、向外梳
      const X0 = 26, X1 = 94, Y0 = 46, Y1 = 100, RR = 20, CX = 60, CY = 73;
      const inside = (px, py) => { const qx = Math.min(Math.max(px, X0 + RR), X1 - RR), qy = Math.min(Math.max(py, Y0 + RR), Y1 - RR); return Math.hypot(px - qx, py - qy) <= RR; };
      const fl = (px, py) => Math.max(0, Math.min(1, .62 + (.8 - (py - 46) * .006 - (px - 60) * .002 - .62) * .42 + (r() - .5) * .05));
      const EYF = [[49.9, 73], [70.1, 73]];
      const fk = (px, py) => { const d = Math.min(...EYF.map(e => Math.hypot((px - e[0]) * 1.4, py - e[1]))); return Math.max(0, Math.min(1, (d - 6) / 10)); };
      // 顺毛方向：整体向下垂，越靠两边越向外撇；头顶一圈略向上蓬
      const flowAng = (px, py) => { const sx = (px - 60) / 34, top = Math.max(0, (56 - py) / 10); return Math.atan2(1 - top * 1.6, sx * (1.1 + top)); };
      const UL = Math.max(L0, .45);
      const fill = (m, fn) => { const gs = Math.ceil(Math.sqrt(m)); for (let i = 0; i < m; i++) { const px = X0 + ((i % gs) + r()) / gs * (X1 - X0), py = Y0 + (Math.floor(i / gs) + r()) / Math.ceil(m / gs) * (Y1 - Y0); if (inside(px, py)) fn(px, py); } };
      fill(Math.round(2100 * UL), (px, py) => clump(px, py, flowAng(px, py) + (r() - .5) * .4, 4 + r() * 3, .8, fl(px, py) - .03, 4, 3));
      fill(Math.round(2000 * L0), (px, py) => {
        const k = fk(px, py); let ang = flowAng(px, py) + (r() - .5) * .3;
        if (k < 1) { const e = EYF[px < 60 ? 0 : 1], oa = Math.atan2(py - e[1], px - e[0]); ang = ang * k + oa * (1 - k); }
        clump(px, py, ang, (8.5 + r() * 5) * (.45 + .55 * k), .7 + r() * .5, fl(px, py) + (1 - k) * .05, grp(), 5);
      });
      // 外缘：沿轮廓一圈向外蓬的长毛
      for (let i = 0, m = Math.round(1100 * Math.max(L0, .45)); i < m; i++) {
        const th = (i + r()) / m * Math.PI * 2, dx = Math.cos(th), dy = Math.sin(th); let t = 0; while (inside(CX + dx * (t + .5), CY + dy * (t + .5)) && t < 60) t += .5;
        const off = -4 + r() * 9, px = CX + dx * (t + off), py = CY + dy * (t + off);
        clump(px, py, Math.atan2(dy * 1.15 + .25, dx) + (r() - .5) * .5, 6 + r() * 6, .5 + r() * .3, fl(px, py) - .03, off < 2 ? 4 : grp(), off < 2 ? 3 : 4);
      }
    }
    // 输出：每组一层 <g>，各自按不同节奏轻摆；同组内按 根 → 中 → 尖 的顺序叠
    let out = '';
    for (const B of buf.slice(0, 2)) for (let sg = 0; sg < SEG; sg++) for (let g = 0; g <= G; g++) {
      let t = '';
      for (const k in B) { const [gg, ss, col] = k.split('|'); if (+gg === g && +ss === sg) t += `<path d="${B[k]}" stroke="${col}" stroke-width="${W[sg]}"/>`; }
      if (t) out += g === G ? `<g class="fwu">${t}</g>` : `<g class="fw fw${g}">${t}</g>`;
    }
    let ov = ''; for (let sg = 0; sg < SEG; sg++) for (const k in buf[2]) { const [, ss, col] = k.split('|'); if (+ss === sg) ov += `<path d="${buf[2][k]}" stroke="${col}" stroke-width="${W[sg] * .85}"/>`; }
    x.furOver = `${bifangBlush(x)}<g class="fur-over" fill="none" stroke-linecap="round">${ov}</g>`;
    return `<g class="fur" fill="none" stroke-linecap="round">${out}</g>`;
  }

  // 毕方特别版：《山海经》“其状如鹤，一足，赤文青质而白喙”——青色身体、眼下一只小白喙，方块上的天线就是那“一足”。
  // “赤文”收成一对珊瑚色腮红：形状清楚、和表情结合；毛绒版另外让两颊的毛尖也泛红（见 down）
  // 腮红（径向渐变的柔和椭圆）：毕方默认珊瑚色；自己搭配里可以选颜色或关掉
  const BLUSH = { coral: '#ef8d70', pink: '#ff8fab', peach: '#ffb07c', rose: '#e8738f' };
  const blushColor = x => x.blushPick === '' ? null : x.blushPick ? BLUSH[x.blushPick] : x.P.bifang ? BLUSH.coral : null;
  const bifangBlush = x => { const col = blushColor(x); if (!col) return ''; const u = x.u, flat = x.flat, C = flat ? [[4, 20.2], [30, 20.2]] : [[4.5, 18.8], [27.5, 18.8]], rx = flat ? 3.4 : x.plush ? 5.6 : 3.8, ry = flat ? 2 : x.plush ? 3.4 : 2.3;
    return `<defs><radialGradient id="bfb${u}"><stop offset="0" stop-color="${col}" stop-opacity="${x.plush ? .92 : .85}"/><stop offset=".6" stop-color="${col}" stop-opacity="${x.plush ? .6 : .52}"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient></defs>
      <g transform="${face(x)}" fill="url(#bfb${u})">${C.map(([cx, cy]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`).join('')}</g>`; };
  function bifangMarks(x) {
    const beak = '#F4F1EA', flat = x.flat, blush = '';
    if (x.mouthPick) return '';  // 自己搭配里改过嘴型：由 render 统一处理（选“鸟嘴”时画喙，选别的嘴或“无”时不画）
    if (flat) { const t = x.tiny; return `${blush}<path d="M58.6 ${t ? 72 : 70.2} L61.4 ${t ? 72 : 70.2} L60 ${t ? 75.6 : 73}Z" fill="${beak}" stroke="${beak}" stroke-width=".9" stroke-linejoin="round"/>`; }
    return `${blush}<g transform="${FACE}"${x.plush ? ` filter="url(#ev${x.u})"` : ''}><path d="M15.2 15.7 Q17.1 15.2 19 15.7 L17.3 19Z" fill="${beak}" stroke="${beak}" stroke-width=".8" stroke-linejoin="round"/></g>`;
  }

  function body(x) {
    const { P, u, plush } = x, sw = plush ? 20 : 18;
    if (x.front) return `<rect x="26" y="46" width="68" height="54" rx="20" fill="${P.side}"/>${down(x)}`;
    if (x.flat) {
      const e = edgeOf(P.side);
      let f = `<rect x="26" y="46" width="68" height="54" rx="20" fill="${P.side}"${e ? ` stroke="${e}" stroke-width="${x.tiny ? 2.4 : 1.4}"` : ''}/>`;
      if (x.metal) f += `<rect x="26" y="46" width="68" height="54" rx="20" fill="url(#mf${u})"/><rect x="27" y="47" width="66" height="52" rx="19" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1"/>`;
      if (plush) f += `<rect x="26" y="46" width="68" height="54" rx="20" fill="#000" filter="url(#fur${u})" opacity="${P.furOp}"/>`;
      return plush ? `<g filter="url(#fz${u})">${f}</g>` : f;
    }
    const e = edgeOf(P.side);
    let g = `${e ? (plush ? `<path d="${SIL}" transform="translate(0 2.2)" fill="#0b1220" stroke="#0b1220" stroke-width="${sw}" stroke-linejoin="round" opacity=".13" filter="url(#hl${u})"/>` : `<path d="${SIL}" fill="${e}" stroke="${e}" stroke-width="${sw + 2.6}" stroke-linejoin="round"/>`) : ''}<path d="${SIL}" fill="${P.side}" stroke="${P.side}" stroke-width="${sw}" stroke-linejoin="round"/>
<path d="${LEFT}" fill="${plush ? P.side : P.sideL}" filter="url(#tb${u})"/>
<path d="${TOP}" fill="url(#tg${u})"${P.crisp ? '' : ` filter="url(#tb${u})"`}/>
<path d="M60 69.2 L87 53.6 L87 77.6 L60 93.2Z" fill="url(#rf${u})" filter="url(#tb${u})"/>${e ? `<path d="M60 69.2 L87 53.6 L87 77.6 L60 93.2Z" fill="#000" opacity=".035" filter="url(#tb${u})"/><path d="${LEFT}" fill="#000" opacity=".07" filter="url(#tb${u})"/>` : ''}
${plush ? '' : `<path d="${LEFT}" fill="url(#lf${u})" filter="url(#tb${u})"/>`}
<path d="M33.5 56 L60 71.4 L86.5 56" fill="none" stroke="#fff" stroke-opacity="${P.rim}" stroke-width="1.1" stroke-linecap="round" filter="url(#hb${u})"/>`;
    if (x.metal) g += `<mask id="mm${u}"><path d="${SIL}" fill="#fff" stroke="#fff" stroke-width="${sw}" stroke-linejoin="round"/></mask>
<g mask="url(#mm${u})"><path d="${TOP}" fill="url(#mt${u})"/>
<rect x="0" y="-12" width="36" height="42" transform="${FACE}" fill="url(#ms${u})"/>
<rect x="-9" y="-12" width="36" height="42" transform="matrix(1 .577 0 1 33 53.6)" fill="url(#ms${u})" opacity=".75"/></g>
<path d="M33.5 56 L60 71.4 L86.5 56" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="1.4" stroke-linecap="round" filter="url(#hb${u})"/>
<path d="M60 71.4 L60 92" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1" filter="url(#hb${u})"/>`;
    if (plush) g += `<path d="${SIL}" fill="#000" stroke="#000" stroke-width="${sw}" stroke-linejoin="round" filter="url(#fur${u})" opacity="${P.furOp}"/>
<mask id="m${u}"><path d="${SIL}" fill="#fff" stroke="#fff" stroke-width="${sw}" stroke-linejoin="round"/></mask>
<rect x="0" y="20" width="120" height="100" fill="url(#ao${u})" mask="url(#m${u})" opacity=".35"/>
<clipPath id="cl${u}"><path d="${SIL}" stroke="#000" stroke-width="${sw - 2}" stroke-linejoin="round"/></clipPath>${down(x)}<g transform="${FACE}" fill="#000" opacity=".1" filter="url(#hb${u})"><ellipse cx="9.5" cy="13" rx="4.4" ry="6.8"/><ellipse cx="24.5" cy="13" rx="4.4" ry="6.8"/></g>`;  // 眼窝：眼睛周围压暗一圈，像嵌进毛里
    return g;
  }

  function eyes(x, type, o = {}) {
    const { P } = x, ec = P.eye;
    const dx = o.dx || 0, dy = o.dy || 0, cls = o.cls ? ` class="${o.cls}"` : '';
    const E = [[9.5, 12], [24.5, 12]];
    const st = w => `fill="none" stroke="${ec}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
    const shine = (ex, ey) => P.shine ? `<circle cx="${ex - .8}" cy="${ey - 2.3}" r=".85" fill="#fff" opacity=".9"/>` : '';
    let s = '';
    switch (type) {
      case 'wide': s = E.map(([a, b]) => `<g class="blink"><ellipse cx="${a}" cy="${b}" rx="3.5" ry="6.2" fill="${ec}"/>${shine(a, b)}</g>`).join(''); break;
      case 'focus': s = E.map(([a, b]) => `<path d="M${a - 3} ${b - 1.6} H${a + 3} A3 5.2 0 0 1 ${a - 3} ${b - 1.6}Z" fill="${ec}"/>`).join(''); break;
      case 'squint': s = E.map(([a, b]) => `<path d="M${a - 3.1} ${b - .4} H${a + 3.1} A3.1 2.9 0 0 1 ${a - 3.1} ${b - .4}Z" fill="${ec}"/>`).join(''); break;
      // 完成：眼睛略微睁大，右上角闪一颗小星芒（眼睛本身保持干净，不挖洞、不变形）
      case 'happy': s = E.map(([a, b]) => `<ellipse cx="${a}" cy="${b - .3}" rx="3.5" ry="6.2" fill="${ec}"/>`).join('') + `<path d="M29.6 3.2 Q30 5.4 32.2 5.8 Q30 6.2 29.6 8.4 Q29.2 6.2 27 5.8 Q29.2 5.4 29.6 3.2Z" fill="${ec}" class="spark"/>`; break;
      // 完成 · 备选：实心弯月笑眼
      case 'happyCrescent': s = E.map(([a, b]) => `<path d="M${a - 3.2} ${b + 1.8} Q${a} ${b - 5.6} ${a + 3.2} ${b + 1.8} Q${a} ${b - 1.4} ${a - 3.2} ${b + 1.8}Z" fill="${ec}" stroke="${ec}" stroke-width=".6" stroke-linejoin="round"/>`).join(''); break;
      // 离线：眼睛收成低处的一条短胶囊，像合上的眼缝
      case 'closed': s = E.map(([a, b]) => `<rect x="${a - 2.8}" y="${b + 1.4}" width="5.6" height="2" rx="1" fill="${ec}"/>`).join(''); break;
      // 离线 · 备选：缩小的点状眼（像熄屏的指示灯）
      case 'closedDot': s = E.map(([a, b]) => `<circle cx="${a}" cy="${b + 1.6}" r="1.5" fill="${ec}" opacity=".7"/>`).join(''); break;
      case 'xx': { const [[a, b], [c, d]] = E; s = `<path d="M${a - 1.8} ${b - 2.6} L${a + 1.8} ${b} L${a - 1.8} ${b + 2.6}" ${st(2.5)}/><path d="M${c + 1.8} ${d - 2.6} L${c - 1.8} ${d} L${c + 1.8} ${d + 2.6}" ${st(2.5)}/>`; break; }
      default: s = E.map(([a, b]) => `<g class="blink"><ellipse cx="${a}" cy="${b}" rx="2.9" ry="5.3" fill="${ec}"/>${shine(a, b)}</g>`).join('');
    }
    return `<g transform="${face(x)}"${x.plush ? ` filter="url(#ev${x.u})"` : ''}><g transform="translate(${dx} ${dy})"><g${cls}>${s}</g></g></g>`;  // 毛绒：眼睛做成有体积的小珠子
  }

  const blush = (x, op = .75) => !x.cute || x.P.bifang || x.blushPick !== undefined ? '' : `<g transform="${face(x)}" fill="${x.P.blush}" opacity="${op}"><ellipse cx="4" cy="20.2" rx="3" ry="1.7"/><ellipse cx="30" cy="20.2" rx="3" ry="1.7"/></g>`;
  const soft = x => blush(x, x.P.softOp || .45);
  // 鸟嘴（白喙）：毕方默认带；其他颜色在“自己搭配”里选“鸟嘴”也可以加。浅色身体上白喙看不见，改用暖黄色
  function beakOf(x) {
    const beak = relLum(x.P.side) > .6 ? '#F2B04E' : '#F4F1EA', t = x.tiny;
    if (x.flat) return `<path d="M58.6 ${t ? 72 : 70.2} L61.4 ${t ? 72 : 70.2} L60 ${t ? 75.6 : 73}Z" fill="${beak}" stroke="${beak}" stroke-width=".9" stroke-linejoin="round"/>`;
    return `<g transform="${FACE}"${x.plush ? ` filter="url(#ev${x.u})"` : ''}><path d="M15.2 15.7 Q17.1 15.2 19 15.7 L17.3 19Z" fill="${beak}" stroke="${beak}" stroke-width=".8" stroke-linejoin="round"/></g>`;
  }
  function mouth(x, type, fixed) {
    if (x.mouthPick && !fixed) { if (x.mouthPick !== 'state') return ''; } else if (!x.cute && !fixed) return '';
    const ec = x.P.eye, st = `fill="none" stroke="${ec}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"`;
    const m = {
      smile: `<path d="M15.4 18.6 Q17 20.6 18.6 18.6" ${st}/>`,
      cat: `<path d="M14.6 18.7 Q15.8 20.3 17 18.9 Q18.2 20.3 19.4 18.7" ${st}/>`,
      o: `<ellipse cx="17" cy="19.3" rx="1.15" ry="1.45" fill="${ec}"/>`,
      grin: `<path d="M14.6 18 Q17 23.2 19.4 18 Z" fill="${ec}"/>`,
      wavy: `<path d="M14.6 19.4 q1.2 -1.3 2.4 0 t2.4 0" ${st}/>`,
      flat: `<path d="M15.6 19.2 H18.4" ${st}/>`
    }[type];
    return `<g transform="${face(x)}"${x.plush ? ` filter="url(#ev${x.u})"` : ''}>${m}</g>`;
  }

  function antenna(x, color, fx = [], cls = 'ant') {
    const { P, u, plush } = x;
    if (x.tiny) fx = [];
    let under = '', over = '', ballCls = '';
    if (P.ring) under += x.tiny ? `<circle cx="60" cy="27" r="14.2" fill="${P.ring}"/>` : x.flat ? `<circle cx="60" cy="28" r="11.2" fill="${P.ring}"/>` : `<circle cx="60" cy="29" r="13" fill="${P.ring}"/>`;
    if (fx.includes('glow')) under += `<circle class="glow" cx="60" cy="29" r="11.5" fill="${color}"/>`;
    if (fx.includes('ripple')) under += `<circle class="rip" cx="60" cy="29" r="11.5" fill="none" stroke="${color}" stroke-width="1.6"/><circle class="rip rip2" cx="60" cy="29" r="11.5" fill="none" stroke="${color}" stroke-width="1.6"/>`;
    if (fx.includes('flash')) ballCls = ' class="flash"';
    if (fx.includes('pulse')) ballCls = ' class="pulse"';
    if (fx.includes('spin')) over += `<g class="spin"><circle cx="60" cy="29" r="15" fill="none"/><path d="M60 14 A15 15 0 0 1 75 29" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/></g>`;
    if (fx.includes('orbit')) over += `<g><circle cx="60" cy="29" r="17" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="1" stroke-dasharray="1.5 3"/><circle cx="77" cy="29" r="2.6" fill="${color}"><animateTransform attributeName="transform" type="rotate" from="0 60 29" to="360 60 29" dur="1.8s" repeatCount="indefinite"/></circle></g>`;
    if (fx.includes('smoke')) over += `<circle class="puff" cx="67" cy="14" r="3.2" fill="#B9BEC7"/><circle class="puff p2" cx="71" cy="12" r="2.4" fill="#B9BEC7"/>`;
    const be = edgeOf(color), bs = be ? ` stroke="${be}" stroke-width="${x.tiny ? 2 : 1.1}"` : '';
    const ball = x.tiny ? `<circle cx="60" cy="27" r="12.5" fill="${color}"${bs}/>` : x.flat ? `<circle cx="60" cy="28" r="9.6" fill="${color}"${bs}/>${x.front ? `<circle cx="60" cy="28" r="9.6" fill="url(#bm${u})"/>` : ''}` : `<circle cx="60" cy="29" r="11.5" fill="${color}"${bs}/>${plush ? `<circle cx="60" cy="29" r="11.5" fill="url(#bm${u})"/>` : `<circle cx="60" cy="29" r="11.5" fill="url(#bs${u})"/>`}${plush ? '' : `<ellipse cx="55.6" cy="23.8" rx="4" ry="2.6" transform="rotate(-30 55.6 23.8)" fill="#fff" opacity=".6" filter="url(#hb${u})"/><circle cx="60" cy="29" r="11.1" fill="none" stroke="#000" stroke-opacity=".1" stroke-width=".8"/>`}`;
    return `<g class="${cls}">
      ${x.front ? `<ellipse cx="60" cy="49" rx="4.4" ry="1.8" fill="#000" opacity=".2" filter="url(#hb${u})"/><rect x="58.2" y="35" width="3.6" height="14.5" rx="1.8" fill="url(#cr${u})"/>` : x.flat ? `<rect x="58.3" y="36" width="3.4" height="10.2" fill="${edgeOf(P.side) || P.side}"/>`
        : `${plush ? `<ellipse cx="60" cy="54.4" rx="5.2" ry="2.4" fill="#000" opacity=".22" filter="url(#hb${u})"/><rect x="57.4" y="30" width="5.2" height="24" rx="2.6" fill="url(#cr${u})"/>` : `<rect x="57.4" y="30" width="5.2" height="23.5" rx="2.6" fill="url(#cr${u})"/><ellipse cx="60" cy="53.8" rx="7" ry="3.6" fill="url(#cc${u})"/><ellipse cx="60" cy="53.1" rx="4" ry="1.7" fill="#fff" opacity=".55"/>`}`}
      <g transform="${x.flat ? '' : 'translate(0 -10) translate(60 29) scale(1.14) translate(-60 -29)'}">
      ${under}
      <g${ballCls}>${ball}</g>
      ${over}
      </g>
    </g>`;
  }

  const hand = (x, hx, hy, cls = '') => `<ellipse${cls ? ` class="${cls}"` : ''} cx="${hx}" cy="${hy}" rx="4.8" ry="3.8" fill="${x.P.hand}"${x.plush ? ` filter="url(#fz${x.u})"` : ''}/>`;
  const sparkle = (sx, sy, r, color, cls) => `<path class="spark ${cls}" d="M${sx} ${sy - r} Q${sx} ${sy} ${sx + r} ${sy} Q${sx} ${sy} ${sx} ${sy + r} Q${sx} ${sy} ${sx - r} ${sy} Q${sx} ${sy} ${sx} ${sy - r}Z" fill="${color}"/>`;

  function mini(x, tx, ty, color, cls) {
    const { P } = x;
    return `<g transform="translate(${tx} ${ty}) scale(.34)"><g class="${cls}"${x.plush ? ` filter="url(#fz${x.u})"` : ''}>
      ${x.flat ? `<rect x="26" y="46" width="68" height="54" rx="20" fill="${P.side}"/><rect x="57.5" y="38" width="5" height="9" fill="${P.side}"/>` : `<path d="${SIL}" fill="${P.side}" stroke="${P.side}" stroke-width="18" stroke-linejoin="round"/>
      <path d="${TOP}" fill="${P.top1}" opacity=".55"/>
      <line x1="60" y1="53" x2="60" y2="41" stroke="${P.stem}" stroke-width="5" stroke-linecap="round"/>`}
      <circle cx="60" cy="29" r="11.5" fill="${color}"/>
      <g transform="${face(x)}" fill="${P.eye}"><ellipse cx="9.5" cy="12" rx="3.4" ry="5.8"/><ellipse cx="24.5" cy="12" rx="3.4" ry="5.8"/></g>
    </g></g>`;
  }

  /* ---------- 状态定义 ---------- */
  const STATES = [
    { id: 'idle', cat: 'idle', name: '待命', en: 'Idle', pill: '在线 · 随时待命',
      when: '已连接设备、没有进行中的任务；首页与会话空闲时。',
      notes: '还原视频里的动作：先压扁蓄力，再左右摇摆几下回正，天线跟着甩；平时眨眼。默认只有眼睛；切到“萌”表情时会加“ω”小嘴和淡腮红。', wrap: 'idle' },
    { id: 'listening', cat: 'think', name: '聆听', en: 'Listening', pill: '正在听你说…',
      when: '语音输入中，或用户正在输入长消息时。',
      notes: '眼睛放大表示“专注于你”；天线发出声波涟漪，侧边频谱条跟随音量。', wrap: 'f' },
    { id: 'thinking', cat: 'think', name: '思考', en: 'Thinking', pill: '思考中…',
      when: '收到请求、模型首个 token 之前的短暂思考。',
      notes: '视线上飘到右上，思考气泡里三点依次跳动；天线紫色呼吸光晕。', wrap: 'f' },
    { id: 'reasoning', cat: 'think', name: '深度推理', en: 'Deep reasoning', pill: '深度推理 · 已思考 18s',
      when: '开启深度思考 / 长链推理，耗时较长时。',
      notes: '眯眼用力想；天线有一颗卫星点绕行。和“思考”的区别只在眼型和天线动效，不加背景装饰。', wrap: 'f-slow' },
    { id: 'planning', cat: 'think', name: '规划', en: 'Planning', pill: '拆解任务 · 3 步',
      when: '生成 Plan / Todo、拆分子任务时。',
      notes: '左手举着清单，勾选逐条出现；视线看向清单。', wrap: 'f' },
    { id: 'coding', cat: 'work', name: '写代码', en: 'Coding', pill: '编辑 src/app.ts',
      when: 'Agent 正在生成 / 修改文件。',
      notes: '“敲键盘”：双手在身前交替敲击，右侧编辑器逐行长出代码。专注眼（上眼睑压平）。', wrap: '' },
    { id: 'searching', cat: 'work', name: '检索阅读', en: 'Searching', pill: '读取 12 个文件',
      when: '搜索代码库、读文件、联网查资料。',
      notes: '放大镜在文档上扫视，眼睛与放大镜同步移动——视线就是“正在看哪里”。', wrap: 'f' },
    { id: 'running', cat: 'work', name: '运行构建', en: 'Running', pill: '运行测试 · 42/60',
      when: '执行终端命令、构建、跑测试。',
      notes: '天线球外圈变成加载环；右侧终端里进度条推进。等待型任务不加手部动作。', wrap: 'f' },
    { id: 'debugging', cat: 'work', name: '调试排错', en: 'Debugging', pill: '定位问题 · TypeError',
      when: '发现报错后自主排查、修复中。',
      notes: '举放大镜盯着一只小虫，额头冒汗——主动在处理，表情专注而不是沮丧。', wrap: 'f' },
    { id: 'collab', cat: 'work', name: '多 Agent 协作', en: 'Sub-agents', pill: '3 个子任务并行',
      when: '派生子 Agent 并行处理、跨设备协同。',
      notes: '召唤出两只迷你方块分身，天线之间有数据流；本体左右看着分身——“我在统筹”。', wrap: 'f' },
    { id: 'awaiting', cat: 'ask', name: '等你确认', en: 'Needs you', pill: '需要你确认 · 2 处修改',
      when: '需要授权（执行命令、写文件、付费操作）或需要用户补充信息。',
      notes: '唯一会主动吸引注意的状态：举手挥动，天线球琥珀色闪烁；“萌”表情下另加腮红。', wrap: 'f' },
    { id: 'done', cat: 'ok', name: '完成', en: 'Done', pill: '已完成 · 修改 5 个文件',
      when: '任务结束、测试通过、交付结果时。',
      notes: '眼睛亮起（竖眼加两颗反光点），压扁后弹起的小跳，天线球变绿并带柔光，球内不放图标。播放 2–3 个循环后回到待命。', wrap: 'hop' },
    { id: 'error', cat: 'err', name: '出错', en: 'Error', pill: '构建失败 · 查看日志',
      when: '任务失败且无法自动恢复、网络中断。',
      notes: '“> <”挤眼 + 短促果冻摇晃，天线红色闪烁冒烟。胶囊给出明确下一步。', wrap: 'shake' },
    { id: 'sleeping', cat: 'off', name: '休眠 / 离线', en: 'Offline', pill: '离线 · 电脑已休眠',
      when: '设备断开、电脑休眠、长时间无操作。',
      notes: '眼睛收成一条眼缝，天线耷拉并变灰，缓慢呼吸，Zzz 升起。以“睡着”替代生硬的断开图标。', wrap: 'breathe' }
  ];

  function parts(id, x, c, compact) {
    const B = body(x) + (x.P.bifang ? bifangMarks(x) : '');
    switch (id) {
      case 'idle': return [B, antenna(x, c, [], 'ant-idle'), eyes(x, 'normal'), soft(x), mouth(x, 'cat')];
      case 'listening': return [B, antenna(x, c, ['ripple']), eyes(x, 'wide'), soft(x), mouth(x, 'smile'),
        !compact && `<g fill="${c}"><rect class="eq" x="103" y="58" width="4" height="20" rx="2"/><rect class="eq e2" x="110" y="54" width="4" height="28" rx="2"/><rect class="eq e3" x="117" y="60" width="4" height="16" rx="2"/></g>`];
      case 'thinking': return [B, antenna(x, c, ['glow']), eyes(x, 'normal', { dx: 1.5, dy: -2.5 }), soft(x), mouth(x, 'o'),
        !compact && `<circle cx="97" cy="40" r="2.2" fill="#fff" filter="url(#ps${x.u})"/><circle cx="103" cy="31" r="3.2" fill="#fff" filter="url(#ps${x.u})"/>
         <rect x="102" y="4" width="32" height="18" rx="9" fill="#fff" filter="url(#ps${x.u})"/>
         <g fill="${c}"><circle class="dot" cx="111" cy="13" r="2.1"/><circle class="dot d2" cx="118" cy="13" r="2.1"/><circle class="dot d3" cx="125" cy="13" r="2.1"/></g>`];
      case 'reasoning': return [B, antenna(x, c, ['orbit']), eyes(x, 'squint'), soft(x), mouth(x, 'wavy')];
      case 'planning': return [B, antenna(x, c, ['glow']), eyes(x, 'normal', { dx: -2, dy: 1 }), soft(x), mouth(x, 'smile'),
        !compact && `<g transform="translate(9 0)"><rect x="-17" y="46" width="31" height="44" rx="5" fill="#fff" filter="url(#ps${x.u})"/>
         ${[58, 69, 80].map((y, i) => `<rect x="-12" y="${y - 3.5}" width="7" height="7" rx="2" fill="none" stroke="${tint(c, .45)}" stroke-width="1.3"/>
           <path class="chk ${['', 'k2', 'k3'][i]}" d="M-10.5 ${y} l2 2 l4 -4.5" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
           <rect x="-2" y="${y - 1.4}" width="${[12, 9, 11][i]}" height="2.8" rx="1.4" fill="${tint(c, .7)}"/>`).join('')}</g>`,
        !compact && hand(x, 23, 82)];
      case 'coding': return [B, antenna(x, c, ['pulse']), eyes(x, 'focus', { dx: 1.5, dy: 1 }), soft(x), mouth(x, 'flat'),
        !compact && `<rect x="95" y="22" width="41" height="38" rx="6" fill="#fff" filter="url(#ps${x.u})"/>
         <g fill="${tint(c, .72)}"><circle cx="101" cy="28" r="1.4"/><circle cx="105.5" cy="28" r="1.4"/><circle cx="110" cy="28" r="1.4"/></g>
         <rect class="code" x="101" y="35" width="20" height="3" rx="1.5" fill="${c}"/>
         <rect class="code c2" x="105" y="41.5" width="25" height="3" rx="1.5" fill="${tint(c, .7)}"/>
         <rect class="code c3" x="105" y="48" width="15" height="3" rx="1.5" fill="${tint(c, .4)}"/>
         <rect class="code c4" x="101" y="54.5" width="10" height="3" rx="1.5" fill="${tint(c, .7)}"/>
         <rect class="caret" x="113" y="53.5" width="1.6" height="5" fill="${c}"/>
         <rect x="28" y="104" width="64" height="10" rx="3.5" fill="#F3F4F6" filter="url(#ps${x.u})"/>
         <g fill="#D9DDE3">${[34, 42, 50, 58, 66, 74, 82].map(k => `<rect x="${k}" y="106.5" width="5" height="2" rx="1"/>`).join('')}<rect x="44" y="110" width="32" height="2" rx="1"/></g>`,
        !compact && hand(x, 46, 104, 'tapL'), !compact && hand(x, 74, 104, 'tapR')];
      case 'searching': return [B, antenna(x, c, ['pulse']), eyes(x, 'normal', { cls: 'look' }), soft(x), mouth(x, 'o'),
        !compact && `<rect x="98" y="40" width="38" height="48" rx="5" fill="#fff" filter="url(#ps${x.u})"/>
         <g fill="${tint(c, .7)}">${[49, 55, 61, 67, 73, 79].map((y, i) => `<rect x="103" y="${y}" width="${[26, 20, 28, 14, 24, 18][i]}" height="2.6" rx="1.3"/>`).join('')}</g>
         <g class="sweep"><circle cx="108" cy="56" r="8.5" fill="${c}" fill-opacity=".12" stroke="${C.ink}" stroke-width="2.6"/>
         <line x1="114.2" y1="62.2" x2="121" y2="69" stroke="${C.ink}" stroke-width="3.6" stroke-linecap="round"/></g>`];
      case 'running': return [B, antenna(x, c, ['spin']), eyes(x, 'normal', { dx: 1.5, dy: 1 }), soft(x), mouth(x, 'smile'),
        !compact && `<rect x="95" y="46" width="42" height="34" rx="6" fill="#1F2329" filter="url(#ps${x.u})"/>
         <path d="M101 55 l4 3 l-4 3" fill="none" stroke="${tint(c, .25)}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
         <rect class="caret" x="107.5" y="60" width="6" height="1.8" rx=".9" fill="#E8EAEE"/>
         <rect x="101" y="69" width="30" height="4" rx="2" fill="#3A3F4B"/>
         <rect class="prog" x="101" y="69" width="30" height="4" rx="2" fill="${c}"/>`];
      // 调试：右侧代码卡，一行报错（红色波浪线）被替换成修好的一行
      case 'debugging': return [B, antenna(x, c, ['pulse']), eyes(x, 'focus', { dx: 1.5, dy: 1 }), soft(x), mouth(x, 'wavy'),
        !compact && `<rect x="96" y="38" width="40" height="46" rx="6" fill="#fff" filter="url(#ps${x.u})"/>
         <g fill="${tint(c, .72)}">${[47, 53, 71, 77].map((y, i) => `<rect x="101" y="${y}" width="${[24, 18, 26, 14][i]}" height="2.6" rx="1.3"/>`).join('')}</g>
         <rect x="99" y="58" width="34" height="10" rx="3" fill="#EF5A4C" opacity=".1" class="flash"/>
         <rect x="101" y="60" width="22" height="2.6" rx="1.3" fill="#EF5A4C" opacity=".85"/>
         <path d="M101 65.4 q1.4 -1.6 2.8 0 t2.8 0 t2.8 0 t2.8 0 t2.8 0 t2.8 0 t2.8 0" fill="none" stroke="#EF5A4C" stroke-width="1" stroke-linecap="round"/>
         <rect class="code" x="101" y="60" width="22" height="2.6" rx="1.3" fill="${c}"/>`];
      // 协作：两只迷你分身在两侧，细连线 + 流动的数据点
      case 'collab': {
        const L = [-0.8, 66], Rr = [121.2, 66], from = [60, 18];
        const path = ([tx, ty]) => `M${from[0]} ${from[1]} Q${(from[0] + tx) / 2} ${from[1] - 4} ${tx} ${ty}`;
        return [
          !compact && [L, Rr].map((p, k) => `<path d="${path(p)}" fill="none" stroke="${c}" stroke-opacity=".35" stroke-width="1" stroke-dasharray="1.5 3"/>
           <circle r="1.8" fill="${c}"><animateMotion dur="2s" begin="${k}s" repeatCount="indefinite" path="${path(p)}"/></circle>`).join(''),
          B, antenna(x, c, ['pulse']), eyes(x, 'normal', { cls: 'lookLR' }), soft(x), mouth(x, 'smile'),
          !compact && mini(x, -21.2, 58, '#8B7CF6', 'mini1'), !compact && mini(x, 100.8, 58, x.P.accent, 'mini2')];
      }
      case 'awaiting': return [B, antenna(x, c, ['flash']), eyes(x, 'wide'), blush(x), mouth(x, 'o'),
        !compact && `<g class="wave"><path d="M91 68 Q103 62 106 50" fill="none" stroke="${x.P.side}" stroke-width="7" stroke-linecap="round"/><circle cx="106.5" cy="47" r="5.2" fill="${x.P.hand}"/></g>
         <g class="pulse"><circle cx="126" cy="32" r="8.5" fill="${c}"/><rect x="124.6" y="26.5" width="2.8" height="7" rx="1.4" fill="#fff"/><circle cx="126" cy="36.6" r="1.6" fill="#fff"/></g>`];
      case 'done': return [B, antenna(x, c, ['glow']), eyes(x, 'happy'), blush(x, .85), mouth(x, 'grin'),
        !compact && sparkle(14, 40, 6, c, ''), !compact && sparkle(106, 30, 7, '#F5A524', 's2'), !compact && sparkle(112, 80, 5, c, 's3'), !compact && sparkle(6, 78, 4.5, '#F5A524', 's4')];
      case 'error': return [B, antenna(x, c, compact ? ['flash'] : ['flash', 'smoke']), eyes(x, 'xx'), mouth(x, 'wavy')];
      case 'sleeping': return [B, antenna(x, c, [], 'droop'), eyes(x, 'closed'), soft(x), mouth(x, 'o'),
        !compact && `<g fill="none" stroke="${C.sub}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <path class="zz" d="M95 36 h5 l-5 6 h5"/><path class="zz z2" d="M95 36 h6.5 l-6.5 7.5 h6.5"/><path class="zz z3" d="M95 36 h8 l-8 9 h8"/></g>`];
    }
  }

  /* ---------- 颜色解析：待命=配色主色；同色系冲突时用加深版 ---------- */
  function hueOf(h) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255), M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
    if (d < .06) return null; // 近中性色没有色相
    const x = M === r ? ((g - b) / d) % 6 : M === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (x * 60 + 360) % 360;
  }
  const chroma = h => { const v = [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255); return Math.max(...v) - Math.min(...v); };
  const hueDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };
  // 身体与状态色相差 < 30° 时自动换成加深版
  function isDeep(cat, palette) {
    const P = typeof palette === 'object' ? palette : PALETTES[palette || 'obsidian'], hb = hueOf(P.side), hs = hueOf(CAT[cat].color);
    if (P.status) return false;
    return cat !== 'idle' && cat !== 'off' && hb != null && hs != null && chroma(P.side) >= .15 && hueDist(hb, hs) < 30;
  }
  function statusColor(cat, palette) {
    const P = typeof palette === 'object' ? palette : PALETTES[palette || 'obsidian'];
    if (cat === 'idle') return P.accent;
    if (P.status && P.status[cat]) return P.status[cat];
    return isDeep(cat, palette) ? CAT[cat].deep : CAT[cat].color;
  }

  /* ---------- 点缀：替代卡通道具的线框小标记（opt.accent） ---------- */
  // 线框图形本身，坐标范围约 ±10；bg=true 时线宽不随缩放变粗，用于大尺寸背景纹样
  function accentGlyph(id, c, bg = false) {
    const L = `fill="none" stroke="${c}" stroke-width="${bg ? 1.3 : 1.6}"${bg ? ' vector-effect="non-scaling-stroke"' : ''} stroke-linecap="round" stroke-linejoin="round"`;
    const k = bg ? .5 : 1; // 背景版：实心点缩小，保持线稿感
    return {
      idle: `<circle r="7" ${L} opacity=".35"/><circle class="ac-breathe" r="${3 * k}" fill="${c}"/>`,
      listening: [-6, -2, 2, 6].map((x, i) => `<line class="eq ${['', 'e2', 'e3', 'e2'][i]}" x1="${x}" y1="-7" x2="${x}" y2="7" ${L}/>`).join(''),
      thinking: [-6, 0, 6].map((x, i) => `<circle class="dot ${['', 'd2', 'd3'][i]}" cx="${x}" cy="0" r="${1.9 * k}" fill="${c}"/>`).join(''),
      reasoning: `<g class="ac-spin"><path d="M0 -8 A8 8 0 0 1 8 0" ${L}/><path d="M0 8 A8 8 0 0 1 -8 0" ${L}/></g><g class="ac-spin-r"><path d="M4 0 A4 4 0 0 1 0 4" ${L} opacity=".55"/><path d="M-4 0 A4 4 0 0 1 0 -4" ${L} opacity=".55"/></g>`,
      planning: [-6, 0, 6].map((y, i) => `<path class="chk ${['', 'k2', 'k3'][i]}" d="M-8 ${y} l1.6 1.6 l2.8 -3" ${L}/><line x1="-1" y1="${y}" x2="${[8, 5, 7][i]}" y2="${y}" ${L} opacity=".45"/>`).join(''),
      coding: `<path d="M-4 -6 L-9 0 L-4 6 M4 -6 L9 0 L4 6" ${L}/><line class="caret" x1="1.4" y1="-6" x2="-1.4" y2="6" ${L}/>`,
      searching: `<g class="sweep"><circle cx="-2" cy="-2" r="5.2" ${L}/><line x1="1.8" y1="1.8" x2="6" y2="6" ${L}/></g>`,
      running: bg ? `<line x1="-9" y1="0" x2="9" y2="0" ${L} opacity=".3"/><line class="prog" x1="-9" y1="0" x2="9" y2="0" ${L}/>` : `<rect x="-9" y="-1.6" width="18" height="3.2" rx="1.6" fill="${c}" opacity=".2"/><rect class="prog" x="-9" y="-1.6" width="18" height="3.2" rx="1.6" fill="${c}"/>`,
      debugging: `<circle r="6.5" ${L}/><path d="M0 -9.5 V-5 M0 5 V9.5 M-9.5 0 H-5 M5 0 H9.5" ${L}/><circle class="ac-breathe" r="${1.8 * k}" fill="${c}"/>`,
      collab: `<path d="M-7 5 L0 -6 L7 5 Z" ${L} opacity=".4"/>${[[-7, 5], [0, -6], [7, 5]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${2.3 * k}" fill="${c}"/>`).join('')}<circle r="${1.4 * k}" fill="${c}"><animateMotion dur="2.4s" repeatCount="indefinite" path="M0 -6 L7 5 L-7 5 Z"/></circle>`,
      awaiting: `<circle class="ac-ping" r="9" ${L}/><circle r="${3.2 * k}" fill="${c}"/>`,
      done: `<path class="ac-draw" d="M-7 0 L-2 5 L8 -6" ${L} stroke-width="2"/>`,
      error: `<path d="M0 -8 L8.5 7 H-8.5 Z" ${L}/><line x1="0" y1="-2" x2="0" y2="2.4" ${L}/><circle cx="0" cy="4.8" r=".9" fill="${c}"/>`,
      sleeping: `<path d="M3 -8 A8 8 0 1 0 8 4 A6 6 0 1 1 3 -8 Z" ${L}/><path class="zz" d="M-9 -9 h3.5 l-3.5 4 h3.5" ${L} stroke-width="1.3"/>`
    }[id];
  }
  function accent(id, c) {
    return `<g transform="translate(118 26)"><circle r="14" fill="${c}" opacity=".08"/>${accentGlyph(id, c)}</g>`;
  }

  /* ---------- 渲染 ---------- */
  function render(id, opt = {}) {
    const st = STATES.find(s => s.id === id);
    const P = typeof opt.palette === 'object' ? opt.palette : PALETTES[opt.palette || 'obsidian'];
    const x = { P, u: 'b' + (++UID), plush: opt.finish === 'plush', metal: opt.finish === 'metal', cute: opt.face === 'cute', lod: opt.lod || 1, flat: opt.view === 'flat' || !!opt.tiny, tiny: !!opt.tiny, mouthPick: opt.mouth, blushPick: opt.blush === 'none' ? null : opt.blush };
    if (opt.blush === 'none') x.blushPick = '';
    x.front = opt.view === 'front' && x.plush; if (opt.view === 'front') x.flat = true; // 正面毛绒：平面的正面构图 + 毛绒
    if (x.flat && !x.front) { x.plush = false; x.metal = false; } // 平面只有一种：纯平、简化
    const color = statusColor(st.cat, opt.palette);
    const compact = !!opt.compact || !!opt.tiny, ac = !!opt.accent && !x.tiny;
    const list = parts(id, x, color, compact || ac).filter(Boolean).join('') + (x.plush && x.furOver ? x.furOver : (x.tiny ? '' : bifangBlush(x))) + (x.mouthPick === 'beak' ? beakOf(x) : x.mouthPick && x.mouthPick !== 'state' && x.mouthPick !== 'none' && !x.tiny ? mouth(x, x.mouthPick, true) : '');
    const wrap = st.wrap === 'hop' && (compact || ac) ? 'f' : st.wrap;
    const vb = x.tiny ? '20 13 80 90' : ac ? '34 6 122 120' : compact ? '9 1 102 107' : '0 0 160 136';
    const shadow = x.flat && !x.front ? '' : false ? `<ellipse cx="60" cy="104" rx="27" ry="2.6" fill="#000" opacity=".07"/>` : `<ellipse cx="60" cy="103.5" rx="30" ry="4.2" fill="url(#sh${x.u})"/>`;
    const inner = compact && !ac ? `${shadow}<g class="${wrap}">${list}</g>` : `<g transform="translate(20 12)">${shadow}<g class="${wrap}">${list}</g>${ac ? accent(id, color) : ''}</g>`;
    const style = opt.noStyle ? '' : `<style>${STYLE}</style>`;
    return `<svg class="bf" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="毕方 · ${st.name}">${style}${defs(x)}${inner}</svg>`;
  }

  root.BF = { STATES, CAT, BOARD, makePalette, PALETTES, BASE, STYLE, render, accentGlyph, statusColor, isDeep, hueOf, hueDist };
  if (typeof module !== 'undefined') module.exports = root.BF;
})(typeof window !== 'undefined' ? window : globalThis);
