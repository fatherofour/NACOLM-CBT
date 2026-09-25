package roster

import (
	"strings"
	"testing"
)

func TestParseAndCheck(t *testing.T) {
	r, err := Parse(strings.NewReader("service_number,rank,full_name,pin\nNA/24/0412,2Lt,A. Okafor,482913\n na/24/0419 , 2Lt, H. Ibrahim, 105577\n"))
	if err != nil {
		t.Fatal(err)
	}
	if r.Len() != 2 {
		t.Fatalf("want 2 candidates, got %d", r.Len())
	}
	if c, ok := r.Check("na/24/0412", "482913"); !ok || c.FullName != "A. Okafor" {
		t.Fatalf("expected a match, got %v %+v", ok, c)
	}
	if _, ok := r.Check("NA/24/0412", "000000"); ok {
		t.Fatal("wrong PIN must not match")
	}
	if _, ok := r.Check("NA/99/9999", "482913"); ok {
		t.Fatal("unknown candidate must not match")
	}
	if _, ok := r.Check("NA/24/0419", "105577"); !ok {
		t.Fatal("whitespace and case in the CSV should be normalised")
	}
}

func TestParseRejectsBadRows(t *testing.T) {
	for _, in := range []string{
		"service_number,rank,full_name\nNA/1,Lt,X\n",
		"service_number,rank,full_name,pin\nNA/1,Lt,X,12\n",
		"service_number,rank,full_name,pin\nNA/1,Lt,X,1234\nna/1,Lt,Y,5678\n",
	} {
		if _, err := Parse(strings.NewReader(in)); err == nil {
			t.Fatalf("expected an error for %q", in)
		}
	}
}
