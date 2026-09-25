package crypto

import (
	"encoding/json"
	"reflect"
	"testing"
)

// assertJSONEqual compares two JSON byte slices semantically (ignoring
// whitespace/formatting differences), since the Python fixture generator
// writes decrypted-plaintext (compact) and expected.json (pretty) with the
// same content but different formatting.
func assertJSONEqual(t *testing.T, got, want []byte) {
	t.Helper()
	var gotVal, wantVal any
	if err := json.Unmarshal(got, &gotVal); err != nil {
		t.Fatalf("unmarshal got: %v", err)
	}
	if err := json.Unmarshal(want, &wantVal); err != nil {
		t.Fatalf("unmarshal want: %v", err)
	}
	if !reflect.DeepEqual(gotVal, wantVal) {
		t.Fatalf("decrypted JSON does not match expected fixture.\ngot:  %s\nwant: %s", got, want)
	}
}
