package main

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestExtractMetadata(t *testing.T) {
	want := metadata{
		SchemaVersion:    1,
		CompanyName:      "YakiMikan",
		ProductName:      "AlSlime",
		ComponentID:      "alslime",
		FileDescription:  "test",
		Version:          "1.2.3",
		TargetOS:         "linux",
		TargetArch:       "amd64",
		OriginalFilename: "alslime",
		SourceURL:        "https://example.invalid/source",
		GNUBuildID:       "00112233445566778899aabbccddeeff00112233",
	}
	value, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	binary := []byte("before" + envelopePrefix + base64.StdEncoding.EncodeToString(value) + envelopeSuffix + "after")
	got, err := extractMetadata(binary)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("metadata mismatch: got %#v, want %#v", got, want)
	}
}

func TestExtractMetadataRejectsMissingRecord(t *testing.T) {
	if _, err := extractMetadata([]byte("no metadata")); err == nil {
		t.Fatal("expected an error")
	}
}
