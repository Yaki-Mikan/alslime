export const CLAUDE_EFFORT_VALUES = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type ClaudeEffort = typeof CLAUDE_EFFORT_VALUES[number];

export const normalizeClaudeEffort = (value: unknown): ClaudeEffort => (
    typeof value === 'string' && CLAUDE_EFFORT_VALUES.includes(value as ClaudeEffort)
        ? value as ClaudeEffort
        : ''
);
