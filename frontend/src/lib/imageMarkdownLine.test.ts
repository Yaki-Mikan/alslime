import { describe, expect, it } from 'vitest';
import { parseImageMarkdownLine, splitLinesIntoSegments } from './imageMarkdownLine';

describe('parseImageMarkdownLine', () => {
    it('title 付きの画像記法を受け付ける', () => {
        expect(parseImageMarkdownLine('![C](https://example.com/a/b/表情通常.avif "画像")'))
            .toEqual({ alt: 'C', url: 'https://example.com/a/b/表情通常.avif' });
    });

    it('title 無しと前後空白を受け付ける', () => {
        expect(parseImageMarkdownLine('  ![](http://example.com/x.png)  '))
            .toEqual({ alt: '', url: 'http://example.com/x.png' });
    });

    it('文中に混ざった記法は対象外', () => {
        expect(parseImageMarkdownLine('見て ![C](https://example.com/x.png)')).toBeNull();
        expect(parseImageMarkdownLine('![C](https://example.com/x.png) すごい')).toBeNull();
    });

    it('http / https 以外の URL は対象外', () => {
        expect(parseImageMarkdownLine('![C](data:image/png;base64,AAAA)')).toBeNull();
        expect(parseImageMarkdownLine('![C](javascript:alert(1))')).toBeNull();
        expect(parseImageMarkdownLine('![C](/images/x.png)')).toBeNull();
    });

    it('通常の文章は対象外', () => {
        expect(parseImageMarkdownLine('雪：「おはよう」')).toBeNull();
        expect(parseImageMarkdownLine('')).toBeNull();
    });
});

describe('splitLinesIntoSegments', () => {
    it('画像行が無ければ文章セグメント 1 つ', () => {
        const lines = ['雪：「おはよう」', '', '窓を開けた。'];
        expect(splitLinesIntoSegments(lines)).toEqual([{ kind: 'text', lines }]);
    });

    it('文章／画像／文章に分ける', () => {
        const lines = [
            '雪：「おはよう」',
            '![C](https://example.com/a.avif "画像")',
            '窓を開けた。',
        ];
        expect(splitLinesIntoSegments(lines)).toEqual([
            { kind: 'text', lines: ['雪：「おはよう」'] },
            { kind: 'image', url: 'https://example.com/a.avif', alt: 'C' },
            { kind: 'text', lines: ['窓を開けた。'] },
        ]);
    });

    it('画像の前後の空行だけの塊は吹き出しにしない', () => {
        const lines = ['', '![C](https://example.com/a.avif)', '', '', '![D](https://example.com/b.avif)', ''];
        expect(splitLinesIntoSegments(lines)).toEqual([
            { kind: 'image', url: 'https://example.com/a.avif', alt: 'C' },
            { kind: 'image', url: 'https://example.com/b.avif', alt: 'D' },
        ]);
    });

    it('空行だけの本文は従来どおり文章セグメント 1 つで返す', () => {
        const lines = ['', ''];
        expect(splitLinesIntoSegments(lines)).toEqual([{ kind: 'text', lines }]);
    });
});
