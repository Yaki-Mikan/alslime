package process

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"testing"
	"time"
)

func TestRunCommandContext_Cancel(t *testing.T) {
	if os.Getenv("ALSLIME_HELPER_SLEEP") == "1" {
		time.Sleep(10 * time.Second)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	cmd := exec.Command(os.Args[0], "-test.run=TestRunCommandContext_Cancel")
	cmd.Env = append(os.Environ(), "ALSLIME_HELPER_SLEEP=1")

	err := RunCommandContext(ctx, cmd)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("deadline error expected: %v", err)
	}
}
