package appearanceprompt

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"alslime/internal/config"
	"alslime/internal/coreapi"
	"alslime/internal/domain/appearancejobs"
	"alslime/internal/domain/models"
	"alslime/internal/i18n"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/process"
)

type fakeRunner struct {
	output string
	err    error
}

func (r fakeRunner) Run(_ context.Context, _ jobsvc.Job) (jobsvc.Result, error) {
	return jobsvc.Result{Output: r.output}, r.err
}

type onGate struct{}

func (onGate) Enabled(string) bool             { return true }
func (onGate) PublicSnapshot() map[string]bool { return map[string]bool{} }
func (onGate) Entitlement() coreapi.EntitlementStatus {
	return coreapi.EntitlementStatus{}
}

type offGate struct{}

func (offGate) Enabled(string) bool             { return false }
func (offGate) PublicSnapshot() map[string]bool { return map[string]bool{} }
func (offGate) Entitlement() coreapi.EntitlementStatus {
	return coreapi.EntitlementStatus{}
}

func seqID() func() string {
	var n int64
	return func() string {
		return fmt.Sprintf("job-%d", atomic.AddInt64(&n, 1))
	}
}

func newTestMux(runner jobsvc.Runner, gate coreapi.FeatureGate) (*http.ServeMux, *jobsvc.Queue) {
	return newTestMuxWithAvailable(runner, gate, func() bool { return true })
}

func newTestMuxWithAvailable(runner jobsvc.Runner, gate coreapi.FeatureGate, available func() bool) (*http.ServeMux, *jobsvc.Queue) {
	mux := http.NewServeMux()
	q := jobsvc.NewQueue(process.NewManager(), runner, seqID())
	Register(mux, Deps{Queue: q, Gate: gate, Available: available})
	return mux, q
}

func postJSON(mux *http.ServeMux, path string, body any) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, config.APIPrefix+path, strings.NewReader(string(data)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func validSubmit() map[string]any {
	return map[string]any{
		"dirName":                 "雪",
		"fileName":                "雪",
		"provider":                "claude",
		"model":                   "claude-sonnet-4-6",
		"claudeEffort":            "low",
		"timeoutMinutes":          3,
		"locale":                  "ja",
		"currentCharacterPrompt":  "1girl",
		"currentPhysicalFeatures": "",
	}
}

func waitTerminal(t *testing.T, q *jobsvc.Queue, jobID string) jobsvc.Job {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if job, ok := q.Get(jobID); ok && job.Status.IsTerminal() {
			return job
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("job %s did not finish", jobID)
	return jobsvc.Job{}
}

func TestSubmit_投入されたジョブの種別と排他キー(t *testing.T) {
	mux, q := newTestMux(fakeRunner{output: `{"dirName":"雪","fileName":"雪","groups":[],"all":[]}`}, onGate{})
	rec := postJSON(mux, routeSubmit, validSubmit())
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res submitResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil || res.JobID == "" || res.Status != "pending" {
		t.Fatalf("unexpected response: %s", rec.Body.String())
	}
	job, ok := q.Get(res.JobID)
	if !ok {
		t.Fatalf("job not found")
	}
	if job.Type != jobsvc.TypeAppearancePrompt || job.Kind != models.KindClaude || job.DedupeKey != "appearance-prompt:雪/雪" || job.Label != i18n.KeyLabelAppearancePrompt {
		t.Fatalf("unexpected job: %#v", job)
	}
	waitTerminal(t, q, res.JobID)
}

func TestSubmit_同じ対象の二重投入は409(t *testing.T) {
	// 実行が終わらない Runner で、1 件目が processing のまま 2 件目を投げる。
	block := make(chan struct{})
	runner := blockingRunner{release: block}
	mux, q := newTestMux(runner, onGate{})
	first := postJSON(mux, routeSubmit, validSubmit())
	if first.Code != http.StatusOK {
		t.Fatalf("first submit failed: %d %s", first.Code, first.Body.String())
	}
	var firstRes submitResponse
	_ = json.Unmarshal(first.Body.Bytes(), &firstRes)
	second := postJSON(mux, routeSubmit, validSubmit())
	if second.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", second.Code, second.Body.String())
	}
	var dup duplicateResponse
	if err := json.Unmarshal(second.Body.Bytes(), &dup); err != nil || dup.ExistingJobID != firstRes.JobID || dup.MessageKey != i18n.KeyErrorAlreadyProcessing {
		t.Fatalf("unexpected duplicate response: %s", second.Body.String())
	}
	close(block)
	waitTerminal(t, q, firstRes.JobID)
}

type blockingRunner struct{ release chan struct{} }

func (r blockingRunner) Run(ctx context.Context, _ jobsvc.Job) (jobsvc.Result, error) {
	select {
	case <-r.release:
		return jobsvc.Result{Output: `{"dirName":"雪","fileName":"雪","groups":[],"all":[]}`}, nil
	case <-ctx.Done():
		return jobsvc.Result{}, ctx.Err()
	}
}

func TestSubmit_入力検証(t *testing.T) {
	mux, _ := newTestMux(fakeRunner{}, onGate{})
	cases := []struct {
		name   string
		mutate func(m map[string]any)
		key    string
	}{
		{"プロバイダ不正", func(m map[string]any) { m["provider"] = "other" }, i18n.KeyErrorAppearanceInvalidProvider},
		{"モデル空", func(m map[string]any) { m["model"] = " " }, i18n.KeyErrorAppearanceInvalidPayload},
		{"フォルダ名不正", func(m map[string]any) { m["dirName"] = "../x" }, i18n.KeyErrorInvalidName},
		{"ファイル名空", func(m map[string]any) { m["fileName"] = "" }, i18n.KeyErrorInvalidName},
		{"現在欄が長すぎる", func(m map[string]any) { m["currentCharacterPrompt"] = strings.Repeat("a", currentFieldMaxRunes+1) }, i18n.KeyErrorAppearanceInvalidPayload},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			body := validSubmit()
			c.mutate(body)
			rec := postJSON(mux, routeSubmit, body)
			if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), c.key) {
				t.Fatalf("expected 400 with %s, got %d: %s", c.key, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestSubmit_画像生成機能が無効なら403(t *testing.T) {
	mux, _ := newTestMux(fakeRunner{}, offGate{})
	rec := postJSON(mux, routeSubmit, validSubmit())
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestSubmit_画像生成機能が無効ならモジュール稼働中でも403(t *testing.T) {
	mux, q := newTestMuxWithAvailable(fakeRunner{}, offGate{}, func() bool { return true })
	rec := postJSON(mux, routeSubmit, validSubmit())
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", rec.Code, rec.Body.String())
	}
	if n := len(q.List()); n != 0 {
		t.Fatalf("expected no job, got %d", n)
	}
}

func TestSubmit_モジュール停止中は503でキューへ追加しない(t *testing.T) {
	for name, available := range map[string]func() bool{
		"停止中":      func() bool { return false },
		"判定関数が未設定": nil,
	} {
		t.Run(name, func(t *testing.T) {
			mux, q := newTestMuxWithAvailable(fakeRunner{}, onGate{}, available)
			rec := postJSON(mux, routeSubmit, validSubmit())
			if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), i18n.KeyErrorComfyUIServiceMissing) {
				t.Fatalf("expected 503 with %s, got %d: %s", i18n.KeyErrorComfyUIServiceMissing, rec.Code, rec.Body.String())
			}
			if n := len(q.List()); n != 0 {
				t.Fatalf("expected no job, got %d", n)
			}
		})
	}
}

func TestSubmit_モジュール稼働後は再登録なしで受け付ける(t *testing.T) {
	var active atomic.Bool
	mux, q := newTestMuxWithAvailable(fakeRunner{output: `{"dirName":"雪","fileName":"雪","groups":[],"all":[]}`}, onGate{}, active.Load)
	if rec := postJSON(mux, routeSubmit, validSubmit()); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("before activation: expected 503, got %d: %s", rec.Code, rec.Body.String())
	}
	active.Store(true)
	rec := postJSON(mux, routeSubmit, validSubmit())
	if rec.Code != http.StatusOK {
		t.Fatalf("after activation: expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var res submitResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	waitTerminal(t, q, res.JobID)
}

func TestStatusAndCancel_モジュール停止後も利用できる(t *testing.T) {
	var active atomic.Bool
	active.Store(true)
	block := make(chan struct{})
	defer close(block)
	mux, q := newTestMuxWithAvailable(blockingRunner{release: block}, onGate{}, active.Load)
	rec := postJSON(mux, routeSubmit, validSubmit())
	if rec.Code != http.StatusOK {
		t.Fatalf("submit failed: %d %s", rec.Code, rec.Body.String())
	}
	var res submitResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	active.Store(false)

	req := httptest.NewRequest(http.MethodGet, config.APIPrefix+"/appearance-prompt/status/"+res.JobID, nil)
	statusRec := httptest.NewRecorder()
	mux.ServeHTTP(statusRec, req)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("status: expected 200, got %d: %s", statusRec.Code, statusRec.Body.String())
	}
	cancelRec := postJSON(mux, "/appearance-prompt/cancel/"+res.JobID, nil)
	if cancelRec.Code != http.StatusOK {
		t.Fatalf("cancel: expected 200, got %d: %s", cancelRec.Code, cancelRec.Body.String())
	}
	if job := waitTerminal(t, q, res.JobID); job.Status != jobsvc.StatusCanceled {
		t.Fatalf("expected canceled, got %s", job.Status)
	}
}

func TestStatus_完了したジョブの結果を復号して返す(t *testing.T) {
	output := `{"dirName":"雪","fileName":"雪","groups":[{"key":"hair","tags":["long_hair","black_hair"]}],"all":["long_hair","black_hair"]}`
	mux, q := newTestMux(fakeRunner{output: output}, onGate{})
	rec := postJSON(mux, routeSubmit, validSubmit())
	var res submitResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	waitTerminal(t, q, res.JobID)

	req := httptest.NewRequest(http.MethodGet, config.APIPrefix+"/appearance-prompt/status/"+res.JobID, nil)
	statusRec := httptest.NewRecorder()
	mux.ServeHTTP(statusRec, req)
	if statusRec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", statusRec.Code, statusRec.Body.String())
	}
	var st statusResponse
	if err := json.Unmarshal(statusRec.Body.Bytes(), &st); err != nil {
		t.Fatalf("status is not JSON: %v", err)
	}
	if st.Status != "completed" || st.Result == nil || len(st.Result.Groups) != 1 || st.Result.Groups[0].Key != "hair" || strings.Join(st.Result.All, ",") != "long_hair,black_hair" {
		t.Fatalf("unexpected status: %s", statusRec.Body.String())
	}
	var _ appearancejobs.Result = *st.Result
}

func TestStatusAndCancel_他種別や不存在は404(t *testing.T) {
	mux, q := newTestMux(fakeRunner{}, onGate{})
	added := q.Add(jobsvc.Spec{Type: jobsvc.TypeConfigGen, Kind: models.KindGemini, DedupeKey: "other"})
	for _, path := range []string{"/appearance-prompt/status/" + added.JobID, "/appearance-prompt/status/missing"} {
		req := httptest.NewRequest(http.MethodGet, config.APIPrefix+path, nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: expected 404, got %d", path, rec.Code)
		}
	}
	rec := postJSON(mux, "/appearance-prompt/cancel/"+added.JobID, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("cancel of other type: expected 404, got %d", rec.Code)
	}
	waitTerminal(t, q, added.JobID)
}
