package appearanceprompt

import (
	"time"

	"alslime/internal/domain/appearancejobs"
)

// appearance-prompt API の route 断片。
const (
	routeSubmit = "/appearance-prompt/submit"
	routeStatus = "/appearance-prompt/status/{jobId}"
	routeCancel = "/appearance-prompt/cancel/{jobId}"

	pathParamJobID = "jobId"
)

// currentFieldMaxRunes は画面の現在欄（キャラクタープロンプト・身体的特徴）の入力上限。
const currentFieldMaxRunes = 20000

// modelMaxRunes はモデル ID の入力上限。
const modelMaxRunes = 200

type submitRequest struct {
	DirName                 string `json:"dirName"`
	FileName                string `json:"fileName"`
	Provider                string `json:"provider"`
	Model                   string `json:"model"`
	ClaudeEffort            string `json:"claudeEffort"`
	AntigravityThinking     string `json:"antigravityThinking"`
	TimeoutMinutes          int    `json:"timeoutMinutes"`
	Locale                  string `json:"locale"`
	CurrentCharacterPrompt  string `json:"currentCharacterPrompt"`
	CurrentPhysicalFeatures string `json:"currentPhysicalFeatures"`
}

type submitResponse struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

type duplicateResponse struct {
	Error         string `json:"error"`
	MessageKey    string `json:"messageKey"`
	ExistingJobID string `json:"existingJobId"`
}

type statusResponse struct {
	JobID          string                 `json:"jobId"`
	Status         string                 `json:"status"`
	ElapsedSeconds int64                  `json:"elapsedSeconds"`
	Result         *appearancejobs.Result `json:"result,omitempty"`
	Error          string                 `json:"error,omitempty"`
}

func nowUnixMilli() int64 {
	return time.Now().UnixMilli()
}
