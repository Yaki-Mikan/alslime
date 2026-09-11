import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getParameterSchema } from '../api/parameters';
import { getRelationshipOptions } from '../api/ssrp';
import { CharacterStatusPanel } from './CharacterStatusPanel';

vi.mock('../api/parameters', () => ({
    getParameterSchema: vi.fn(),
}));

vi.mock('../api/ssrp', () => ({
    getRelationshipOptions: vi.fn(),
}));

const CHAR_PATH = 'characters/雪.md';

describe('左メニューのキャラクター状態欄', () => {
    beforeEach(() => {
        vi.mocked(getParameterSchema).mockResolvedValue(null as never);
        vi.mocked(getRelationshipOptions).mockResolvedValue([]);
    });

    it('キャラ詳細がまだ無いキャラでも編集を始めて保存でき、詳細が新規に作られる', async () => {
        const user = userEvent.setup();
        const onUpdate = vi.fn();
        render(
            <CharacterStatusPanel
                sessionId="session-1"
                backendUrl="http://backend.invalid"
                isSSRP
                characterDetails={null}
                selectedCharacters={[CHAR_PATH]}
                onUpdateCharacterDetails={onUpdate}
                embedded
            />,
        );

        await user.click(screen.getByRole('button', { name: 'キャラクター状態' }));
        await user.click(screen.getByRole('button', { name: '雪の状態' }));
        await user.click(screen.getByTitle('編集'));
        await user.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => expect(onUpdate).toHaveBeenCalled());
        const saved = onUpdate.mock.calls.at(-1)?.[0] as Record<string, { correlations: unknown[] }>;
        expect(saved[CHAR_PATH]).toBeDefined();
        expect(saved[CHAR_PATH].correlations).toEqual([]);
    });

    it('既存の詳細があるキャラは、その内容を基に編集して保存する', async () => {
        const user = userEvent.setup();
        const onUpdate = vi.fn();
        const details = {
            [CHAR_PATH]: { correlations: [{ targetId: 'user', targetName: 'おっさん', relationship: '友人', details: '' }] },
        };
        render(
            <CharacterStatusPanel
                sessionId="session-1"
                backendUrl="http://backend.invalid"
                isSSRP
                characterDetails={details}
                selectedCharacters={[CHAR_PATH]}
                onUpdateCharacterDetails={onUpdate}
                embedded
            />,
        );

        await user.click(screen.getByRole('button', { name: 'キャラクター状態' }));
        await user.click(screen.getByRole('button', { name: '雪の状態' }));
        await user.click(screen.getByTitle('編集'));
        await user.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => expect(onUpdate).toHaveBeenCalled());
        const saved = onUpdate.mock.calls.at(-1)?.[0] as typeof details;
        expect(saved[CHAR_PATH].correlations).toEqual(details[CHAR_PATH].correlations);
    });
});
