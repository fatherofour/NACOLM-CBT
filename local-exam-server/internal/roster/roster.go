// Package roster holds the candidates allowed to sit the paper at this
// venue, loaded from a CSV the exam office prepares with the admission slips.
//
// CSV columns (header row required, any order):
//
//	service_number,rank,full_name,pin
//
// pin is the 6-digit exam PIN printed on the candidate's admission slip.
package roster

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"strings"
)

type Candidate struct {
	ServiceNumber string `json:"service_number"`
	Rank          string `json:"rank"`
	FullName      string `json:"full_name"`
	pinHash       [32]byte
}

type Roster struct {
	byService map[string]Candidate
}

// Normalize makes service numbers comparable however they're typed
// ("na/24/0412 " and "NA/24/0412" are the same candidate).
func Normalize(serviceNumber string) string {
	return strings.ToUpper(strings.TrimSpace(serviceNumber))
}

func Load(path string) (*Roster, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open roster: %w", err)
	}
	defer f.Close()
	return Parse(f)
}

func Parse(r io.Reader) (*Roster, error) {
	rd := csv.NewReader(r)
	rd.TrimLeadingSpace = true
	header, err := rd.Read()
	if err != nil {
		return nil, fmt.Errorf("read roster header: %w", err)
	}
	col := map[string]int{}
	for i, h := range header {
		col[strings.ToLower(strings.TrimSpace(h))] = i
	}
	for _, need := range []string{"service_number", "rank", "full_name", "pin"} {
		if _, ok := col[need]; !ok {
			return nil, fmt.Errorf("roster is missing the %q column", need)
		}
	}
	out := &Roster{byService: map[string]Candidate{}}
	line := 1
	for {
		rec, err := rd.Read()
		if err == io.EOF {
			break
		}
		line++
		if err != nil {
			return nil, fmt.Errorf("roster line %d: %w", line, err)
		}
		c := Candidate{
			ServiceNumber: Normalize(rec[col["service_number"]]),
			Rank:          strings.TrimSpace(rec[col["rank"]]),
			FullName:      strings.TrimSpace(rec[col["full_name"]]),
		}
		pin := strings.TrimSpace(rec[col["pin"]])
		if c.ServiceNumber == "" || len(pin) < 4 {
			return nil, fmt.Errorf("roster line %d: service_number and a pin of at least 4 digits are required", line)
		}
		if _, dup := out.byService[c.ServiceNumber]; dup {
			return nil, fmt.Errorf("roster line %d: %s appears twice", line, c.ServiceNumber)
		}
		c.pinHash = sha256.Sum256([]byte(pin))
		out.byService[c.ServiceNumber] = c
	}
	return out, nil
}

// Check returns the candidate if the service number is on the roster and the
// PIN matches. The PIN comparison is constant-time.
func (r *Roster) Check(serviceNumber, pin string) (Candidate, bool) {
	c, ok := r.byService[Normalize(serviceNumber)]
	given := sha256.Sum256([]byte(strings.TrimSpace(pin)))
	if !ok {
		subtle.ConstantTimeCompare(given[:], given[:]) // keep timing similar for unknown candidates
		return Candidate{}, false
	}
	return c, subtle.ConstantTimeCompare(given[:], c.pinHash[:]) == 1
}

func (r *Roster) Get(serviceNumber string) (Candidate, bool) {
	c, ok := r.byService[Normalize(serviceNumber)]
	return c, ok
}

func (r *Roster) Len() int { return len(r.byService) }
