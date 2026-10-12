// しっぽり明朝の読み込み用 CSS を作る。
// @fontsource/shippori-mincho の CSS は woff2 と woff の両方を指すため、そのまま読むと
// woff も同梱されて配布物が約2倍になる。woff2 だけを指す @font-face に書き直して出力する。
// 使い方: frontend で `node scripts/gen-font-css.mjs`（@fontsource/shippori-mincho の版を上げたら回し直す）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = resolve(root, 'node_modules/@fontsource/shippori-mincho');
const outFile = resolve(root, 'src/styles/fonts/shippori-mincho.css');
const weights = ['500', '800'];

// 出力先（src/styles/fonts）から node_modules の字体ファイルへの相対パス
const filesPrefix = '../../../node_modules/@fontsource/shippori-mincho/files/';

const version = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')).version;
let out = `/* 自動生成: scripts/gen-font-css.mjs（@fontsource/shippori-mincho ${version}、SIL Open Font License 1.1）。手で書き換えない */\n`;
let count = 0;
for (const weight of weights) {
    const css = readFileSync(resolve(pkgDir, `${weight}.css`), 'utf8');
    const rewritten = css.replace(
        /src:\s*url\(\.\/files\/([^)]+\.woff2)\)\s*format\('woff2'\)\s*,\s*url\([^)]+\.woff\)\s*format\('woff'\);/g,
        (_match, file) => {
            count++;
            return `src: url(${filesPrefix}${file}) format('woff2');`;
        },
    );
    if (/\.woff\)/.test(rewritten)) {
        throw new Error(`woff の指定が残っています（${weight}.css の形式が変わった可能性）`);
    }
    out += rewritten.replace(/\/\*[^*]*\*\/\n/g, '');
}
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out);
console.log(`wrote ${outFile} (${count} faces)`);
