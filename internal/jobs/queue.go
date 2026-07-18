package jobs

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"alslime/internal/config"
	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	"alslime/internal/process"
)

// retentionDefault は終端ジョブの保持期間（現行 Node 版と同じ 24 時間）。
const retentionDefault = 24 * time.Hour

// Job は 1 ジョブの内部表現。
//
// API レスポンスには Payload / Result を出さない（DTO で除外）。
type Job struct {
	JobID         string
	Type          Type
	Kind          models.Kind
	Label         string
	SessionID     string
	DedupeKey     string
	Status        Status
	Payload       any    // 実行用データ。API には出さない。
	Result        string // 実行結果本文。API 一覧には出さない。
	Model         string
	SessionTime   any
	ActionChoices []string // 行動選択肢（支援者向け）。API 一覧には出さない。
	Err           string   // 表示用の短いエラーメッセージ。
	CreatedAt     int64    // Unix ミリ秒
	StartedAt     int64
	UpdatedAt     int64

	cancel context.CancelFunc // processing 中のみ非 nil。cancel 要求に使う。
}

// AddResult は Add の戻り。重複時は既存 jobID を返す。
type AddResult struct {
	Duplicate     bool
	JobID         string
	ExistingJobID string
}

// Queue はジョブのキュー・状態管理・スケジューラ。
type Queue struct {
	mu        sync.Mutex
	jobs      map[string]*Job
	proc      *process.Manager
	runner    Runner
	retention time.Duration
	newID     func() string // テスト差し替え用の ID 生成。
	now       func() time.Time
}

// NewQueue は Queue を生成する。proc は 2 軸セマフォ、runner は実行本体。
func NewQueue(proc *process.Manager, runner Runner, newID func() string) *Queue {
	return &Queue{
		jobs:      make(map[string]*Job),
		proc:      proc,
		runner:    runner,
		retention: retentionDefault,
		newID:     newID,
		now:       time.Now,
	}
}

// Add はジョブを投入する。
//
// 同 sessionID の pending/processing ジョブがあれば重複として既存 jobID を返す
// （sessionID が空のジョブは重複判定しない）。投入後スケジューラを起動する。
func (q *Queue) Add(spec Spec) AddResult {
	q.mu.Lock()
	if spec.DedupeKey != "" {
		if existing := q.activeByDedupeKeyLocked(spec.DedupeKey); existing != nil {
			id := existing.JobID
			q.mu.Unlock()
			return AddResult{Duplicate: true, ExistingJobID: id}
		}
	} else if spec.SessionID != "" {
		if existing := q.activeBySessionLocked(spec.SessionID); existing != nil {
			id := existing.JobID
			q.mu.Unlock()
			return AddResult{Duplicate: true, ExistingJobID: id}
		}
	}
	// ジョブ投入を自然なトリガーとして、保持期限切れの終端ジョブを掃除する
	// （定期掃除 RunCleanup と併用の二段構え。走査は件数が小さく軽量）。
	q.cleanupLocked(q.now())
	nowMs := q.now().UnixMilli()
	job := &Job{
		JobID:     q.newID(),
		Type:      spec.Type,
		Kind:      spec.Kind,
		Label:     spec.Label,
		SessionID: spec.SessionID,
		DedupeKey: spec.DedupeKey,
		Status:    StatusPending,
		Model:     spec.Model,
		Payload:   spec.Payload,
		CreatedAt: nowMs,
		UpdatedAt: nowMs,
	}
	q.jobs[job.JobID] = job
	id := job.JobID
	q.mu.Unlock()

	q.schedule()
	return AddResult{JobID: id}
}

// Get は jobID のジョブのスナップショット（コピー）を返す。Phase 9 の status handler 用。
func (q *Queue) Get(jobID string) (Job, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	j, ok := q.jobs[jobID]
	if !ok {
		return Job{}, false
	}
	return *j, true
}

// ActiveBySessionID は sessionID に紐づく pending/processing ジョブを返す。
// session resume API が activeJobId を返すための参照口。内部 Job のコピーのみ返す。
func (q *Queue) ActiveBySessionID(sessionID string) (Job, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if sessionID == "" {
		return Job{}, false
	}
	j := q.activeBySessionLocked(sessionID)
	if j == nil {
		return Job{}, false
	}
	return *j, true
}

// List は全ジョブのスナップショットを createdAt 降順で返す。
func (q *Queue) List() []Job {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]Job, 0, len(q.jobs))
	for _, j := range q.jobs {
		out = append(out, *j)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out
}

// Cancel は pending/processing ジョブをキャンセルする。
//
// pending は即 canceled。processing は context cancel を呼んで中断要求し canceled にする
// （Runner 側が context.Canceled を返すことで終端化と整合する）。
// 終端状態・不存在は false（handler は 409 へ）。
func (q *Queue) Cancel(jobID string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	j, ok := q.jobs[jobID]
	if !ok || j.Status.IsTerminal() {
		return false
	}
	if j.Status == StatusProcessing && j.cancel != nil {
		j.cancel()
	}
	j.Status = StatusCanceled
	j.Err = i18n.KeyJobCanceledByUser
	j.Payload = nil
	j.UpdatedAt = q.now().UnixMilli()
	return true
}

// CancelProcessing は処理中ジョブへ中断要求を出す。
// /api/abort 用。pending は消さず、現に走っているものだけを止める。
func (q *Queue) CancelProcessing() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	count := 0
	nowMs := q.now().UnixMilli()
	for _, j := range q.jobs {
		if j.Status != StatusProcessing {
			continue
		}
		if j.cancel != nil {
			j.cancel()
		}
		j.Status = StatusCanceled
		j.Err = i18n.KeyJobCanceledByUser
		j.Payload = nil
		j.UpdatedAt = nowMs
		count++
	}
	return count
}

// Cleanup は終端から retention を過ぎたジョブを削除する。
func (q *Queue) Cleanup(now time.Time) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.cleanupLocked(now)
}

func (q *Queue) cleanupLocked(now time.Time) {
	cutoff := now.Add(-q.retention).UnixMilli()
	for id, j := range q.jobs {
		if j.Status.IsTerminal() && j.UpdatedAt < cutoff {
			delete(q.jobs, id)
		}
	}
}

// RunCleanup は保持期限切れ終端ジョブの定期削除を ctx 停止まで繰り返す。
//
// ジョブ投入時の掃除（Add）だけだと、最後の投入から retention 経過後に
// 一度も投入が無いケースで終端ジョブ（AI応答全文を含む）が残り続けるため、
// サーバーライフサイクルに紐づく定期実行を併設する（housekeeping と同じ間隔）。
func (q *Queue) RunCleanup(ctx context.Context) {
	interval := time.Duration(config.HousekeepingIntervalSeconds) * time.Second
	if interval <= 0 {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			q.Cleanup(q.now())
		}
	}
}

// schedule は実行可能な pending を探して起動する（FIFO + 種別追い越し）。
//
// 燈レビュー42 のフロー厳守:
//  1. lock して実行できる pending を探し、acquire できたものを processing にして context を保存。
//  2. lock を外す。
//  3. goroutine で Runner 実行。
//  4. 完了時に lock して状態更新 → release → 再スケジュール。
//
// ロックを持ったまま Runner を呼ばない。
func (q *Queue) schedule() {
	for {
		started := q.pickAndStart()
		if started == nil {
			return
		}
		q.run(started)
	}
}

type startedJob struct {
	jobID string
	kind  models.Kind
	job   Job
	ctx   context.Context
}

// pickAndStart は起動可能な pending を 1 件だけ processing にして返す（ロック内で完結）。
// 起動できるものが無ければ nil。
func (q *Queue) pickAndStart() *startedJob {
	q.mu.Lock()
	defer q.mu.Unlock()

	pending := make([]*Job, 0)
	for _, j := range q.jobs {
		if j.Status == StatusPending {
			pending = append(pending, j)
		}
	}
	sort.Slice(pending, func(i, j int) bool { return pending[i].CreatedAt < pending[j].CreatedAt })

	for _, job := range pending {
		if q.proc.TryAcquire(job.Kind) {
			ctx, cancel := context.WithCancel(context.Background())
			job.Status = StatusProcessing
			job.StartedAt = q.now().UnixMilli()
			job.UpdatedAt = job.StartedAt
			job.cancel = cancel
			snapshot := *job
			snapshot.cancel = nil
			return &startedJob{jobID: job.JobID, kind: job.Kind, job: snapshot, ctx: ctx}
		}
		// global 満杯なら以降の pending も起動できないので打ち切り。
		if !q.proc.GlobalAvailable() {
			break
		}
		// 種別のみ満杯 → 追い越して次の pending へ。
	}
	return nil
}

// run は job を goroutine で実行し、完了後に状態更新・release・再スケジュールする。
//
// defer は LIFO のため、登録順「schedule → release」で実行順は「release → schedule」になる。
// これにより「release は必ず defer」かつ「解放後に次をスケジュール」を両立し、
// Runner が panic しても release 漏れしない（過剰解放にならないよう release は 1 回だけ）。
func (q *Queue) run(started *startedJob) {
	go func() {
		defer q.schedule()
		defer q.proc.Release(started.kind)

		var result Result
		var err error
		func() {
			defer func() {
				if r := recover(); r != nil {
					err = fmt.Errorf("job runner panic: %v", r)
				}
			}()
			result, err = q.runner.Run(started.ctx, started.job)
		}()

		q.mu.Lock()
		job, ok := q.jobs[started.jobID]
		if !ok {
			q.mu.Unlock()
			return
		}
		// 既に Cancel 済み（canceled）なら結果で上書きしない。
		if job.Status == StatusProcessing {
			switch {
			case errors.Is(err, context.Canceled):
				job.Status = StatusCanceled
				job.Err = i18n.KeyJobCanceledByUser
			case err != nil:
				job.Status = StatusError
				job.Err = err.Error()
			default:
				job.Status = StatusCompleted
				job.Result = result.Output
				if result.Model != "" {
					job.Model = result.Model
				}
				job.SessionTime = result.SessionTime
				job.ActionChoices = result.ActionChoices
				if result.FinalSessionID != "" {
					job.SessionID = result.FinalSessionID
				}
			}
		}
		job.cancel = nil
		// 終端後の Payload（メッセージ本文・SSRP設定）は保持しない。
		// 表示に必要な値は Model / Result / SessionTime へ確定済み。
		// Runner はコピー（started.job）を参照するため実行中参照とも競合しない。
		job.Payload = nil
		job.UpdatedAt = q.now().UnixMilli()
		q.mu.Unlock()
	}()
}

// activeBySessionLocked は sessionID の pending/processing ジョブを返す（ロック前提）。
func (q *Queue) activeBySessionLocked(sessionID string) *Job {
	for _, j := range q.jobs {
		if j.SessionID == sessionID && (j.Status == StatusPending || j.Status == StatusProcessing) {
			return j
		}
	}
	return nil
}

func (q *Queue) activeByDedupeKeyLocked(key string) *Job {
	for _, j := range q.jobs {
		if j.DedupeKey == key && (j.Status == StatusPending || j.Status == StatusProcessing) {
			return j
		}
	}
	return nil
}
