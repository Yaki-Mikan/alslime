package housekeeping

import (
	"context"
	"time"

	"alslime/internal/config"
)

// Run は起動時に 1 回掃除し、その後 ctx がキャンセルされるまで一定間隔で掃除を
// 繰り返す。ctx.Done で ticker を停止して戻る。
//
// 呼び出し側は別 goroutine で起動する想定（サーバーライフサイクルに紐付け、
// シャットダウン時に ctx をキャンセルしてリークを防ぐ）。
func (s *Sweeper) Run(ctx context.Context) {
	// 起動時掃除（前回異常終了で残った一時ファイルをここで回収する）。
	s.Sweep()

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
			s.Sweep()
		}
	}
}
