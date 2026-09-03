// Command verifyreleasemeta verifies the metadata embedded in a Linux release ELF.
package main

import (
	"bytes"
	"debug/elf"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
)

const (
	envelopePrefix = "ALSLIME_METADATA_V1:"
	envelopeSuffix = ":END_ALSLIME_METADATA_V1"
	gnuBuildIDType = 3
)

type metadata struct {
	SchemaVersion    int    `json:"schemaVersion"`
	CompanyName      string `json:"companyName"`
	ProductName      string `json:"productName"`
	ComponentID      string `json:"componentId"`
	FileDescription  string `json:"fileDescription"`
	Version          string `json:"version"`
	TargetOS         string `json:"targetOS"`
	TargetArch       string `json:"targetArch"`
	OriginalFilename string `json:"originalFilename"`
	SourceURL        string `json:"sourceUrl"`
	GNUBuildID       string `json:"gnuBuildId"`
}

func main() {
	filePath := flag.String("file", "", "Linux ELF release binary to verify")
	flag.Parse()
	if *filePath == "" {
		fmt.Fprintln(os.Stderr, "-file is required")
		os.Exit(2)
	}

	value, err := verify(*filePath)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func verify(filePath string) (metadata, error) {
	elfFile, err := elf.Open(filePath)
	if err != nil {
		return metadata{}, fmt.Errorf("open ELF: %w", err)
	}
	defer elfFile.Close()

	actualBuildID, err := readGNUBuildID(elfFile)
	if err != nil {
		return metadata{}, err
	}

	binary, err := os.ReadFile(filePath)
	if err != nil {
		return metadata{}, fmt.Errorf("read ELF: %w", err)
	}
	value, err := extractMetadata(binary)
	if err != nil {
		return metadata{}, err
	}
	if value.SchemaVersion < 1 || value.CompanyName == "" || value.ProductName == "" ||
		value.ComponentID == "" || value.FileDescription == "" || value.Version == "" ||
		value.TargetOS != "linux" || value.TargetArch == "" || value.OriginalFilename == "" ||
		value.SourceURL == "" {
		return metadata{}, errors.New("embedded metadata has missing or invalid required fields")
	}
	if value.GNUBuildID == "" || value.GNUBuildID != actualBuildID {
		return metadata{}, fmt.Errorf("GNU Build ID mismatch: ELF=%s metadata=%s", actualBuildID, value.GNUBuildID)
	}
	return value, nil
}

func readGNUBuildID(elfFile *elf.File) (string, error) {
	section := elfFile.Section(".note.gnu.build-id")
	if section == nil || section.Size == 0 {
		return "", errors.New("GNU Build ID section is missing or empty")
	}
	data, err := section.Data()
	if err != nil {
		return "", fmt.Errorf("read GNU Build ID section: %w", err)
	}
	if len(data) < 12 {
		return "", errors.New("GNU Build ID note header is truncated")
	}
	order := elfFile.ByteOrder
	nameSize := int(order.Uint32(data[0:4]))
	descriptionSize := int(order.Uint32(data[4:8]))
	noteType := order.Uint32(data[8:12])
	nameOffset := 12
	descriptionOffset := nameOffset + align4(nameSize)
	if noteType != gnuBuildIDType || nameSize < 3 ||
		descriptionSize == 0 || descriptionOffset+descriptionSize > len(data) {
		return "", errors.New("GNU Build ID note is invalid")
	}
	if !bytes.Equal(bytes.TrimRight(data[nameOffset:nameOffset+nameSize], "\x00"), []byte("GNU")) {
		return "", errors.New("GNU Build ID note owner is not GNU")
	}
	return hex.EncodeToString(data[descriptionOffset : descriptionOffset+descriptionSize]), nil
}

func align4(value int) int {
	return (value + int(binary.Size(uint32(0))) - 1) &^ (int(binary.Size(uint32(0))) - 1)
}

func extractMetadata(binary []byte) (metadata, error) {
	prefix := []byte(envelopePrefix)
	suffix := []byte(envelopeSuffix)
	searchFrom := 0
	var matches []metadata
	for {
		relativeStart := bytes.Index(binary[searchFrom:], prefix)
		if relativeStart < 0 {
			break
		}
		start := searchFrom + relativeStart + len(prefix)
		relativeEnd := bytes.Index(binary[start:], suffix)
		if relativeEnd < 0 {
			return metadata{}, errors.New("embedded metadata envelope is truncated")
		}
		encoded := binary[start : start+relativeEnd]
		decoded, decodeErr := base64.StdEncoding.DecodeString(string(encoded))
		if decodeErr == nil {
			var candidate metadata
			if jsonErr := json.Unmarshal(decoded, &candidate); jsonErr == nil {
				matches = append(matches, candidate)
			}
		}
		searchFrom = start + relativeEnd + len(suffix)
	}
	if len(matches) != 1 {
		return metadata{}, fmt.Errorf("expected exactly one embedded metadata record, found %d", len(matches))
	}
	return matches[0], nil
}
