package process

import (
	"context"
	"os/exec"
	"time"
)

const killWaitTimeout = 2 * time.Second

// RunCommandContext は ctx のキャンセル時に外部コマンドを停止する。
//
// Windows の .cmd ランチャーは子プロセスが標準入出力を握ったまま残りやすい。
// そのため Windows では taskkill /T でプロセスツリーごと止める。
// Linux 等ではプロセスグループを作って起動し、kill 時はグループごと止める
// （CLI ランチャーの孫プロセス残留対策。レビュー002対応 6.5）。
func RunCommandContext(ctx context.Context, command *exec.Cmd) error {
	setupProcessGroup(command)
	if err := command.Start(); err != nil {
		return err
	}

	done := make(chan error, 1)
	go func() {
		done <- command.Wait()
	}()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		killProcessTree(command)
		// Windows のランチャー配下で pipe を握る孫プロセスが残ると Wait が返らないことがある。
		// ジョブを processing に閉じ込めないため、停止要求後は短い猶予で呼び出し側へ戻す。
		select {
		case <-done:
		case <-time.After(killWaitTimeout):
		}
		return ctx.Err()
	}
}

// setupProcessGroup / killProcessTree は OS 依存の実装
// （command_windows.go / command_unix.go）。
