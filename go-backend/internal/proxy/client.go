package proxy

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"graphinsight/go-backend/internal/config"
)

type Client struct {
	baseURL     *url.URL
	httpClient  *http.Client
	forwardAuth bool
}

const upstreamBaseHeader = "X-Upstream-Base"

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
		timeout = 30 * time.Second
	}

	return &Client{
		baseURL: parsed,
		httpClient: &http.Client{
			Timeout: timeout,
		},
		forwardAuth: cfg.PythonBackendForwardAuth,
	}, nil
}

func (c *Client) Proxy(w http.ResponseWriter, r *http.Request) error {
	if c == nil || c.baseURL == nil {
		return fmt.Errorf("python proxy client is not initialized")
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return fmt.Errorf("read request body failed: %w", err)
	}
	_ = r.Body.Close()

	target := *c.baseURL
	target.Path = joinPath(c.baseURL.Path, r.URL.Path)
	target.RawQuery = r.URL.RawQuery

	req, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create upstream request failed: %w", err)
	}

	copyHeader(req.Header, r.Header)
	if !c.forwardAuth {
		req.Header.Del("Authorization")
	}
	req.Header.Del(upstreamBaseHeader)
	req.Header.Set("X-Go-Proxy", "graphinsight-go")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request upstream failed: %w", err)
	}
	defer resp.Body.Close()

	copyHeaderExcept(w.Header(), resp.Header, upstreamBaseHeader)
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
	return nil
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

func copyHeader(dst, src http.Header) {
	copyHeaderExcept(dst, src)
}

func copyHeaderExcept(dst, src http.Header, excluded ...string) {
	blocked := make(map[string]struct{}, len(excluded))
	for _, header := range excluded {
		blocked[http.CanonicalHeaderKey(header)] = struct{}{}
	}

	for k, values := range src {
		if _, ok := blocked[http.CanonicalHeaderKey(k)]; ok {
			continue
		}
		dst.Del(k)
		for _, value := range values {
			dst.Add(k, value)
		}
	}
}

func BoolFromEnvString(value string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(value))
	if v == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return parsed
}
