import { render } from '@testing-library/react';
import { expect, it } from 'vitest';
import { IdentityOutputPreview } from './IdentityOutputPreview';

it.each(['', '\\', '\\\\'])('名前と作品名の括弧を出力先ごとに変換する（入力のエスケープ=%s）', (escape) => {
    const { container } = render(<IdentityOutputPreview
        backendUrl=""
        active={false}
        danbooruTagFormat="anima"
        characterName={`some name ${escape}(character${escape})`}
        workName={`work_name ${escape}(series${escape})`}
    />);
    const outputs = Array.from(container.querySelectorAll('code'), element => element.textContent);
    expect(outputs).toEqual([
        String.raw`some name \(character\), work name \(series\)`,
        'some name (character), work name (series)',
    ]);
});
