package authz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"graphinsight/go-backend/internal/config"
)

var ErrUnauthorized = errors.New("unauthorized")
var ErrForbidden = errors.New("forbidden")

type CheckResult struct {
	Allowed bool
	Reason  string
	UserID  int
	User    string
	Email   string
	Scope   map[string]string
}

type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
}

type authorizeEnvelope struct {
	Code int `json:"code"`
	Data struct {
		Allowed bool   `json:"allowed"`
		Reason  string `json:"reason"`
		User    struct {
			ID       int    `json:"id"`
			Username string `json:"username"`
			Email    string `json:"email"`
		} `json:"user"`
		Scope map[string]string `json:"scope"`
	} `json:"data"`
}

func New(cfg config.Config) (*Client, error) {
	raw := strings.TrimSpace(cfg.PythonBackendBaseURL)
	if raw == "" {
		return nil, fmt.Errorf("python backend base url is empty")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("invalid python backend base url: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("python backend base url must contain scheme and host")
	}
	base := *parsed
	base.Path = strings.TrimRight(base.Path, "/")

	timeout := time.Duration(cfg.PythonBackendTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	return &Client{
		baseURL: &base,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}, nil
}

func (c *Client) CheckPermission(ctx context.Context, bearerToken, permission string, scope map[string]string) (CheckResult, error) {
	if c == nil || c.baseURL == nil {
		return CheckResult{}, fmt.Errorf("authz client is not initialized")
	}
	if strings.TrimSpace(bearerToken) == "" {
		return CheckResult{}, ErrUnauthorized
	}

	target := *c.baseURL
	target.Path = joinPath(target.Path, "/api/v1/admin/auth/authorize")
	query := target.Query()
	query.Set("permission", permission)
	target.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		return CheckResult{}, fmt.Errorf("create authz request failed: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+bearerToken)
	req.Header.Set("X-Go-Authz", "graphinsight-go")
	for headerKey, value := range scope {
		if strings.TrimSpace(value) == "" {
			continue
		}
		req.Header.Set(headerKey, value)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return CheckResult{}, fmt.Errorf("request authz endpoint failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return CheckResult{}, ErrUnauthorized
	}
	if resp.StatusCode == http.StatusForbidden {
		return CheckResult{}, ErrForbidden
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return CheckResult{}, fmt.Errorf("authz endpoint returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var envelope authorizeEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		return CheckResult{}, fmt.Errorf("decode authz response failed: %w", err)
	}

	resolvedScope := map[string]string{}
	for k, v := range envelope.Data.Scope {
		resolvedScope[k] = strings.TrimSpace(v)
	}

	return CheckResult{
		Allowed: envelope.Data.Allowed,
		Reason:  envelope.Data.Reason,
		UserID:  envelope.Data.User.ID,
		User:    envelope.Data.User.Username,
		Email:   envelope.Data.User.Email,
		Scope:   resolvedScope,
	}, nil
}

func joinPath(basePath, routePath string) string {
	bp := strings.TrimSuffix(basePath, "/")
	rp := routePath
	if !strings.HasPrefix(rp, "/") {
		rp = "/" + rp
	}
	if bp == "" {
		return rp
	}
	return bp + rp
}
