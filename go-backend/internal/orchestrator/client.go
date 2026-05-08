package orchestrator

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"graphinsight/go-backend/internal/config"
)

type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
	retryMax   int
	backoff    time.Duration
	maxBackoff time.Duration
}

type RequestOptions struct {
	// Retryable marks this request safe to retry for retryable status/network errors.
	// Intended for read-like POST routes such as /api/docqa.
	Retryable bool
	// Timeout overrides the default upstream timeout for a single request when > 0.
	Timeout time.Duration
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

	timeout := time.Duration(cfg.PythonBackendTimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	return &Client{
		baseURL: parsed,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		retryMax:   max(0, cfg.OrchestratorRetryMax),
		backoff:    toDurationMS(cfg.OrchestratorRetryBackoffMS, 200*time.Millisecond),
		maxBackoff: toDurationMS(cfg.OrchestratorRetryMaxBackoffMS, 1500*time.Millisecond),
	}, nil
}

func (c *Client) DoJSON(ctx context.Context, method, path, rawQuery string, body []byte, headers map[string]string) (int, []byte, error) {
	return c.DoJSONWithOptions(ctx, method, path, rawQuery, body, headers, RequestOptions{})
}

func (c *Client) DoJSONWithOptions(
	ctx context.Context,
	method,
	path,
	rawQuery string,
	body []byte,
	headers map[string]string,
	options RequestOptions,
) (int, []byte, error) {
	if c == nil || c.baseURL == nil {
		return 0, nil, fmt.Errorf("orchestrator client is not initialized")
	}

	target := *c.baseURL
	target.Path = joinPath(c.baseURL.Path, path)
	target.RawQuery = rawQuery

	buildRequest := func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, method, target.String(), bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Go-Orchestrator", "graphinsight-go")
		for k, v := range headers {
			v = strings.TrimSpace(v)
			if v == "" {
				continue
			}
			req.Header.Set(k, v)
		}
		return req, nil
	}

	httpClient := c.httpClient
	if options.Timeout > 0 {
		cloned := *c.httpClient
		cloned.Timeout = options.Timeout
		httpClient = &cloned
	}

	retryEligible := c.retryMax > 0 && (strings.EqualFold(method, http.MethodGet) || options.Retryable)
	retries := 0
	backoff := c.backoff

	for {
		req, err := buildRequest()
		if err != nil {
			return 0, nil, fmt.Errorf("create upstream request failed: %w", err)
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			if retryEligible && retries < c.retryMax && ctx.Err() == nil {
				retries++
				if !sleepWithBackoff(ctx, backoff) {
					return 0, nil, fmt.Errorf("request upstream failed: %w", err)
				}
				backoff = nextBackoff(backoff, c.maxBackoff)
				continue
			}
			return 0, nil, fmt.Errorf("request upstream failed: %w", err)
		}

		respBody, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if readErr != nil {
			return resp.StatusCode, nil, fmt.Errorf("read upstream body failed: %w", readErr)
		}

		if retryEligible && retries < c.retryMax && shouldRetryStatus(resp.StatusCode) && ctx.Err() == nil {
			retries++
			if !sleepWithBackoff(ctx, backoff) {
				return resp.StatusCode, respBody, nil
			}
			backoff = nextBackoff(backoff, c.maxBackoff)
			continue
		}

		return resp.StatusCode, respBody, nil
	}
}

func (c *Client) DoStream(
	ctx context.Context,
	method,
	path,
	rawQuery string,
	body io.Reader,
	contentType string,
	headers map[string]string,
) (int, []byte, error) {
	if c == nil || c.baseURL == nil {
		return 0, nil, fmt.Errorf("orchestrator client is not initialized")
	}

	target := *c.baseURL
	target.Path = joinPath(c.baseURL.Path, path)
	target.RawQuery = rawQuery

	req, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return 0, nil, fmt.Errorf("create upstream request failed: %w", err)
	}
	if strings.TrimSpace(contentType) != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Go-Orchestrator", "graphinsight-go")
	for k, v := range headers {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		req.Header.Set(k, v)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("request upstream failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("read upstream body failed: %w", err)
	}
	return resp.StatusCode, respBody, nil
}

func shouldRetryStatus(status int) bool {
	return status == http.StatusTooManyRequests ||
		status == http.StatusBadGateway ||
		status == http.StatusServiceUnavailable ||
		status == http.StatusGatewayTimeout
}

func sleepWithBackoff(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		d = 100 * time.Millisecond
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func nextBackoff(current, maxBackoff time.Duration) time.Duration {
	next := current * 2
	if next <= 0 {
		return 100 * time.Millisecond
	}
	if maxBackoff > 0 && next > maxBackoff {
		return maxBackoff
	}
	return next
}

func toDurationMS(ms int, fallback time.Duration) time.Duration {
	if ms <= 0 {
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
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
