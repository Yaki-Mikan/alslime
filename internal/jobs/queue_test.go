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
	result Result
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
		if r.result.Output == "" {
			r.result.Output = r.output
		}
		return r.result, r.err
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

func (f *fakeRunner) failWithResult(jobID string, result Result, err error) {
	f.gate(jobID) <- runResult{result: result, err: err}
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

func TestRun_errorでも保存済みSession情報を保持する(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	a := q.Add(Spec{Type: TypeChat, Kind: models.KindAntigravity})
	<-f.started
	f.failWithResult(a.JobID, Result{
		FinalSessionID: "saved-session",
		Output:         "temp output missing",
		Model:          "antigravity",
		ErrorType:      "provider_execution_error",
	}, errors.New("temp output missing"))
	waitStatus(t, q, a.JobID, StatusError)

	j, _ := q.Get(a.JobID)
	if j.SessionID != "saved-session" ||
		j.Result != "temp output missing" ||
		j.Model != "antigravity" ||
		j.ErrorType != "provider_execution_error" {
		t.Fatalf("保存済みerror結果がjobへ反映されていない: %#v", j)
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

// nextRunner は完了時に後続ジョブを返す Runner（分析ジョブ→生成ジョブの連鎖を模す）。
type nextRunner struct {
	inner *fakeRunner
	next  func(job Job) *Spec
}

func (r *nextRunner) Run(ctx context.Context, job Job) (Result, error) {
	res, err := r.inner.Run(ctx, job)
	if err == nil && r.next != nil {
		res.Next = r.next(job)
	}
	return res, err
}

func renderSpecFor(job Job) *Spec {
	if job.Type != TypeImageAnalyze {
		return nil
	}
	return &Spec{Type: TypeImageRender, Kind: models.KindComfyUI, SessionID: job.SessionID, DedupeKey: job.DedupeKey}
}

func TestRun_完了時に後続ジョブを投入しNextJobIDを記録する(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(&nextRunner{inner: f, next: renderSpecFor})

	a := q.Add(Spec{Type: TypeImageAnalyze, Kind: models.KindGemini, SessionID: "s1", DedupeKey: "k1"})
	<-f.started
	f.complete(a.JobID, "analyzed")
	waitStatus(t, q, a.JobID, StatusCompleted)

	// 後続の生成ジョブが投入され、分析ジョブに ID が記録される。
	renderID := <-f.started
	ja, _ := q.Get(a.JobID)
	if ja.NextJobID != renderID {
		t.Fatalf("NextJobID 想定外: %q (want %q)", ja.NextJobID, renderID)
	}
	jr, ok := q.Get(renderID)
	if !ok || jr.Type != TypeImageRender || jr.Kind != models.KindComfyUI || jr.DedupeKey != "k1" {
		t.Fatalf("後続ジョブ想定外: %#v", jr)
	}
	f.complete(renderID, "rendered")
	waitStatus(t, q, renderID, StatusCompleted)
}

func TestRun_errorとcanceledでは後続ジョブを投入しない(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(&nextRunner{inner: f, next: renderSpecFor})

	a := q.Add(Spec{Type: TypeImageAnalyze, Kind: models.KindGemini, SessionID: "s1", DedupeKey: "k1"})
	<-f.started
	f.fail(a.JobID, errors.New("boom"))
	waitStatus(t, q, a.JobID, StatusError)

	b := q.Add(Spec{Type: TypeImageAnalyze, Kind: models.KindGemini, SessionID: "s2", DedupeKey: "k2"})
	<-f.started
	if !q.Cancel(b.JobID) {
		t.Fatalf("processing はキャンセルできるはず")
	}
	waitStatus(t, q, b.JobID, StatusCanceled)

	time.Sleep(30 * time.Millisecond)
	for _, j := range q.List() {
		if j.Type == TypeImageRender {
			t.Fatalf("後続ジョブは投入されないはず: %#v", j)
		}
	}
}

func TestRun_後続ジョブは分析ジョブがglobal枠を待つ間も起動する(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(&nextRunner{inner: f, next: renderSpecFor}) // global=1, comfyui=1

	a := q.Add(Spec{Type: TypeImageAnalyze, Kind: models.KindGemini, SessionID: "s1", DedupeKey: "k1"})
	<-f.started
	// 2 件目の分析は global 枠待ちで pending。
	b := q.Add(Spec{Type: TypeImageAnalyze, Kind: models.KindGemini, SessionID: "s2", DedupeKey: "k2"})

	f.complete(a.JobID, "analyzed")
	waitStatus(t, q, a.JobID, StatusCompleted)
	// a の後続（生成）と b（分析）の両方が起動する（生成は ComfyUI 枠、分析は解放された global 枠）。
	started := map[string]bool{<-f.started: true, <-f.started: true}
	ja, _ := q.Get(a.JobID)
	if !started[ja.NextJobID] || !started[b.JobID] {
		t.Fatalf("生成ジョブと次の分析ジョブが同時に起動するはず: %#v", started)
	}
	f.complete(ja.NextJobID, "rendered")
	f.complete(b.JobID, "analyzed")
	waitStatus(t, q, ja.NextJobID, StatusCompleted)
}

func TestRun_後続ジョブの投入がメンテナンスで拒否されたら分析ジョブをerrorにする(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(&nextRunner{inner: f, next: renderSpecFor})

	a := q.Add(Spec{Type: TypeImageAnalyze, Kind: models.KindGemini, SessionID: "s1", DedupeKey: "k1"})
	<-f.started
	// 実行中はメンテナンスへ入れないため、maintenance フラグを直接立てて投入拒否を模す。
	q.mu.Lock()
	q.maintenance = true
	q.mu.Unlock()
	f.complete(a.JobID, "analyzed")
	waitStatus(t, q, a.JobID, StatusError)
	ja, _ := q.Get(a.JobID)
	if ja.NextJobID != "" {
		t.Fatalf("拒否時は NextJobID を持たないはず: %#v", ja)
	}
}

func TestAdd_画像ジョブ中でも同セッションのチャットは重複にならない(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	img := q.Add(Spec{Type: TypeImageRender, Kind: models.KindComfyUI, SessionID: "s1", DedupeKey: "k1"})
	<-f.started
	tts := q.Add(Spec{Type: TypeTTS, Kind: models.KindTTS, SessionID: "s1", DedupeKey: "t1"})
	<-f.started
	if img.Duplicate || tts.Duplicate {
		t.Fatalf("画像・TTS は DedupeKey 判定なので重複にならないはず")
	}

	chat := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s1"})
	if chat.Duplicate {
		t.Fatalf("画像・TTS 処理中の同セッションチャットは重複にならないはず: %#v", chat)
	}
	<-f.started

	// チャット同士の排他は維持される（regenerate も同じ枠）。
	regen := q.Add(Spec{Type: TypeRegenerate, Kind: models.KindGemini, SessionID: "s1"})
	if !regen.Duplicate || regen.ExistingJobID != chat.JobID {
		t.Fatalf("チャット処理中の同セッション regenerate は重複になるはず: %#v", regen)
	}

	f.complete(img.JobID, "img")
	f.complete(tts.JobID, "tts")
	f.complete(chat.JobID, "chat")
	waitStatus(t, q, chat.JobID, StatusCompleted)
}

func TestActiveBySessionID_画像ジョブは返さずチャットだけ返す(t *testing.T) {
	f := newFakeRunner()
	q := newQueue(f)

	img := q.Add(Spec{Type: TypeImageRender, Kind: models.KindComfyUI, SessionID: "s1", DedupeKey: "k1"})
	<-f.started
	if _, ok := q.ActiveBySessionID("s1"); ok {
		t.Fatalf("画像ジョブしか無いセッションでは active を返さないはず")
	}

	chat := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s1"})
	<-f.started
	got, ok := q.ActiveBySessionID("s1")
	if !ok || got.JobID != chat.JobID {
		t.Fatalf("チャットジョブが active として返るはず: ok=%v got=%#v", ok, got)
	}

	f.complete(img.JobID, "img")
	f.complete(chat.JobID, "chat")
	waitStatus(t, q, chat.JobID, StatusCompleted)
}
