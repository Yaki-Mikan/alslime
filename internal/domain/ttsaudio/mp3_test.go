package ttsaudio

import (
	"math"
	"testing"
)

// testMP3Format は MPEG1 Layer III / 48kHz / mono（1フレーム=1152サンプル=0.024秒）。
var testMP3Format = mp3Format{versionBits: 3, sampleRateBits: 1, channelMode: 3}

// makeTestMP3 はテスト用 mp3 を合成する。フレーム本体は無音フレームを流用し、
// 前後へ ID3v2 / ID3v1 タグを付けてタグ除去の検証素材にする。
func makeTestMP3(frames int, withID3v2, withID3v1 bool) []byte {
	var out []byte
	if withID3v2 {
		// サイズ 100 バイトの ID3v2 タグ（synchsafe 表現で data[9]=100）。
		header := []byte{'I', 'D', '3', 4, 0, 0, 0, 0, 0, 100}
		out = append(out, header...)
		out = append(out, make([]byte, 100)...)
	}
	out = append(out, silentMP3Frames(testMP3Format, frames)...)
	if withID3v1 {
		tag := make([]byte, 128)
		copy(tag, "TAG")
		out = append(out, tag...)
	}
	return out
}

func TestStripMP3RemovesTags(t *testing.T) {
	data := makeTestMP3(5, true, true)
	frames, count, format, err := stripMP3(data)
	if err != nil {
		t.Fatalf("stripMP3 error: %v", err)
	}
	if count != 5 {
		t.Fatalf("frame count = %d, want 5", count)
	}
	if format != testMP3Format {
		t.Fatalf("format mismatch: %+v", format)
	}
	// 出力は生フレームのみ（先頭がフレーム同期で、全長がフレーム長×本数）。
	if _, size, ok := parseMP3FrameHeader(frames); !ok || len(frames) != size*5 {
		t.Fatalf("stripped output is not raw frames: len=%d", len(frames))
	}
}

func TestStripMP3RemovesXingFrame(t *testing.T) {
	// 先頭フレームのサイド情報直後へ "Xing" を埋めたメタフレーム＋通常5フレーム。
	data := silentMP3Frames(testMP3Format, 6)
	copy(data[4+testMP3Format.sideInfoSize():], "Xing")
	_, count, _, err := stripMP3(data)
	if err != nil {
		t.Fatalf("stripMP3 error: %v", err)
	}
	if count != 5 {
		t.Fatalf("frame count = %d, want 5 (Xing frame should be removed)", count)
	}
}

func TestMergeMP3InsertsSilence(t *testing.T) {
	// 各10フレーム（0.24秒）＋無音0.24秒（10フレーム）＝計0.72秒。
	a := makeTestMP3(10, true, false)
	b := makeTestMP3(10, false, true)
	merged, duration, err := mergeMP3([][]byte{a, b}, 0.24)
	if err != nil {
		t.Fatalf("mergeMP3 error: %v", err)
	}
	if math.Abs(duration-0.72) > 0.001 {
		t.Fatalf("duration = %f, want 0.72", duration)
	}
	// 出力全体がタグ無しの連続フレームであること。
	_, size, ok := parseMP3FrameHeader(merged)
	if !ok {
		t.Fatal("merged output does not start with a frame header")
	}
	if len(merged) != size*30 {
		t.Fatalf("merged bytes = %d, want %d", len(merged), size*30)
	}
	// 再解析でフレーム数・フォーマットが保たれていること。
	_, count, format, err := stripMP3(merged)
	if err != nil {
		t.Fatalf("stripMP3(merged) error: %v", err)
	}
	if count != 30 || format != testMP3Format {
		t.Fatalf("reparse: count=%d format=%+v", count, format)
	}
}

func TestMergeMP3FormatMismatch(t *testing.T) {
	a := silentMP3Frames(testMP3Format, 3)
	other := mp3Format{versionBits: 3, sampleRateBits: 0, channelMode: 3} // 44.1kHz
	b := silentMP3Frames(other, 3)
	if _, _, err := mergeMP3([][]byte{a, b}, 0); err == nil {
		t.Fatal("expected format mismatch error")
	}
}
