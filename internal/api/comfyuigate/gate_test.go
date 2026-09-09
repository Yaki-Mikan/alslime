package comfyuigate

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"alslime/internal/domain/models"
	jobsvc "alslime/internal/jobs"
	"alslime/internal/process"
)

type recordingRunner struct {
	jobs chan jobsvc.Job
}

func (r recordingRunner) Run(ctx context.Context, job jobsvc.Job) (jobsvc.Result, error) {
	r.jobs <- job
	return jobsvc.Result{FinalSessionID: job.SessionID, Output: "ok"}, nil
}

func TestReadSplitImageJob(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "comfyui_config.json")
	// ファイル無し・項目無し・未知の値は統合、split だけが分離。
	if ReadSplitImageJob(path) {
		t.Fatalf("missing file must be combined")
	}
	for _, tc := range []struct {
		body string
		want bool
	}{
		{`{"tagJudgeProvider":"claude"}`, false},
		{`{"imageJobMode":"combined"}`, false},
		{`{"imageJobMode":"bad"}`, false},
		{`{"imageJobMode":"split"}`, true},
		{`not json`, false},
	} {
		if err := os.WriteFile(path, []byte(tc.body), 0o600); err != nil {
			t.Fatalf("WriteFile failed: %v", err)
		}
		if got := ReadSplitImageJob(path); got != tc.want {
			t.Fatalf("ReadSplitImageJob(%s) = %v, want %v", tc.body, got, tc.want)
		}
	}
}

func TestHandleGenerateFromChat_SplitModeEnqueuesAnalyzeJob(t *testing.T) {
	runner := recordingRunner{jobs: make(chan jobsvc.Job, 2)}
	queue := jobsvc.NewQueue(process.NewManager(), runner, func() string { return "job_1" })
	split := false
	handler := handleGenerateFromChat(Deps{
		Queue:         queue,
		TagJudgeKind:  func() models.Kind { return models.KindClaude },
		SplitImageJob: func() bool { return split },
	})

	post := func(body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		handler(rec, httptest.NewRequest(http.MethodPost, "/api/comfyui/generate-from-chat", bytes.NewBufferString(body)))
		return rec
	}
	rec := post(`{"sessionId":"s1","messageId":"m1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	job := <-runner.jobs
	if job.Type != jobsvc.TypeImageGen || job.Kind != models.KindClaude {
		t.Fatalf("combined mode must enqueue image-generate: %#v", job.Type)
	}

	split = true
	rec = post(`{"sessionId":"s1","messageId":"m2","turnId":"t1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	job = <-runner.jobs
	if job.Type != jobsvc.TypeImageAnalyze || job.Kind != models.KindClaude {
		t.Fatalf("split mode must enqueue image-analyze: %#v", job.Type)
	}
	var submitted struct {
		JobID  string `json:"jobId"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &submitted); err != nil || submitted.Status != string(jobsvc.StatusPending) {
		t.Fatalf("submit response 想定外: %s (err=%v)", rec.Body.String(), err)
	}
}
