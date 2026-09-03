package buildinfo

import "testing"

func TestIsReleaseRequiresMetadataEnvelope(t *testing.T) {
	originalMode := buildMode
	originalMetadata := metadataEnvelope
	t.Cleanup(func() {
		buildMode = originalMode
		metadataEnvelope = originalMetadata
	})

	buildMode = string(ModeRelease)
	metadataEnvelope = ""
	if IsRelease() {
		t.Fatal("release mode without metadata must fail closed")
	}

	metadataEnvelope = "embedded"
	if !IsRelease() {
		t.Fatal("release mode with metadata must be accepted")
	}
}
