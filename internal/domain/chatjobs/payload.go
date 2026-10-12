// Package chatjobs defines payloads passed from chat APIs to job runners.
package chatjobs

// Payload is the stable payload contract for chat/regenerate jobs.
type Payload struct {
	Message                   string   `json:"message,omitempty"`
	SessionID                 string   `json:"sessionId,omitempty"`
	Model                     string   `json:"model,omitempty"`
	Temperature               *float64 `json:"temperature,omitempty"`
	DirectiveMode             string   `json:"directiveMode,omitempty"`
	SSRPSettings              any      `json:"ssrpSettings,omitempty"`
	AntigravityTempFileMode   bool     `json:"antigravityTempFileMode,omitempty"`
	GeminiTempFileMode        bool     `json:"geminiTempFileMode,omitempty"`
	ClaudeEffort              string   `json:"claudeEffort,omitempty"`
	AntigravityThinking       string   `json:"antigravityThinking,omitempty"`
	AntigravityMaxStreamCalls int      `json:"antigravityMaxStreamCalls,omitempty"`
	// ResponseTimeoutMinutes は画面で指定した応答の待ち時間（分）。0 以下は未指定。
	ResponseTimeoutMinutes int  `json:"responseTimeoutMinutes,omitempty"`
	EnableResponseBackup   bool `json:"enableResponseBackup,omitempty"`
}
