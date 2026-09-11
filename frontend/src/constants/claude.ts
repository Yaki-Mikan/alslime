export const CLAUDE_EFFORT_VALUES = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ClaudeEffort = typeof CLAUDE_EFFORT_VALUES[number];

export const normalizeClaudeEffort = (value: unknown): ClaudeEffort => (
    typeof value === 'string' && CLAUDE_EFFORT_VALUES.includes(value as ClaudeEffort)
        ? value as ClaudeEffort
        : ''
);

/** 別モデル再生成で選べる effort。CLI 既定（空）は含めず、未保持時は一番低い Low を使う。 */
export const REGENERATE_CLAUDE_EFFORT_VALUES = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type RegenerateClaudeEffort = typeof REGENERATE_CLAUDE_EFFORT_VALUES[number];

export const DEFAULT_REGENERATE_CLAUDE_EFFORT: RegenerateClaudeEffort = 'low';

export const normalizeRegenerateClaudeEffort = (value: unknown): RegenerateClaudeEffort => (
    typeof value === 'string' && (REGENERATE_CLAUDE_EFFORT_VALUES as readonly string[]).includes(value)
        ? value as RegenerateClaudeEffort
        : DEFAULT_REGENERATE_CLAUDE_EFFORT
);
