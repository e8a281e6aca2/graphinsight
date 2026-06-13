package httpserver

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var errAdminJWTInvalid = errors.New("invalid admin jwt")
var errAdminJWTExpired = errors.New("expired admin jwt")

type adminJWTClaims struct {
	Subject   string
	ExpiresAt time.Time
}

type adminJWTVerifier struct {
	secret []byte
	now    func() time.Time
}

func newAdminJWTVerifier(secret string) adminJWTVerifier {
	return adminJWTVerifier{
		secret: []byte(secret),
		now:    time.Now,
	}
}

func issueAdminJWT(subject string, secret string, expiresAt time.Time) (string, error) {
	subject = strings.TrimSpace(subject)
	if subject == "" {
		return "", errAdminJWTInvalid
	}
	header := map[string]string{"alg": "HS256", "typ": "JWT"}
	payload := map[string]interface{}{
		"sub": subject,
		"exp": expiresAt.Unix(),
	}
	headerBytes, err := json.Marshal(header)
	if err != nil {
		return "", err
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	headerPart := base64.RawURLEncoding.EncodeToString(headerBytes)
	payloadPart := base64.RawURLEncoding.EncodeToString(payloadBytes)
	signingInput := headerPart + "." + payloadPart
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(signingInput))
	signaturePart := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return signingInput + "." + signaturePart, nil
}

func (v adminJWTVerifier) verify(token string) (adminJWTClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return adminJWTClaims{}, errAdminJWTInvalid
	}

	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return adminJWTClaims{}, fmt.Errorf("%w: decode header", errAdminJWTInvalid)
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return adminJWTClaims{}, fmt.Errorf("%w: parse header", errAdminJWTInvalid)
	}
	if !strings.EqualFold(header.Algorithm, "HS256") {
		return adminJWTClaims{}, fmt.Errorf("%w: unsupported alg", errAdminJWTInvalid)
	}

	signingInput := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, v.secret)
	_, _ = mac.Write([]byte(signingInput))
	expectedSignature := mac.Sum(nil)
	actualSignature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return adminJWTClaims{}, fmt.Errorf("%w: decode signature", errAdminJWTInvalid)
	}
	if !hmac.Equal(actualSignature, expectedSignature) {
		return adminJWTClaims{}, fmt.Errorf("%w: signature", errAdminJWTInvalid)
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return adminJWTClaims{}, fmt.Errorf("%w: decode payload", errAdminJWTInvalid)
	}
	var payload struct {
		Subject string      `json:"sub"`
		Exp     interface{} `json:"exp"`
	}
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		return adminJWTClaims{}, fmt.Errorf("%w: parse payload", errAdminJWTInvalid)
	}
	subject := strings.TrimSpace(payload.Subject)
	if subject == "" {
		return adminJWTClaims{}, fmt.Errorf("%w: missing sub", errAdminJWTInvalid)
	}
	expiresAt, err := parseJWTNumericDate(payload.Exp)
	if err != nil {
		return adminJWTClaims{}, err
	}
	now := time.Now
	if v.now != nil {
		now = v.now
	}
	if !expiresAt.After(now()) {
		return adminJWTClaims{}, errAdminJWTExpired
	}

	return adminJWTClaims{
		Subject:   subject,
		ExpiresAt: expiresAt,
	}, nil
}

func parseJWTNumericDate(value interface{}) (time.Time, error) {
	switch typed := value.(type) {
	case float64:
		if typed <= 0 {
			return time.Time{}, fmt.Errorf("%w: invalid exp", errAdminJWTInvalid)
		}
		return time.Unix(int64(typed), 0).UTC(), nil
	case json.Number:
		unixSeconds, err := typed.Int64()
		if err != nil || unixSeconds <= 0 {
			return time.Time{}, fmt.Errorf("%w: invalid exp", errAdminJWTInvalid)
		}
		return time.Unix(unixSeconds, 0).UTC(), nil
	default:
		return time.Time{}, fmt.Errorf("%w: missing exp", errAdminJWTInvalid)
	}
}
