import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { COMPOSER_ICON, readMacosFallback } from './macos-icon-assets.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const SOURCE_DIR = path.join(ROOT_DIR, 'assets', 'brand', 'source');
const SOURCE_SVG = path.join(ROOT_DIR, 'design-system/packages/ui/src/brand/assets/openbitfun-mark.svg');
const SOURCE_APP_MARK = path.join(ROOT_DIR, 'design-system/packages/ui/src/brand/assets/openbitfun-app-mark.png');
const SOURCE_MARKS = {
  dark: path.join(SOURCE_DIR, 'openbitfun-mark-dark.png'),
  light: path.join(SOURCE_DIR, 'openbitfun-mark-light.png'),
};

const BRAND_SIZE = 512;
const APP_ICON_SIZE = 1024;
const APP_ICON_CORNER_RADIUS = 96;
const APP_MARK_LIFT = 28;


const DESKTOP_HICOLOR_SIZES = [16, 32, 48, 64, 96, 128, 256, 512];
const EXPORT_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 256, 512, 1024, 2048];

const LEGACY_APPLICATION_ASSETS = [
  'src/apps/desktop/icons/Logo-ICON.png',
  'src/apps/desktop/icons/icon.png',
  'src/apps/desktop/icons/icon.ico',
  'src/apps/desktop/icons/icon.icns',
  'src/apps/desktop/icons/openbitfun-tray-template.png',
  'src/apps/desktop/icons/Square30x30Logo.png',
  'src/apps/desktop/icons/Square44x44Logo.png',
  'src/apps/desktop/icons/Square71x71Logo.png',
  'src/apps/desktop/icons/Square89x89Logo.png',
  'src/apps/desktop/icons/Square107x107Logo.png',
  'src/apps/desktop/icons/Square142x142Logo.png',
  'src/apps/desktop/icons/Square150x150Logo.png',
  'src/apps/desktop/icons/Square284x284Logo.png',
  'src/apps/desktop/icons/Square310x310Logo.png',
  'src/apps/desktop/icons/StoreLogo.png',
  'src/apps/relay-server/static/assets/Logo-ICON-BOaKcXgO.png',
];

const outputPath = (...segments) => path.join(ROOT_DIR, ...segments);

async function writePng(filePath, buffer) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

function createReusableWebMark(svg) {
  const reusableMark = svg.replaceAll('stroke="black"', 'stroke="currentColor"');
  if (!reusableMark.includes('stroke="currentColor"')) {
    throw new Error('OpenBitFun mark source is missing its canonical inherited-color strokes');
  }
  return reusableMark;
}

async function normalizePng(input) {
  return sharp(input)
    .ensureAlpha()
    .resize({ width: BRAND_SIZE, height: BRAND_SIZE, fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function renderMark(svg, size, tone, opticalSize = size) {
  // At favicon sizes, fifteen subpixel strokes disappear. Keep the same
  // silhouette with fewer filaments. The opaque outer rim must survive
  // antialiasing independently of the decorative interior strokes.
  const indices = opticalSize <= 24 ? [0, 7, 14]
    : opticalSize <= 48 ? [0, 3, 7, 11, 14]
      : opticalSize <= 96 ? [0, 2, 4, 7, 10, 12, 14] : null;
  let index = 0;
  const reusableMark = createReusableWebMark(svg);
  const artwork = indices ? reusableMark.replace(/<path\b[^>]*\/>/g, element => {
    const contour = index++;
    if (!indices.includes(contour)) return '';
    const outer = contour === 14;
    const inner = contour === 0;
    const width = Math.max(outer ? 3.2 : inner ? 1.2 : 0.7,
      (outer ? 1.35 : inner ? 0.85 : 0.65) * 256 / opticalSize);
    return element.replace(/ (?:stroke-width|opacity)="[^"]*"/g, '')
      .replace('/>', ` stroke-width="${width}" opacity="${outer ? 1 : inner ? 0.9 : 0.75}"/>`);
  }) : reusableMark;
  return sharp(Buffer.from(artwork.replaceAll('currentColor', tone)), { density: 144 })
    .resize(size, size)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function resizePng(input, size) {
  return sharp(input)
    .resize({ width: size, height: size, fit: 'contain', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function createApplicationMark(lightMark) {
  const { data, info } = await sharp(lightMark)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const whiteMark = Buffer.alloc(data.length);

  for (let index = 0; index < data.length; index += channels) {
    const sourceTone = data[index];
    const liftedTone = Math.min(255, sourceTone + APP_MARK_LIFT);
    whiteMark[index] = liftedTone;
    whiteMark[index + 1] = liftedTone;
    whiteMark[index + 2] = liftedTone;
    whiteMark[index + 3] = data[index + 3];
  }

  return sharp(whiteMark, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

async function createApplicationIcon(applicationMark) {
  const { width: size } = await sharp(applicationMark).metadata();
  const cornerRadius = APP_ICON_CORNER_RADIUS * size / BRAND_SIZE;
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" rx="${cornerRadius}" fill="#000000"/>` +
    '</svg>',
  );

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: background },
      { input: applicationMark },
    ])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}


const WINDOWS_ICO_SIZES = [16, 24, 32, 48, 64, 256];

async function generateWindowsIcon(renderIcon) {
  // Encode a standard multi-resolution PNG-in-ICO container directly without
  // shelling out to `@tauri-apps/cli icon`.
  const icoFrames = await Promise.all(WINDOWS_ICO_SIZES.map(size => renderIcon(size)));
  const icoDirectory = Buffer.alloc(6 + WINDOWS_ICO_SIZES.length * 16);
  icoDirectory.writeUInt16LE(0, 0); // reserved
  icoDirectory.writeUInt16LE(1, 2); // image type: ICO
  icoDirectory.writeUInt16LE(WINDOWS_ICO_SIZES.length, 4);

  let icoOffset = icoDirectory.length;
  for (let index = 0; index < WINDOWS_ICO_SIZES.length; index++) {
    const size = WINDOWS_ICO_SIZES[index];
    const png = icoFrames[index];
    const entry = 6 + index * 16;
    const dim = size >= 256 ? 0 : size;
    icoDirectory[entry] = dim;
    icoDirectory[entry + 1] = dim;
    icoDirectory[entry + 2] = 0; // color palette count
    icoDirectory[entry + 3] = 0; // reserved
    icoDirectory.writeUInt16LE(0, entry + 4); // color planes (0 for PNG frames)
    icoDirectory.writeUInt16LE(32, entry + 6); // bits per pixel
    icoDirectory.writeUInt32LE(png.length, entry + 8);
    icoDirectory.writeUInt32LE(icoOffset, entry + 12);
    icoOffset += png.length;
  }

  return Buffer.concat([icoDirectory, ...icoFrames]);
}

async function removeLegacyApplicationAssets() {
  await Promise.all(
    LEGACY_APPLICATION_ASSETS.map(relativePath =>
      rm(outputPath(...relativePath.split('/')), { recursive: true, force: true })),
  );
}

async function generateBrandAssets() {
  const applicationMark = await createApplicationMark(await normalizePng(SOURCE_APP_MARK));
  await writePng(path.join(COMPOSER_ICON, 'Assets/Mark.png'), await resizePng(applicationMark, APP_ICON_SIZE));
  if (process.argv.includes('--macos-source-only')) return;
  const macosFallback = readMacosFallback();
  const svg = await readFile(SOURCE_SVG, 'utf8');
  const [darkMark, lightMark] = await Promise.all([
    renderMark(svg, BRAND_SIZE, '#202020'),
    renderMark(svg, BRAND_SIZE, '#e8e8e8'),
  ]);
  await writePng(SOURCE_MARKS.dark, darkMark);
  await writePng(SOURCE_MARKS.light, lightMark);
  const applicationIcon = await createApplicationIcon(applicationMark);
  const applicationIconLarge = await resizePng(applicationIcon, APP_ICON_SIZE);
  const darkMarkSmall = await renderMark(svg, 128, '#202020');
  const iconCache = new Map([
    [BRAND_SIZE, Promise.resolve(applicationIcon)],
    [APP_ICON_SIZE, Promise.resolve(applicationIconLarge)],
  ]);
  const renderIcon = size => {
    if (!iconCache.has(size)) {
      iconCache.set(size, resizePng(applicationIcon, size));
    }
    return iconCache.get(size);
  };
  const windowsIcon = await generateWindowsIcon(renderIcon);

  const exportDir = outputPath('assets', 'brand', 'exports');
  await mkdir(exportDir, { recursive: true });
  await copyFile(SOURCE_SVG, path.join(exportDir, 'openbitfun-mark.svg'));
  const legacySourceDir = outputPath('assets', 'brand', 'source');
  await mkdir(legacySourceDir, { recursive: true });
  await copyFile(SOURCE_SVG, path.join(legacySourceDir, 'openbitfun-mark.svg'));
  await copyFile(SOURCE_APP_MARK, path.join(legacySourceDir, 'openbitfun-app-mark.png'));
  const componentAssetDir = outputPath('design-system', 'packages', 'ui', 'src', 'brand', 'assets');
  await mkdir(componentAssetDir, { recursive: true });
  await Promise.all([
    ...[16, 32, 128, 256, 512].map(async size => {
      await writePng(path.join(componentAssetDir, `openbitfun-app-icon-${size}.png`), await renderIcon(size));
    }),
    ...EXPORT_SIZES.map(async size => {
      const [dark, light, appIcon] = await Promise.all([
        renderMark(svg, size, '#202020'),
        renderMark(svg, size, '#e8e8e8'),
        renderIcon(size),
      ]);
      await Promise.all([
        writePng(path.join(exportDir, `openbitfun-mark-dark-${size}.png`), dark),
        writePng(path.join(exportDir, `openbitfun-mark-light-${size}.png`), light),
        writePng(path.join(exportDir, `openbitfun-app-icon-${size}.png`), appIcon),
      ]);
    }),
  ]);
  await writeFile(path.join(exportDir, 'openbitfun-app-icon.ico'), windowsIcon);
  await writeFile(path.join(exportDir, 'openbitfun-app-icon.icns'), macosFallback);

  await writePng(outputPath('src', 'miniapp-market-web', 'public', 'assets', 'openbitfun-email-mark.png'), darkMarkSmall);

  await writePng(outputPath('src', 'miniapp-market-web', 'public', 'assets', 'openbitfun-email-app-icon.png'), applicationIcon);

  await writePng(outputPath('src', 'crates', 'services', 'miniapp-market-service', 'src', 'email', 'app-icon.png'), applicationIcon);

  const desktopIconDir = outputPath('src', 'apps', 'desktop', 'icons');
  await writePng(path.join(desktopIconDir, 'openbitfun-app-icon.png'), applicationIconLarge);
  await writePng(path.join(desktopIconDir, 'openbitfun-app-icon.ico'), windowsIcon);
  await writePng(path.join(desktopIconDir, 'openbitfun-app-icon.icns'), macosFallback);
  for (const size of DESKTOP_HICOLOR_SIZES) {
    const icon = await renderIcon(size);
    await writePng(
      outputPath('src', 'apps', 'desktop', 'icons', 'hicolor', `${size}x${size}`, 'apps', 'openbitfun-desktop.png'),
      icon,
    );
  }

  const relayBrandDir = outputPath('src', 'apps', 'relay-server', 'static', 'brand');
  await writePng(path.join(relayBrandDir, 'openbitfun-app-icon.png'), applicationIcon);
  for (const size of [16, 32]) {
    await writePng(path.join(relayBrandDir, `openbitfun-app-icon-${size}.png`), await renderIcon(size));
  }

  await removeLegacyApplicationAssets();

  console.log('Generated OpenBitFun application brand assets.');
}

await generateBrandAssets();
