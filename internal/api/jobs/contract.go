package jobs

import "alslime/internal/i18n"

// jobs API の route 断片。
// config.APIPrefix と組み合わせて登録し、handler に URL を直書きしない。
const (
	routeJobs      = "/jobs"
	routeJobCancel = "/jobs/{jobId}/cancel"
	routeJobLimits = "/jobs/limits"
	pathParamJobID = "jobId"
)

// globalSettingsKey は limits を保存するグローバル設定のキー。
const globalSettingsKey = "aiProcessLimits"

// jobs API が返す利用者向けエラーの i18n キー。
const (
	errKeyJobCancelUnavailable = i18n.KeyErrorJobCancelUnavailable
	errKeyInvalidJSONBody      = i18n.KeyErrorInvalidJSONBody
	errKeyInvalidProcessLimit  = i18n.KeyErrorInvalidProcessLimit
)

// cancelResponse はジョブキャンセル成功レスポンス。
type cancelResponse struct {
	Success bool   `json:"success"`
	JobID   string `json:"jobId"`
}
