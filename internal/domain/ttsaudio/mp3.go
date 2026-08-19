package ttsaudio

// mp3（MPEG Audio Layer III）の結合。各チャンクからID3タグと Xing/Info 等の
// メタフレームを除去して生フレームを連結し、チャンク間へ自前合成した無音フレームを
// 挟む（設計02の5章。純バイト処理のため外部ツール不要）。
//
// Xing/Info を除去した連結mp3はブラウザの audio.duration が取得不能になるため、
// 長さは結合時にフレーム数から算出して index.json に記録した値を正本とする。

import (
	"errors"
	"fmt"
)

var errInvalidMP3 = errors.New("ttsaudio: invalid mp3 data")

// mp3Format は結合互換性の判定に使うフレーム属性。
type mp3Format struct {
	versionBits    byte // 0=MPEG2.5 / 2=MPEG2 / 3=MPEG1
	sampleRateBits byte
	channelMode    byte // 0=stereo / 1=joint / 2=dual / 3=mono
}

// sampleRate はサンプルレート（Hz）。
func (f mp3Format) sampleRate() int {
	base := [3]int{44100, 48000, 32000}[f.sampleRateBits]
	switch f.versionBits {
	case 3: // MPEG1
		return base
	case 2: // MPEG2
		return base / 2
	default: // MPEG2.5
		return base / 4
	}
}

// samplesPerFrame は 1 フレームのサンプル数（Layer III）。
func (f mp3Format) samplesPerFrame() int {
	if f.versionBits == 3 {
		return 1152
	}
	return 576
}

// bitrateBps は Layer III のビットレート表（bps）。index 0 は free format。
func (f mp3Format) bitrateBps(index byte) int {
	if f.versionBits == 3 {
		return [16]int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}[index] * 1000
	}
	return [16]int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160}[index] * 1000
}

// frameSize はフレーム全長（ヘッダ込みバイト数）。
func (f mp3Format) frameSize(bitrateIndex, padding byte) int {
	bitrate := f.bitrateBps(bitrateIndex)
	if bitrate == 0 {
		return 0
	}
	coef := 144
	if f.versionBits != 3 {
		coef = 72
	}
	return coef*bitrate/f.sampleRate() + int(padding)
}

// sideInfoSize はヘッダ直後のサイド情報のバイト数（Xing/Info 位置の判定用）。
func (f mp3Format) sideInfoSize() int {
	mono := f.channelMode == 3
	if f.versionBits == 3 {
		if mono {
			return 17
		}
		return 32
	}
	if mono {
		return 9
	}
	return 17
}

// parseMP3FrameHeader は 4 バイトのフレームヘッダを検証し、フォーマットと
// フレーム全長を返す。フレーム境界でないときは ok=false。
func parseMP3FrameHeader(data []byte) (format mp3Format, size int, ok bool) {
	if len(data) < 4 || data[0] != 0xFF || data[1]&0xE0 != 0xE0 {
		return mp3Format{}, 0, false
	}
	versionBits := (data[1] >> 3) & 0x03
	layerBits := (data[1] >> 1) & 0x03
	if versionBits == 1 || layerBits != 1 { // version reserved / Layer III 以外
		return mp3Format{}, 0, false
	}
	bitrateIndex := (data[2] >> 4) & 0x0F
	sampleRateBits := (data[2] >> 2) & 0x03
	if bitrateIndex == 0 || bitrateIndex == 15 || sampleRateBits == 3 {
		return mp3Format{}, 0, false
	}
	padding := (data[2] >> 1) & 0x01
	format = mp3Format{
		versionBits:    versionBits,
		sampleRateBits: sampleRateBits,
		channelMode:    (data[3] >> 6) & 0x03,
	}
	size = format.frameSize(bitrateIndex, padding)
	if size < 4 {
		return mp3Format{}, 0, false
	}
	return format, size, true
}

// isMetaFrame は Xing/Info/VBRI ヘッダを持つメタフレーム（音声実体なし）かを返す。
func isMetaFrame(frame []byte, format mp3Format) bool {
	offset := 4 + format.sideInfoSize()
	if offset+4 <= len(frame) {
		tag := string(frame[offset : offset+4])
		if tag == "Xing" || tag == "Info" {
			return true
		}
	}
	// VBRI はヘッダから 32 バイト固定位置。
	if 36+4 <= len(frame) && string(frame[36:40]) == "VBRI" {
		return true
	}
	return false
}

// stripMP3 は 1 チャンクの mp3 から ID3v2/ID3v1 タグとメタフレームを除去し、
// 生フレームの連結・フレーム数・フォーマットを返す。
func stripMP3(data []byte) (frames []byte, frameCount int, format mp3Format, err error) {
	// 先頭の ID3v2 タグを読み飛ばす（サイズは synchsafe 28bit）。
	pos := 0
	if len(data) >= 10 && string(data[0:3]) == "ID3" {
		size := int(data[6]&0x7F)<<21 | int(data[7]&0x7F)<<14 | int(data[8]&0x7F)<<7 | int(data[9]&0x7F)
		pos = 10 + size
	}
	// 末尾の ID3v1 タグ（128 バイト固定）を切り落とす。
	end := len(data)
	if end >= 128 && string(data[end-128:end-125]) == "TAG" {
		end -= 128
	}
	haveFormat := false
	for pos < end {
		f, size, ok := parseMP3FrameHeader(data[pos:end])
		if !ok {
			if !haveFormat {
				// 最初のフレームが見つかるまでは同期位置を探す。
				pos++
				continue
			}
			// フレーム列の途中で同期が崩れたら不正データとして扱う。
			return nil, 0, mp3Format{}, errInvalidMP3
		}
		if pos+size > end {
			// 末尾の欠けたフレームは捨てる（転送端数の許容）。
			break
		}
		frame := data[pos : pos+size]
		pos += size
		if !haveFormat {
			format = f
			haveFormat = true
		} else if f != format {
			return nil, 0, mp3Format{}, errInvalidMP3
		}
		if isMetaFrame(frame, f) {
			continue
		}
		frames = append(frames, frame...)
		frameCount++
	}
	if !haveFormat || frameCount == 0 {
		return nil, 0, mp3Format{}, errInvalidMP3
	}
	return frames, frameCount, format, nil
}

// silentMP3Frames は指定フォーマットに合わせた無音フレームを count 個生成する。
// 最低ビットレートのフレームをヘッダ以外すべてゼロ（サイド情報＝main_data 無し）で
// 合成する。デコーダはデータ無しの区間を無音として出力する。
func silentMP3Frames(format mp3Format, count int) []byte {
	if count <= 0 {
		return nil
	}
	const bitrateIndex = 1 // 最低ビットレート（MPEG1: 32kbps / MPEG2系: 8kbps）
	size := format.frameSize(bitrateIndex, 0)
	frame := make([]byte, size)
	frame[0] = 0xFF
	frame[1] = 0xE0 | format.versionBits<<3 | 0x01<<1 // sync + version + Layer III
	frame[2] = bitrateIndex<<4 | format.sampleRateBits<<2
	frame[3] = format.channelMode << 6
	out := make([]byte, 0, size*count)
	for i := 0; i < count; i++ {
		out = append(out, frame...)
	}
	return out
}

// mergeMP3 はチャンク mp3 群をフレームレベルで結合し、チャンク間へ
// silenceSeconds 相当の無音フレームを挿入した単一 mp3 と合計秒数を返す（要件9.2）。
func mergeMP3(chunks [][]byte, silenceSeconds float64) ([]byte, float64, error) {
	if len(chunks) == 0 {
		return nil, 0, errors.New("ttsaudio: no chunks to merge")
	}
	var format mp3Format
	var stripped [][]byte
	totalFrames := 0
	for i, chunk := range chunks {
		frames, count, f, err := stripMP3(chunk)
		if err != nil {
			return nil, 0, fmt.Errorf("chunk %d: %w", i, err)
		}
		if i == 0 {
			format = f
		} else if f != format {
			return nil, 0, fmt.Errorf("chunk %d: mp3 format mismatch", i)
		}
		stripped = append(stripped, frames)
		totalFrames += count
	}
	silenceFrames := 0
	if silenceSeconds > 0 {
		perFrame := float64(format.samplesPerFrame()) / float64(format.sampleRate())
		silenceFrames = int(silenceSeconds/perFrame + 0.5)
	}
	silence := silentMP3Frames(format, silenceFrames)
	total := 0
	for _, frames := range stripped {
		total += len(frames)
	}
	total += len(silence) * (len(stripped) - 1)

	merged := make([]byte, 0, total)
	for i, frames := range stripped {
		merged = append(merged, frames...)
		if len(silence) > 0 && i < len(stripped)-1 {
			merged = append(merged, silence...)
		}
	}
	totalFrames += silenceFrames * (len(stripped) - 1)
	duration := float64(totalFrames) * float64(format.samplesPerFrame()) / float64(format.sampleRate())
	return merged, duration, nil
}
