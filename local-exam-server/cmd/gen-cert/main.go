// Command gen-cert makes a self-signed TLS certificate for one venue's
// exam server. There's no real CA to reach from an air-gapped exam room, so
// this is what CBT_TLS_CERT/CBT_TLS_KEY point at — it stops PINs and answers
// travelling in cleartext on the LAN, even though candidate browsers will
// still show a "not trusted" warning for the self-signed cert (installing
// the cert on the venue's lab machines ahead of time avoids that, but isn't
// required).
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	host := flag.String("host", "localhost,127.0.0.1", "comma-separated DNS names and/or IPs the exam server is reached by (e.g. its LAN IP)")
	outDir := flag.String("out", ".", "directory to write cert.pem and key.pem into")
	days := flag.Int("days", 5*365, "validity period in days (default ~5 years — this cert has to outlive the hardware between exam cycles)")
	flag.Parse()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		log.Fatalf("generate key: %v", err)
	}

	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		log.Fatalf("generate serial: %v", err)
	}

	tmpl := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{Organization: []string{"NACOLM CBT (self-signed, venue-local)"}, CommonName: "local-exam-server"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().AddDate(0, 0, *days),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IsCA:         true,
		BasicConstraintsValid: true,
	}

	for _, h := range strings.Split(*host, ",") {
		h = strings.TrimSpace(h)
		if h == "" {
			continue
		}
		if ip := net.ParseIP(h); ip != nil {
			tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
		} else {
			tmpl.DNSNames = append(tmpl.DNSNames, h)
		}
	}
	if len(tmpl.IPAddresses) == 0 && len(tmpl.DNSNames) == 0 {
		log.Fatal("no valid host given via -host")
	}

	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &priv.PublicKey, priv)
	if err != nil {
		log.Fatalf("create certificate: %v", err)
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatalf("create output dir: %v", err)
	}
	certPath := filepath.Join(*outDir, "cert.pem")
	keyPath := filepath.Join(*outDir, "key.pem")

	certOut, err := os.Create(certPath)
	if err != nil {
		log.Fatalf("open %s: %v", certPath, err)
	}
	if err := pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: der}); err != nil {
		log.Fatalf("write cert: %v", err)
	}
	certOut.Close()

	keyBytes, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		log.Fatalf("marshal key: %v", err)
	}
	keyOut, err := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		log.Fatalf("open %s: %v", keyPath, err)
	}
	if err := pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyBytes}); err != nil {
		log.Fatalf("write key: %v", err)
	}
	keyOut.Close()

	fmt.Printf("Wrote %s and %s, valid %d days for: %s\n\n", certPath, keyPath, *days, *host)
	fmt.Printf("Start the server with:\n  CBT_TLS_CERT=%s CBT_TLS_KEY=%s ... go run ./cmd/server\n", certPath, keyPath)
}
