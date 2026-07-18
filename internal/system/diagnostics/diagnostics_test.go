package diagnostics

import "testing"

func TestAggregate_最も重い状態へ集約(t *testing.T) {
	cases := []struct {
		name string
		in   []CheckStatus
		want CheckStatus
	}{
		{"空はok", nil, CheckOK},
		{"全部ok", []CheckStatus{CheckOK, CheckOK}, CheckOK},
		{"warning優先", []CheckStatus{CheckOK, CheckWarning}, CheckWarning},
		{"errorが最優先", []CheckStatus{CheckWarning, CheckError, CheckOK}, CheckError},
		{"unknownはokより重い", []CheckStatus{CheckOK, CheckUnknown}, CheckUnknown},
		{"disabledは集約に影響しない", []CheckStatus{CheckOK, CheckDisabled}, CheckOK},
		{"disabledとwarning", []CheckStatus{CheckDisabled, CheckWarning}, CheckWarning},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			results := make([]CheckResult, 0, len(c.in))
			for i, s := range c.in {
				results = append(results, CheckResult{ID: "c", Status: s})
				_ = i
			}
			if got := Aggregate(results); got != c.want {
				t.Fatalf("Aggregate=%q want=%q", got, c.want)
			}
		})
	}
}
