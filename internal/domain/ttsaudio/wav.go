package ttsaudio

// wav（RIFF/WAVE）の結合。チャンク音声を波形レベルで連結し、間に無音を挿入する
// （設計02の5章。検証済みの正攻法。mp3 の結合は mp3.go を参照）。

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// wavFormat は fmt チャンクの要点。
type wavFormat struct {
	audioFormat   uint16
	channels      uint16
	sampleRate    uint32
	bitsPerSample uint16
}

// bytesPerSecond は 1 秒あたりの PCM バイト数。
func (f wavFormat) bytesPerSecond() int {
	return int(f.sampleRate) * int(f.channels) * int(f.bitsPerSample) / 8
}

var errInvalidWav = errors.New("ttsaudio: invalid wav data")

// parseWav は RIFF/WAVE から fmt 情報と data チャンクの PCM を取り出す。
func parseWav(data []byte) (wavFormat, []byte, error) {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return wavFormat{}, nil, errInvalidWav
	}
	var format wavFormat
	var pcm []byte
	haveFmt := false
	pos := 12
	for pos+8 <= len(data) {
		chunkID := string(data[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(data[pos+4 : pos+8]))
		body := pos + 8
		if size < 0 || body+size > len(data) {
			return wavFormat{}, nil, errInvalidWav
		}
		switch chunkID {
		case "fmt ":
			if size < 16 {
				return wavFormat{}, nil, errInvalidWav
			}
			format = wavFormat{
				audioFormat:   binary.LittleEndian.Uint16(data[body : body+2]),
				channels:      binary.LittleEndian.Uint16(data[body+2 : body+4]),
				sampleRate:    binary.LittleEndian.Uint32(data[body+4 : body+8]),
				bitsPerSample: binary.LittleEndian.Uint16(data[body+14 : body+16]),
			}
			haveFmt = true
		case "data":
			pcm = data[body : body+size]
		}
		// チャンクは 2 バイト境界へパディングされる。
		pos = body + size + (size % 2)
	}
	if !haveFmt || pcm == nil || format.channels == 0 || format.sampleRate == 0 || format.bitsPerSample == 0 {
		return wavFormat{}, nil, errInvalidWav
	}
	return format, pcm, nil
}

// mergeWav はチャンク wav 群を波形レベルで結合し、チャンク間へ silenceSeconds の
// 無音を挿入した単一 wav と合計秒数を返す（要件9.2）。
func mergeWav(chunks [][]byte, silenceSeconds float64) ([]byte, float64, error) {
	if len(chunks) == 0 {
		return nil, 0, errors.New("ttsaudio: no chunks to merge")
	}
	var format wavFormat
	var pcms [][]byte
	for i, chunk := range chunks {
		f, pcm, err := parseWav(chunk)
		if err != nil {
			return nil, 0, fmt.Errorf("chunk %d: %w", i, err)
		}
		if i == 0 {
			format = f
		} else if f != format {
			return nil, 0, fmt.Errorf("chunk %d: wav format mismatch", i)
		}
		pcms = append(pcms, pcm)
	}
	blockAlign := int(format.channels) * int(format.bitsPerSample) / 8
	silenceBytes := 0
	if silenceSeconds > 0 {
		samples := int(float64(format.sampleRate)*silenceSeconds + 0.5)
		silenceBytes = samples * blockAlign
	}
	total := 0
	for _, pcm := range pcms {
		total += len(pcm)
	}
	total += silenceBytes * (len(pcms) - 1)

	merged := make([]byte, 0, total)
	for i, pcm := range pcms {
		merged = append(merged, pcm...)
		if silenceBytes > 0 && i < len(pcms)-1 {
			merged = append(merged, make([]byte, silenceBytes)...)
		}
	}
	duration := float64(len(merged)) / float64(format.bytesPerSecond())
	return buildWav(format, merged), duration, nil
}

// buildWav は fmt 情報と PCM から標準44バイトヘッダの wav を組み立てる。
func buildWav(format wavFormat, pcm []byte) []byte {
	blockAlign := int(format.channels) * int(format.bitsPerSample) / 8
	out := make([]byte, 44+len(pcm))
	copy(out[0:4], "RIFF")
	binary.LittleEndian.PutUint32(out[4:8], uint32(36+len(pcm)))
	copy(out[8:12], "WAVE")
	copy(out[12:16], "fmt ")
	binary.LittleEndian.PutUint32(out[16:20], 16)
	binary.LittleEndian.PutUint16(out[20:22], format.audioFormat)
	binary.LittleEndian.PutUint16(out[22:24], format.channels)
	binary.LittleEndian.PutUint32(out[24:28], format.sampleRate)
	binary.LittleEndian.PutUint32(out[28:32], uint32(format.bytesPerSecond()))
	binary.LittleEndian.PutUint16(out[32:34], uint16(blockAlign))
	binary.LittleEndian.PutUint16(out[34:36], format.bitsPerSample)
	copy(out[36:40], "data")
	binary.LittleEndian.PutUint32(out[40:44], uint32(len(pcm)))
	copy(out[44:], pcm)
	return out
}
