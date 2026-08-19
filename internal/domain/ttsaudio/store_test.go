package ttsaudio

import (
	"encoding/binary"
	"math"
	"testing"
	"time"

	"alslime/internal/storage/paths"
)

// makeTestWav は 16bit mono PCM のテスト用 wav を作る。
func makeTestWav(sampleRate int, samples int, value int16) []byte {
	pcm := make([]byte, samples*2)
	for i := 0; i < samples; i++ {
		binary.LittleEndian.PutUint16(pcm[i*2:], uint16(value))
	}
	return buildWav(wavFormat{audioFormat: 1, channels: 1, sampleRate: uint32(sampleRate), bitsPerSample: 16}, pcm)
}

func TestMergeWavInsertsSilence(t *testing.T) {
	// 1秒 + 0.3秒無音 + 0.5秒 = 1.8秒。
	a := makeTestWav(48000, 48000, 1000)
	b := makeTestWav(48000, 24000, 2000)
	merged, duration, err := mergeWav([][]byte{a, b}, 0.3)
	if err != nil {
		t.Fatalf("mergeWav error: %v", err)
	}
	if math.Abs(duration-1.8) > 0.001 {
		t.Fatalf("duration = %f, want 1.8", duration)
	}
	format, pcm, err := parseWav(merged)
	if err != nil {
		t.Fatalf("parseWav(merged) error: %v", err)
	}
	if format.sampleRate != 48000 || format.channels != 1 || format.bitsPerSample != 16 {
		t.Fatalf("format mismatch: %+v", format)
	}
	wantSamples := 48000 + 14400 + 24000
	if len(pcm) != wantSamples*2 {
		t.Fatalf("pcm bytes = %d, want %d", len(pcm), wantSamples*2)
	}
	// 無音区間（1秒目の直後）がゼロ埋めであること。
	silenceStart := 48000 * 2
	if binary.LittleEndian.Uint16(pcm[silenceStart:]) != 0 {
		t.Fatal("silence gap is not zero-filled")
	}
}

func TestMergeWavFormatMismatch(t *testing.T) {
	a := makeTestWav(48000, 100, 0)
	b := makeTestWav(44100, 100, 0)
	if _, _, err := mergeWav([][]byte{a, b}, 0); err == nil {
		t.Fatal("expected format mismatch error")
	}
}

func TestStoreRoundTrip(t *testing.T) {
	store := New(paths.NewResolver(t.TempDir()))
	session, message, turn := "sess-1", "msg-1", "t_abc12345"

	if err := store.SaveChunk(session, message, turn, 0, "wav", makeTestWav(48000, 4800, 100)); err != nil {
		t.Fatalf("SaveChunk 0: %v", err)
	}
	if err := store.SaveChunk(session, message, turn, 1, "wav", makeTestWav(48000, 4800, 200)); err != nil {
		t.Fatalf("SaveChunk 1: %v", err)
	}
	if _, err := store.ChunkPath(session, message, turn, 0, "wav"); err != nil {
		t.Fatalf("ChunkPath: %v", err)
	}

	entry, err := store.MergeTurn(session, message, turn, 2, "wav", "akari", 0.3)
	if err != nil {
		t.Fatalf("MergeTurn: %v", err)
	}
	// 0.1 + 0.3 + 0.1 = 0.5 秒。
	if math.Abs(entry.DurationSeconds-0.5) > 0.001 {
		t.Fatalf("duration = %f, want 0.5", entry.DurationSeconds)
	}

	idx, err := store.ReadIndex(session)
	if err != nil {
		t.Fatalf("ReadIndex: %v", err)
	}
	key := TurnKey(message, turn)
	if got, ok := idx.Entries[key]; !ok || got.VoiceID != "akari" || got.Format != "wav" {
		t.Fatalf("index entry mismatch: %+v (ok=%v)", got, ok)
	}

	// 一時領域は結合後も残る（逐次再生のフロントがポーリングで取得し終える
	// までの猶予。回収は SweepParts が担う）。
	if _, err := store.ChunkPath(session, message, turn, 0, "wav"); err != nil {
		t.Fatalf("expected temp chunks to remain after merge: %v", err)
	}

	// SweepParts: 未来を cutoff にすると .part が回収され、最終音声は残る。
	files, dirs := store.SweepParts(time.Now().Add(time.Hour))
	if files != 2 || dirs != 1 {
		t.Fatalf("SweepParts = (%d files, %d dirs), want (2, 1)", files, dirs)
	}
	if _, err := store.ChunkPath(session, message, turn, 0, "wav"); err == nil {
		t.Fatal("expected temp chunks to be swept")
	}

	path, format, err := store.FinalPath(session, key)
	if err != nil || format != "wav" || path == "" {
		t.Fatalf("FinalPath: path=%q format=%q err=%v", path, format, err)
	}

	if err := store.DeleteTurn(session, key); err != nil {
		t.Fatalf("DeleteTurn: %v", err)
	}
	if _, _, err := store.FinalPath(session, key); err == nil {
		t.Fatal("expected FinalPath to fail after DeleteTurn")
	}
	if err := store.DeleteSession(session); err != nil {
		t.Fatalf("DeleteSession: %v", err)
	}
}

func TestDeleteMessageRemovesOnlyThatMessage(t *testing.T) {
	store := New(paths.NewResolver(t.TempDir()))
	session := "sess-1"
	// msg-1 に2TURN、msg-2 に1TURN 作る。
	for _, target := range []struct{ message, turn string }{
		{"msg-1", "t_a"}, {"msg-1", "t_b"}, {"msg-2", "t_c"},
	} {
		if err := store.SaveChunk(session, target.message, target.turn, 0, "wav", makeTestWav(48000, 4800, 100)); err != nil {
			t.Fatalf("SaveChunk %s/%s: %v", target.message, target.turn, err)
		}
		if _, err := store.MergeTurn(session, target.message, target.turn, 1, "wav", "akari", 0); err != nil {
			t.Fatalf("MergeTurn %s/%s: %v", target.message, target.turn, err)
		}
	}

	if err := store.DeleteMessage(session, "msg-1"); err != nil {
		t.Fatalf("DeleteMessage: %v", err)
	}
	for _, key := range []string{TurnKey("msg-1", "t_a"), TurnKey("msg-1", "t_b")} {
		if _, _, err := store.FinalPath(session, key); err == nil {
			t.Fatalf("expected %s to be deleted", key)
		}
	}
	// msg-2 は残る。
	if _, _, err := store.FinalPath(session, TurnKey("msg-2", "t_c")); err != nil {
		t.Fatalf("msg-2 audio should remain: %v", err)
	}

	// 対象なしの削除は無変更で成功する。
	if err := store.DeleteMessage(session, "msg-9"); err != nil {
		t.Fatalf("DeleteMessage (no target): %v", err)
	}
}

func TestStoreRejectsBadIDs(t *testing.T) {
	store := New(paths.NewResolver(t.TempDir()))
	if err := store.SaveChunk("../evil", "m", "t", 0, "wav", nil); err == nil {
		t.Fatal("expected bad id rejection")
	}
	if _, err := store.ReadIndex("a b"); err == nil {
		t.Fatal("expected bad id rejection")
	}
}
