/**
 * ttsPlayer.ts - 読み上げ音声の逐次再生コントローラ（疑似ストリーミング再生）
 *
 * 完成チャンクの URL を受信順に enqueue し、次の規則で再生する（要件9.2 / 9.1）。
 * - 再生開始チャンク数（startCount）だけ溜まってから再生を開始する（途切れ対策バッファ）
 * - チャンク間にはフロント側で silenceSeconds の間を空ける
 *   （結合音声のサーバー側無音挿入と同じ設定値を使う）
 * - finish() 後にキューが尽きたら onEnded を呼ぶ
 * - stop() で再生を即時停止し、未再生キューを破棄する（キャンセル。要件9.3）
 */

export interface TTSPlayerOptions {
    silenceSeconds: number;
    startCount: number;
    volume: number;
    onEnded?: () => void;
    onError?: (error: unknown) => void;
    // ownsUrls が真なら enqueue された objectURL はこのコントローラが所有し、
    // 再生終了・停止時に revoke する（使い捨てチャンク用。共有キャッシュのURLには使わない）。
    ownsUrls?: boolean;
}

export class TTSPlaybackController {
    private opts: TTSPlayerOptions;
    private queue: string[] = [];
    private audio: HTMLAudioElement | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private playing = false;
    private started = false;
    private finished = false;
    private stopped = false;

    constructor(opts: TTSPlayerOptions) {
        this.opts = opts;
    }

    // enqueue は完成チャンクの再生URL（objectURL 解決済み）を追加する。
    enqueue(url: string): void {
        if (this.stopped) return;
        this.queue.push(url);
        if (!this.started && this.queue.length >= Math.max(1, this.opts.startCount)) {
            this.started = true;
            void this.playNext(false);
        } else if (this.started && !this.playing) {
            // バッファ切れで待機中に次チャンクが届いた場合は再開する。
            void this.playNext(true);
        }
    }

    // finish は「以降チャンクは来ない」印。未開始ならバッファ数未満でも再生を始める。
    finish(): void {
        if (this.stopped) return;
        this.finished = true;
        if (!this.started && this.queue.length > 0) {
            this.started = true;
            void this.playNext(false);
        } else if (!this.playing && this.queue.length === 0) {
            this.opts.onEnded?.();
        }
    }

    // stop は再生を即時停止し、未再生キューを破棄する（onEnded は呼ばない）。
    stop(): void {
        this.stopped = true;
        const pending = this.queue;
        this.queue = [];
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.audio) {
            const current = this.audio.src;
            this.audio.pause();
            this.audio.src = '';
            this.audio = null;
            this.release(current);
        }
        for (const url of pending) this.release(url);
        this.playing = false;
    }

    // release は所有する objectURL を解放する（ownsUrls が偽なら何もしない）。
    private release(url: string): void {
        if (!this.opts.ownsUrls || !url) return;
        URL.revokeObjectURL(url);
    }

    private async playNext(withGap: boolean): Promise<void> {
        if (this.stopped) return;
        const url = this.queue.shift();
        if (url === undefined) {
            this.playing = false;
            if (this.finished) this.opts.onEnded?.();
            return;
        }
        this.playing = true;
        if (withGap && this.opts.silenceSeconds > 0) {
            await new Promise<void>(resolve => {
                this.timer = setTimeout(resolve, this.opts.silenceSeconds * 1000);
            });
            this.timer = null;
            if (this.stopped) return;
        }
        const audio = new Audio(url);
        audio.volume = Math.min(1, Math.max(0, this.opts.volume));
        this.audio = audio;
        audio.onended = () => {
            if (this.stopped) return;
            this.release(url);
            void this.playNext(true);
        };
        audio.onerror = event => {
            if (this.stopped) return;
            this.release(url);
            this.opts.onError?.(event);
            void this.playNext(true);
        };
        try {
            await audio.play();
        } catch (error) {
            if (!this.stopped) {
                this.release(url);
                this.opts.onError?.(error);
                void this.playNext(true);
            }
        }
    }
}
