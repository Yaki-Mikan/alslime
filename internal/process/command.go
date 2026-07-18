package process

import (
	"context"
	"os/exec"
	"runtime"
	"strconv"
	"time"
)

const killWaitTimeout = 2 * time.Second

// RunCommandContext は ctx のキャンセル時に外部コマンドを停止する。
//
// Windows の .cmd ランチャーは子プロセスが標準入出力を握ったまま残りやすい。
// そのため Windows では taskkill /T でプロセスツリーごと止める。
func RunCommandContext(ctx context.Context, command *exec.Cmd) error {
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

func killProcessTree(command *exec.Cmd) {
	if command == nil || command.Process == nil {
		return
	}
	if runtime.GOOS == "windows" {
		_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(command.Process.Pid)).Run()
		_ = command.Process.Kill()
		return
	}
	_ = command.Process.Kill()
}
