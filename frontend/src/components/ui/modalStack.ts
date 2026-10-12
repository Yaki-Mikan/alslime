// 開いている窓（モーダル・横から出る欄）の積み上げ。
// Esc は一番上の窓だけを閉じ、重なり順は開いた順に上へ積む。

type Entry = { id: number; close: () => void };

const stack: Entry[] = [];
let nextId = 1;
let listening = false;

const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || stack.length === 0) return;
    // 入力の変換中（IME）の Esc は変換の取り消しなので窓は閉じない
    if (event.isComposing) return;
    // 窓の中の部品（選択欄の一覧など）が先に Esc を受け止めたときは、その部品だけを閉じる
    if (event.defaultPrevented) return;
    event.preventDefault();
    stack[stack.length - 1].close();
};

const ensureListening = () => {
    if (listening || typeof window === 'undefined') return;
    window.addEventListener('keydown', onKeyDown);
    listening = true;
};

/** 窓を積み上げに加え、重なりの段数（0 始まり）と外す関数を返す。 */
export const pushModal = (close: () => void): { level: number; release: () => void; update: (close: () => void) => void } => {
    ensureListening();
    const entry: Entry = { id: nextId++, close };
    stack.push(entry);
    return {
        level: stack.length - 1,
        release: () => {
            const index = stack.findIndex((e) => e.id === entry.id);
            if (index >= 0) stack.splice(index, 1);
        },
        update: (next) => {
            entry.close = next;
        },
    };
};

/** テスト用：積み上げを空にする。 */
export const resetModalStack = () => {
    stack.splice(0, stack.length);
};
