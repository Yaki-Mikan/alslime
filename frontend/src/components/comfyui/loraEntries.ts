/**
 * LoRA 指定リストの編集用整形。
 *
 * 編集画面では「名前が空の行」を次のLoRAを選ぶための選択欄として使う。
 * 保存時に空行は除外されるため、読込・選択・削除のたびに末尾へ空行を補い、
 * 何件登録しても常に次のLoRAを選べる状態を保つ。
 */

export interface LoraEntryLike {
    name: string;
    strengthModel: number;
    strengthClip: number;
}

export const createEmptyLoraEntry = <T extends LoraEntryLike = LoraEntryLike>(): T =>
    ({ name: '', strengthModel: 1.0, strengthClip: 1.0 }) as T;

// 末尾が名前付きLoRA（または0件）なら空の選択欄を1つ足して返す。
export const withTrailingEmptyLora = <T extends LoraEntryLike>(lora: T[] | undefined | null): T[] => {
    const list = lora ? [...lora] : [];
    if (list.length === 0 || list[list.length - 1].name) {
        list.push(createEmptyLoraEntry<T>());
    }
    return list;
};
