package jobs

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"alslime/internal/domain/models"
	"alslime/internal/process"
)

// fakeRunner はテスト用 Runner。各ジョブの完了をチャネルで制御する。
type fakeRunner struct {
	mu      sync.Mutex
	gates   map[string]chan runResult // jobID -> 完了シグナル
	started chan string               // 実行開始通知
}

type runResult struct {
	output string
	err    error
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{
		gates:   make(map[string]chan runResult),
		started: make(chan string, 64),
	}
}

func (f *fakeRunner) gate(jobID string) chan runResult {
	f.mu.Lock()
	defer f.mu.Unlock()
	g, ok := f.gates[jobID]
	if !ok {
		g = make(chan runResult, 1)
		f.gates[jobID] = g
	}
	return g
}

func (f *fakeRunner) Run(ctx context.Context, job Job) (Result, error) {
	f.started <- job.JobID
	select {
	case r := <-f.gate(job.JobID):
		return Result{Output: r.output}, r.err
	case <-ctx.Done():
		return Result{}, ctx.Err()
	}
}

// complete はジョブを正常完了させる。
func (f *fakeRunner) complete(jobID, output string) {
	f.gate(jobID) <- runResult{output: output}
}

// fail はジョブを通常エラーで終わらせる。
func (f *fakeRunner) fail(jobID string, err error) {
	f.gate(jobID) <- runResult{err: err}
}

// seqID は連番 ID 生成。
func seqID() func() string {
	var n int64
	return func() string { return fmt.Sprintf("job_%d", atomic.AddInt64(&n, 1)) }
}

// waitStatus は jobID が status になるまで待つ（タイムアウトで fail）。
func waitStatus(t *testing.T, q *Queue, jobID string, want Status) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if j, ok := q.Get(jobID); ok && j.Status == want {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	j, _ := q.Get(jobID)
	t.Fatalf("job %s が %s にならない（現在: %s）", jobID, want, j.Status)
}

func newQueue(runner Runner) *Queue {
	return NewQueue(process.NewManager(), runner, seqID())
}

func TestAdd_重複排除(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	r1 := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s1"})
	if r1.Duplicate {
		t.Fatalf("1つ目は重複でないはず")
	}
	<-f.started // 1つ目が実行開始（global=1 で processing）

	// 同 sessionID の2つ目は重複。
	r2 := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s1"})
	if !r2.Duplicate || r2.ExistingJobID != r1.JobID {
		t.Fatalf("同セッションは重複として既存IDを返すはず: %#v", r2)
	}

	f.complete(r1.JobID, "done")
	waitStatus(t, q, r1.JobID, StatusCompleted)
}

func TestSchedule_global上限でpendingが待つ(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f) // global=1

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	b := q.Add(Spec{Type: TypeChat, Kind: models.KindClaude, SessionID: "b"})

	// b は global=1 のため pending のまま。
	time.Sleep(30 * time.Millisecond)
	if jb, _ := q.Get(b.JobID); jb.Status != StatusPending {
		t.Fatalf("b は pending のはず: %s", jb.Status)
	}

	// a 完了 → b が起動。
	f.complete(a.JobID, "a-done")
	<-f.started
	waitStatus(t, q, b.JobID, StatusProcessing)
	f.complete(b.JobID, "b-done")
	waitStatus(t, q, b.JobID, StatusCompleted)
}

func TestSchedule_種別上限で別kindが追い越す(t *testing.T) {
	f := newFakeRunner()
	q := NewQueue(process.NewManager(), f, seqID())
	q.proc.UpdateLimits(process.Limits{Global: 2, Gemini: 1, Claude: 2, Antigravity: 2})

	// gemini を2つ投入（sessionID 別）。gemini 上限1なので2つ目は pending。
	g1 := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "g1"})
	<-f.started
	g2 := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "g2"})

	// claude を投入。gemini上限で g2 は止まるが、global に空き(2のうち1)があるので claude は追い越して起動。
	c1 := q.Add(Spec{Type: TypeChat, Kind: models.KindClaude, SessionID: "c1"})
	<-f.started
	waitStatus(t, q, c1.JobID, StatusProcessing)
	if jg2, _ := q.Get(g2.JobID); jg2.Status != StatusPending {
		t.Fatalf("g2 は gemini 上限で pending のはず: %s", jg2.Status)
	}

	f.complete(g1.JobID, "")
	<-f.started // g2 が起動
	waitStatus(t, q, g2.JobID, StatusProcessing)
	f.complete(g2.JobID, "")
	f.complete(c1.JobID, "")
	waitStatus(t, q, g2.JobID, StatusCompleted)
	waitStatus(t, q, c1.JobID, StatusCompleted)
}

func TestCancel_pending(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f) // global=1

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	b := q.Add(Spec{Type: TypeChat, Kind: models.KindClaude, SessionID: "b"})

	// b は pending。cancel できる。
	if !q.Cancel(b.JobID) {
		t.Fatalf("pending の cancel は成功するはず")
	}
	if jb, _ := q.Get(b.JobID); jb.Status != StatusCanceled {
		t.Fatalf("b は canceled のはず: %s", jb.Status)
	}
	f.complete(a.JobID, "")
}

func TestCancel_processingはcontextをキャンセル(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started // processing

	if !q.Cancel(a.JobID) {
		t.Fatalf("processing の cancel は成功するはず")
	}
	// Runner は ctx.Done() で ctx.Err()（context.Canceled）を返す。
	// Queue 側は Cancel で既に canceled にしており、run はそれを上書きしない。
	waitStatus(t, q, a.JobID, StatusCanceled)
}

func TestActiveBySessionID_実行中ジョブを返す(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started

	active, ok := q.ActiveBySessionID("a")
	if !ok || active.JobID != a.JobID || active.Status != StatusProcessing {
		t.Fatalf("実行中ジョブを返すはず: ok=%v job=%#v", ok, active)
	}
	if _, ok := q.ActiveBySessionID("missing"); ok {
		t.Fatalf("存在しない sessionID は false のはず")
	}

	f.complete(a.JobID, "")
	waitStatus(t, q, a.JobID, StatusCompleted)
}

func TestCancelProcessing_処理中だけ中止する(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	b := q.Add(Spec{Type: TypeChat, Kind: models.KindClaude, SessionID: "b"})

	if count := q.CancelProcessing(); count != 1 {
		t.Fatalf("processing 1件だけ中止するはず: %d", count)
	}
	waitStatus(t, q, a.JobID, StatusCanceled)
	if jb, ok := q.Get(b.JobID); !ok || jb.Status == StatusCanceled {
		t.Fatalf("pending は abort で消さず canceled にもしないはず: ok=%v status=%s", ok, jb.Status)
	}
}

func TestCancel_終端と不存在は失敗(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	f.complete(a.JobID, "done")
	waitStatus(t, q, a.JobID, StatusCompleted)

	if q.Cancel(a.JobID) {
		t.Fatalf("completed の cancel は失敗するはず")
	}
	if q.Cancel("nope") {
		t.Fatalf("不存在の cancel は失敗するはず")
	}
}

func TestRun_errorでerror状態(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	f.fail(a.JobID, errors.New("boom"))
	waitStatus(t, q, a.JobID, StatusError)
	if j, _ := q.Get(a.JobID); j.Err != "boom" {
		t.Fatalf("エラーメッセージ想定外: %q", j.Err)
	}
}

type panicRunner struct{}

func (panicRunner) Run(ctx context.Context, job Job) (Result, error) {
	panic("boom")
}

func TestRun_panicでerror状態にしてreleaseする(t *testing.T) {
	q := newQueue(panicRunner{})

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	waitStatus(t, q, a.JobID, StatusError)
	if j, _ := q.Get(a.JobID); j.Err == "" {
		t.Fatalf("panic 時は表示用エラーを保持するはず")
	}
	if u := q.proc.InUse(); u.Global != 0 || u.Gemini != 0 {
		t.Fatalf("panic 後も release されるはず: %#v", u)
	}
}

func TestRun_contextCanceledでcanceled状態(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	// Cancel を経由せず、Runner が直接 context.Canceled を返すケースを検証するため、
	// run の switch が context.Canceled を canceled にマップすることを確認する。
	// ここでは fail で context.Canceled を返す。
	f.fail(a.JobID, context.Canceled)
	waitStatus(t, q, a.JobID, StatusCanceled)
}

func TestCleanup_終端ジョブを掃除(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	f.complete(a.JobID, "done")
	waitStatus(t, q, a.JobID, StatusCompleted)

	// retention 経過前は残る。
	q.Cleanup(time.Now())
	if _, ok := q.Get(a.JobID); !ok {
		t.Fatalf("retention 前は残るはず")
	}
	// retention 経過後は消える。
	q.Cleanup(time.Now().Add(25 * time.Hour))
	if _, ok := q.Get(a.JobID); ok {
		t.Fatalf("retention 後は消えるはず")
	}
}

func TestAdd_投入時に期限切れ終端ジョブを掃除する(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)
	base := time.Unix(1000, 0)
	q.now = func() time.Time { return base }

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	f.complete(a.JobID, "done")
	waitStatus(t, q, a.JobID, StatusCompleted)

	// retention 経過後の投入で、明示的な Cleanup なしでも古い終端ジョブが消える。
	q.now = func() time.Time { return base.Add(25 * time.Hour) }
	b := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "b"})
	<-f.started
	if _, ok := q.Get(a.JobID); ok {
		t.Fatalf("投入時掃除で期限切れ終端ジョブは消えるはず")
	}
	if _, ok := q.Get(b.JobID); !ok {
		t.Fatalf("新規ジョブは残るはず")
	}
	f.complete(b.JobID, "done")
	waitStatus(t, q, b.JobID, StatusCompleted)
}

func TestRun_終端時にPayloadを解放しModelを保持する(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a", Model: "gemini-2.5-pro", Payload: "heavy-payload"})
	<-f.started
	// 実行中は Payload を保持する（Runner が参照するため）。
	if j, _ := q.Get(a.JobID); j.Payload == nil {
		t.Fatalf("実行中は Payload を保持するはず")
	}
	// エラー終端でも Payload は解放され、投入時に確定した Model 表示は保てる。
	f.fail(a.JobID, errors.New("boom"))
	waitStatus(t, q, a.JobID, StatusError)
	j, _ := q.Get(a.JobID)
	if j.Payload != nil {
		t.Fatalf("終端後は Payload を解放するはず")
	}
	if j.Model != "gemini-2.5-pro" {
		t.Fatalf("投入時の Model が保持されるはず: %q", j.Model)
	}
}

func TestList_createdAt降順(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	// now を固定して createdAt を制御。
	base := time.Unix(1000, 0)
	q.now = func() time.Time { return base }
	a := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "a"})
	<-f.started
	q.now = func() time.Time { return base.Add(time.Second) }
	// a を完了させてから（global=1）b を入れる。
	f.complete(a.JobID, "")
	waitStatus(t, q, a.JobID, StatusCompleted)
	b := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "b"})
	<-f.started

	list := q.List()
	if len(list) != 2 || list[0].JobID != b.JobID {
		t.Fatalf("createdAt 降順（新しい b が先頭）のはず: %#v", list)
	}
}
