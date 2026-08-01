package jobs

import (
	"testing"

	"alslime/internal/domain/models"
	"alslime/internal/process"
)

// 本体アップデート適用中の投入停止（BeginMaintenance / EndMaintenance。交換日記 005-2）。

func TestBeginMaintenance_新規投入を拒否し解除で受け付ける(t *testing.T) {
	f := newFakeRunner()
	q := NewQueue(process.NewManager(), f, seqID())

	if !q.BeginMaintenance() {
		t.Fatal("空キューで BeginMaintenance が失敗した")
	}
	rejected := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s1"})
	if !rejected.MaintenanceRejected {
		t.Fatalf("メンテナンス中の投入が拒否されなかった: %#v", rejected)
	}
	if rejected.JobID != "" {
		t.Fatalf("拒否時に jobID が発行された: %#v", rejected)
	}

	q.EndMaintenance()
	accepted := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s1"})
	if accepted.MaintenanceRejected || accepted.JobID == "" {
		t.Fatalf("解除後の投入が受け付けられなかった: %#v", accepted)
	}
	<-f.started
	f.complete(accepted.JobID, "done")
}

func TestBeginMaintenance_実行中ジョブがあると開始できない(t *testing.T) {
	f := newFakeRunner()
	q := NewQueue(process.NewManager(), f, seqID())

	added := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s1"})
	<-f.started // processing になるまで待つ

	if q.BeginMaintenance() {
		t.Fatal("実行中ジョブがあるのに BeginMaintenance が成功した")
	}
	// 停止に入っていないので通常投入は受け付けられる（別セッション）。
	other := q.Add(Spec{Type: TypeChat, Kind: models.KindGemini, SessionID: "s2"})
	if other.MaintenanceRejected {
		t.Fatalf("停止していないのに投入が拒否された: %#v", other)
	}

	f.complete(added.JobID, "done")
}
