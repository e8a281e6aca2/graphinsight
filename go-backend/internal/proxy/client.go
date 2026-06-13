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

type Response struct {
	StatusCode int
	Header     http.Header
	Body       []byte
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
	resp, err := c.Capture(r)
	if err != nil {
		return err
	}
	resp.WriteTo(w)
	return nil
}

func (c *Client) Capture(r *http.Request) (*Response, error) {
	if c == nil || c.baseURL == nil {
		return nil, fmt.Errorf("python proxy client is not initialized")
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return nil, fmt.Errorf("read request body failed: %w", err)
	}
	_ = r.Body.Close()

	target := *c.baseURL
	target.Path = joinPath(c.baseURL.Path, r.URL.Path)
	target.RawQuery = r.URL.RawQuery

	req, err := http.NewRequestWithContext(r.Context(), r.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create upstream request failed: %w", err)
	}

	copyHeader(req.Header, r.Header)
	if !c.forwardAuth {
		req.Header.Del("Authorization")
	}
	req.Header.Del(upstreamBaseHeader)
	req.Header.Set("X-Go-Proxy", "graphinsight-go")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request upstream failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read upstream response failed: %w", err)
	}
	headers := http.Header{}
	copyHeaderExcept(headers, resp.Header, upstreamBaseHeader)
	return &Response{
		StatusCode: resp.StatusCode,
		Header:     headers,
		Body:       respBody,
	}, nil
}

func (r *Response) WriteTo(w http.ResponseWriter) {
	if r == nil {
		return
	}
	copyHeader(w.Header(), r.Header)
	w.WriteHeader(r.StatusCode)
	_, _ = w.Write(r.Body)
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
