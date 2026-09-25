// Command demo-package writes a small encrypted exam package, its release
// key and a candidate roster, so the kiosk can be tried end to end without
// the central service:
//
//	go run ./cmd/demo-package -out ./demo [-publish immediate|instructor_controlled]
//
// It prints the commands to start the server and release the paper. The
// package format is the one central-api writes (AES-256-GCM envelope, exam
// id as associated data), so the server treats it exactly like a real one.
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"cbt.army.mil.ng/local-exam-server/internal/models"
)

func main() {
	out := flag.String("out", "./demo", "folder to write the demo files into")
	publish := flag.String("publish", "immediate", "immediate | instructor_controlled")
	flag.Parse()
	if *publish != "immediate" && *publish != "instructor_controlled" {
		log.Fatal("-publish must be immediate or instructor_controlled")
	}

	const examID = "demo-log301-t1"
	idx := func(i int) *int { return &i }
	mcq := func(id, topic, stem string, correct int, opts ...string) models.PoolItem {
		return models.PoolItem{ID: id, Type: "mcq", Topic: topic, Source: "past_question", Stem: stem, Options: opts, CorrectIndex: idx(correct)}
	}
	theory := func(id, topic, stem, model string) models.PoolItem {
		return models.PoolItem{ID: id, Type: "theory", Topic: topic, Source: "past_question", Stem: stem, ModelAnswer: &model}
	}
	pool := []models.PoolItem{
		mcq("q01", "Movement control", "Which document authorises the movement of a unit convoy along a main supply route?", 1, "Route card", "Movement order", "Load manifest", "March table"),
		mcq("q02", "Movement control", "What is the usual vehicle interval for a convoy moving by day on a main supply route?", 2, "25 metres", "50 metres", "100 metres", "200 metres"),
		mcq("q03", "Supply chain", "Which class of supply covers fuel, oil and lubricants?", 1, "Class I", "Class III", "Class V", "Class IX"),
		mcq("q04", "Supply chain", "In a forward supply point, which stock is issued first?", 1, "The newest stock", "The oldest serviceable stock", "The heaviest stock", "The stock nearest the gate"),
		mcq("q05", "Movement control", "Which headquarters normally allocates road space on a main supply route?", 1, "Unit headquarters", "Movement control headquarters", "Brigade workshop", "Field ambulance"),
		mcq("q06", "Petroleum", "What is the NATO code for aviation turbine fuel?", 0, "F-34", "F-54", "F-76", "O-236"),
		mcq("q07", "Supply chain", "What does the abbreviation POL stand for?", 0, "Petrol, oil and lubricants", "Point of loading", "Port of landing", "Personnel on leave"),
		mcq("q08", "Movement control", "A convoy halts for a short rest. Where should vehicles stop?", 2, "In the middle of the road", "On the right of the road, closed up", "On the left, keeping their interval", "In the nearest village"),
		mcq("q09", "Supply chain", "Which class of supply covers rations?", 0, "Class I", "Class II", "Class IV", "Class VII"),
		mcq("q10", "Petroleum", "Which hazard is greatest when refuelling vehicles in a confined space?", 1, "Noise", "Fuel vapour ignition", "Tyre damage", "Dust"),
		mcq("q11", "Movement control", "What is a serial in a movement order?", 0, "A group of vehicles moving together under one commander", "A vehicle registration number", "A map reference", "A radio call sign"),
		mcq("q12", "Supply chain", "Which document records items issued from a store?", 0, "Issue voucher", "Leave pass", "Movement order", "Duty roster"),
		theory("q13", "Supply chain", "Explain three factors that determine the siting of a forward supply point.", "Security from observation and attack; good access to the road network; stocks dispersed so one strike cannot destroy them."),
		theory("q14", "Movement control", "State the purpose of a movement order and list the information it should contain.", "It authorises the use of a route and allocates timings to each serial; it gives route, timings, serials, halts and control points."),
		theory("q15", "Petroleum", "Describe the safety precautions for storing packed fuel in a field location.", "Store away from accommodation, dispersed, shaded, with fire points, no naked lights, and spill containment."),
	}
	pkg := models.ExamPackage{
		ExamID: examID, Title: "LOG 301 Movement Control, first term (demo)", DurationMinutes: 90, PassMark: 50,
		QuestionsPerCandidate: len(pool), PublishMode: *publish, Pool: pool,
	}
	plain, err := json.Marshal(pkg)
	check(err)

	key := make([]byte, 32)
	nonce := make([]byte, 12)
	_, err = rand.Read(key)
	check(err)
	_, err = rand.Read(nonce)
	check(err)
	block, err := aes.NewCipher(key)
	check(err)
	gcm, err := cipher.NewGCM(block)
	check(err)
	sealed := gcm.Seal(nil, nonce, plain, []byte(examID))
	env, err := json.Marshal(map[string]any{"version": 1, "nonce": base64.StdEncoding.EncodeToString(nonce), "ciphertext": base64.StdEncoding.EncodeToString(sealed)})
	check(err)

	check(os.MkdirAll(*out, 0o755))
	check(os.WriteFile(filepath.Join(*out, "exam.cbtpkg"), env, 0o644))
	check(os.WriteFile(filepath.Join(*out, "key.hex"), []byte(hex.EncodeToString(key)), 0o600))
	roster := "service_number,rank,full_name,pin\nNA/24/0412,2Lt,A. Okafor,482913\nNA/24/0419,2Lt,H. Ibrahim,105577\nNA/23/0377,Lt,C. Eze,660241\n"
	check(os.WriteFile(filepath.Join(*out, "roster.csv"), []byte(roster), 0o600))

	fmt.Printf(`Demo files written to %[1]s

Start the server:
  CBT_PACKAGE_PATH=%[1]s/exam.cbtpkg CBT_EXAM_ID=%[2]s CBT_ROSTER_PATH=%[1]s/roster.csv CBT_DB_PATH=%[1]s/exam.db CBT_CENTRE_NAME="Hall A" go run ./cmd/server

Open the kiosk: http://localhost:8080/kiosk/?seat=A-14
Sign in as NA/24/0412 with PIN 482913 (roster.csv has two more).

Open the paper (what the invigilator does at the start time):
  curl -X POST localhost:8080/release -d '{"key_hex":"%[3]s"}'
`, *out, examID, hex.EncodeToString(key))
}

func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
