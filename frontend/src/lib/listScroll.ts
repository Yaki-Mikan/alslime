/**
 * 選択肢の一覧を、今選んでいる行の位置まで送る。
 *
 * 一覧の中だけを送り、画面全体は動かさない。選んでいる行には data-selected="true" を付け、
 * 一覧の入れ物には position: relative を付けておく（行の位置を一覧の中で測るため）。
 */
export function scrollListToSelected(list: HTMLElement | null): void {
    const item = list?.querySelector<HTMLElement>('[data-selected="true"]');
    if (list && item) list.scrollTop = item.offsetTop - (list.clientHeight - item.offsetHeight) / 2;
}
