// Package chatjobs defines payloads passed from chat APIs to job runners.
package chatjobs

// Payload is the stable payload contract for chat/regenerate jobs.
type Payload struct {
	Message                 string   `json:"message,omitempty"`
	SessionID               string   `json:"sessionId,omitempty"`
	Model                   string   `json:"model,omitempty"`
	Temperature             *float64 `json:"temperature,omitempty"`
	DirectiveMode           string   `json:"directiveMode,omitempty"`
	SSRPSettings            any      `json:"ssrpSettings,omitempty"`
	AntigravityTempFileMode bool     `json:"antigravityTempFileMode,omitempty"`
	GeminiTempFileMode      bool     `json:"geminiTempFileMode,omitempty"`
}
