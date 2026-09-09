import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SessionTimePanel } from './SessionTimePanel';
import type { DateTimeSettingsState } from '../types/datetime';

// 会話が進む前のセッション（currentSessionTime が無い）を想定した設定
const settingsWithoutSessionTime: DateTimeSettingsState = {
    enabled: true,
    mode: 'fixed',
    fixedDateTime: { year: 2000, month: 9, day: 8, hour: 10, minute: 0, second: 0 },
    useTodayDate: false,
    increment: { enabled: false, detailMode: false, values: { hours: 0, minutes: 0 } },
};

describe('左メニューのセッション時刻パネル', () => {
    it('現在のセッション時刻が無くても、編集した値が反映される', async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(<SessionTimePanel dateTimeSettings={settingsWithoutSessionTime} onChange={onChange} embedded />);

        await user.click(screen.getByRole('button', { name: '時刻' }));
        await user.click(screen.getByTitle('編集'));

        // 年の select（表示値は固定日時の年）
        await user.selectOptions(screen.getByDisplayValue('2000'), '2030');

        await waitFor(() => expect(onChange).toHaveBeenCalled(), { timeout: 2000 });
        const next = onChange.mock.calls.at(-1)?.[0] as DateTimeSettingsState;
        expect(next.currentSessionTime).toEqual({ year: 2030, month: 9, day: 8, hour: 10, minute: 0, second: 0 });
        // 他の項目は保たれる
        expect(next.fixedDateTime).toEqual(settingsWithoutSessionTime.fixedDateTime);
        expect(next.increment).toEqual(settingsWithoutSessionTime.increment);
    });
});
