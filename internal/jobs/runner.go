// Package jobs はチャット/再生成ジョブのキュー・状態管理・スケジューリングを担う。
//
// 重要な設計（交換日記 42）:
// ジョブ実行の中身（外部 CLI 呼び出し・セッション操作）は本パッケージに入れない。
// それらは Phase 9 以降（Chat/Session・各 CLI）の管轄。本パッケージは「ジョブを受け取り、
// 2 軸セマフォでスケジュールし、状態を管理し、キャンセルできる」骨格に徹し、
// 実行本体は差し替え可能な Runner インターフェースとして口だけ用意する。
package jobs

import (
	"context"
	"errors"

	"alslime/internal/domain/models"
	"alslime/internal/i18n"
)

// Type はジョブ種別。chat / regenerate / image-generate を実行キューで扱う。
// tag-judge は現状 image-generate 内部で使うが、将来単独ジョブ化できるよう列挙を残す。
type Type string

const (
	TypeChat       Type = "chat"
	TypeRegenerate Type = "regenerate"
	TypeTagJudge   Type = "tag-judge"
	TypeImageGen   Type = "image-generate"
)

// Status はジョブの状態。
type Status string

const (
	StatusPending    Status = "pending"
	StatusProcessing Status = "processing"
	StatusCompleted  Status = "completed"
	StatusError      Status = "error"
	StatusCanceled   Status = "canceled"
)

// IsTerminal は終端状態（completed / error / canceled）かを返す。
func (s Status) IsTerminal() bool {
	return s == StatusCompleted || s == StatusError || s == StatusCanceled
}

// Spec はジョブ投入時の指定。kind は呼び出し側（API/service）が models.KindOf で決めて渡す。
// Queue は kind を信用してスケジュールする（modelId 解釈に依存しない）。
type Spec struct {
	Type      Type
	Kind      models.Kind
	Label     string
	SessionID string
	DedupeKey string
	// Model は表示用のモデルID。投入時点で Job 本体へ確定させる
	// （終端時に Payload を解放しても表示が保てるように）。
	Model string
	// Payload は Runner が実行に使う任意データ（メッセージ・SSRP 設定等）。
	// API レスポンスには出さない（DTO で除外する）。Phase 8 の fake Runner では未使用でよい。
	Payload any
}

// Result は Runner の実行結果。
type Result struct {
	// FinalSessionID は実行後に確定したセッション ID（新規作成時など）。
	FinalSessionID string
	// Output は実行結果本文（chat 応答など）。API 一覧には出さない。
	Output string
	// Model はフロント表示用の使用モデル名。
	Model string
	// SessionTime は完了直後の表示に使う応答時刻メタデータ。
	SessionTime any
	// ActionChoices は行動選択肢（支援者向け。選択肢フック無効時は nil）。
	ActionChoices []string
}

// Runner はジョブ実行本体の差し替え口。
//
// ctx がキャンセルされたら速やかに中断し context.Canceled を返すこと。
// それ以外の失敗は通常の error を返す。
type Runner interface {
	Run(ctx context.Context, job Job) (Result, error)
}

// CompositeRunner はジョブ種別ごとに実行先 Runner を分ける。
type CompositeRunner map[Type]Runner

func (r CompositeRunner) Run(ctx context.Context, job Job) (Result, error) {
	runner, ok := r[job.Type]
	if !ok || runner == nil {
		return Result{}, errors.New(i18n.KeyErrorJobRunnerMissing)
	}
	return runner.Run(ctx, job)
}

// NotImplementedRunner は未接続ジョブ種別用の明示エラー Runner。
//
// 通常の app 配線では chat / regenerate / image-generate に専用 Runner を渡す。
// テストや将来追加ジョブで未接続のまま到達した場合は、握り潰さずエラーにする。
type NotImplementedRunner struct{}

// Run は常にエラーを返す。
func (NotImplementedRunner) Run(ctx context.Context, job Job) (Result, error) {
	return Result{}, errors.New(i18n.KeyErrorJobRunnerNotImplemented)
}
