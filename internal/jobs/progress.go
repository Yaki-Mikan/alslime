package jobs

// ProgressEntry は実行中ジョブの経過 1 件。
//
// 表示文言の確定はフロントで行う（多言語対応。表示言語切替に追従させるため
// サーバー側で文言を確定させない）。定型文言は TextKey + Args、AI の途中発言など
// 生テキストは Text に入れる（どちらか一方のみ使う）。
type ProgressEntry struct {
	Seq     int      `json:"seq"`
	Kind    string   `json:"kind"` // "text" | "tool" | "done" | "error"
	Text    string   `json:"text,omitempty"`
	TextKey string   `json:"textKey,omitempty"`
	Args    []string `json:"args,omitempty"`
}

// 経過エントリの Kind 値。
const (
	ProgressKindText  = "text"
	ProgressKindTool  = "tool"
	ProgressKindDone  = "done"
	ProgressKindError = "error"
)

// progressMaxEntries は 1 ジョブが保持する経過エントリ数の上限。
// 暴走時にメモリを食い潰さないための安全弁（超過分は古い方から捨てず追記を無視する。
// 上限到達自体が異常であり、末尾の欠落より先頭の作業文脈を残す方が調査に有用）。
const progressMaxEntries = 2000

// AppendProgress は実行中ジョブへ経過エントリを 1 件追記し、採番済み Seq を返す。
//
// Runner の実行 goroutine（stream 読み取り側）から呼ばれる。終端済み・不存在の
// ジョブへの追記は無視する（キャンセル直後のレースを許容するため）。
func (q *Queue) AppendProgress(jobID string, entry ProgressEntry) {
	q.mu.Lock()
	defer q.mu.Unlock()
	j, ok := q.jobs[jobID]
	if !ok || j.Status.IsTerminal() {
		return
	}
	if len(j.Progress) >= progressMaxEntries {
		return
	}
	entry.Seq = len(j.Progress) + 1
	j.Progress = append(j.Progress, entry)
	j.UpdatedAt = q.now().UnixMilli()
}

// ProgressSince は seq より後の経過エントリのコピーを返す（status API の差分取得用）。
func (q *Queue) ProgressSince(jobID string, seq int) []ProgressEntry {
	q.mu.Lock()
	defer q.mu.Unlock()
	j, ok := q.jobs[jobID]
	if !ok || seq >= len(j.Progress) {
		return nil
	}
	if seq < 0 {
		seq = 0
	}
	out := make([]ProgressEntry, len(j.Progress)-seq)
	copy(out, j.Progress[seq:])
	return out
}
