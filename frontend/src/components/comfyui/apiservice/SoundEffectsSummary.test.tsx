import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GENERATE_TEST } from '../constants';
import { SoundEffectsSummary } from './SoundEffectsSummary';

describe('SoundEffectsSummary の種別ごとの表示', () => {
    it('指定あり：生成へ指定した効果音の一覧を出す', () => {
        render(<SoundEffectsSummary status="specified" soundEffects={[{ text: 'どんっ', style: 'bold text' }, { text: 'ざあざあ' }]} />);
        expect(screen.getByText(GENERATE_TEST.LABELS.SOUND_EFFECTS)).toBeTruthy();
        expect(screen.getByText('どんっ')).toBeTruthy();
        expect(screen.getByText('ざあざあ')).toBeTruthy();
        expect(screen.getByText(/bold text/)).toBeTruthy();
    });

    it('不要と判定：その旨を出す', () => {
        render(<SoundEffectsSummary status="notNeeded" />);
        expect(screen.getByText(GENERATE_TEST.MESSAGES.SOUND_EFFECTS_NOT_NEEDED)).toBeTruthy();
    });

    it('判定結果を採用できず：その旨を出す', () => {
        render(<SoundEffectsSummary status="rejected" />);
        expect(screen.getByText(GENERATE_TEST.MESSAGES.SOUND_EFFECTS_REJECTED)).toBeTruthy();
    });

    it('判定なし・古い画像：何も出さない', () => {
        const { container } = render(<SoundEffectsSummary />);
        expect(container.firstChild).toBeNull();
        expect(screen.queryByTestId('sound-effects-summary')).toBeNull();
    });
});
