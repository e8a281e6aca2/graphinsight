package httpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type clientLogPayload struct {
	Level   string                 `json:"level"`
	Message string                 `json:"message"`
	Context map[string]interface{} `json:"context"`
	Source  string                 `json:"source"`
	Event   string                 `json:"event"`
}

func registerPublicCompatibilityRoutes(mux *http.ServeMux, logger *slog.Logger) {
	mux.HandleFunc("/api/client-logs", withRouteOwner("go-native", buildClientLogHandler(logger)))
	mux.HandleFunc("/api/proxy-media", withRouteOwner("go-native", buildProxyMediaHandler(logger)))
	mux.HandleFunc("/api/proxy-image", withRouteOwner("go-native", buildProxyMediaHandler(logger)))
	mux.HandleFunc("/api/video-thumbnail", withRouteOwner("go-native", buildVideoThumbnailHandler(logger)))
}

func buildClientLogHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}

		defer r.Body.Close()

		var payload clientLogPayload
		if err := json.NewDecoder(io.LimitReader(r.Body, 64*1024)).Decode(&payload); err != nil {
			WriteJSON(w, http.StatusBadRequest, "Invalid request body", map[string]string{"error_code": "INVALID_REQUEST"})
			return
		}

		payload.Level = strings.ToLower(strings.TrimSpace(payload.Level))
		payload.Message = strings.TrimSpace(payload.Message)
		payload.Source = strings.TrimSpace(payload.Source)
		payload.Event = strings.TrimSpace(payload.Event)

		if payload.Level == "" {
			payload.Level = "info"
		}
		if payload.Source == "" {
			payload.Source = "frontend"
		}
		if payload.Event == "" {
			payload.Event = "client_log"
		}
		if payload.Message == "" {
			WriteJSON(w, http.StatusBadRequest, "message is required", map[string]string{"error_code": "INVALID_REQUEST"})
			return
		}
		if payload.Level != "info" && payload.Level != "warn" && payload.Level != "error" {
			WriteJSON(w, http.StatusBadRequest, "level must be one of info, warn, error", map[string]string{"error_code": "INVALID_REQUEST"})
			return
		}

		attrs := []any{
			"source", payload.Source,
			"event", payload.Event,
			"trace_id", r.Header.Get(traceHeader),
			"remote_addr", r.RemoteAddr,
		}
		if ua := strings.TrimSpace(r.Header.Get("User-Agent")); ua != "" {
			attrs = append(attrs, "user_agent", ua)
		}
		if payload.Context != nil {
			attrs = append(attrs, "context", payload.Context)
		}

		switch payload.Level {
		case "error":
			logger.Error(payload.Message, attrs...)
		case "warn":
			logger.Warn(payload.Message, attrs...)
		default:
			logger.Info(payload.Message, attrs...)
		}

		WriteJSON(w, http.StatusOK, "logged", map[string]bool{"received": true})
	}
}

func buildProxyMediaHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}

		targetURL, err := validateRemoteMediaURL(r.URL.Query().Get("url"))
		if err != nil {
			WriteJSON(w, http.StatusBadRequest, err.Error(), map[string]string{"error_code": "INVALID_URL"})
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL, nil)
		if err != nil {
			logger.Error("build proxy media request failed", "url", targetURL, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "系统内部错误", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}

		resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
		if err != nil {
			logger.Warn("proxy media fetch failed", "url", targetURL, "error", err.Error())
			WriteJSON(w, http.StatusBadGateway, "Failed to fetch media", map[string]string{"error_code": "UPSTREAM_ERROR"})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			logger.Warn("proxy media upstream returned error", "url", targetURL, "status", resp.StatusCode)
			WriteJSON(w, resp.StatusCode, "Failed to fetch media", map[string]string{"error_code": "UPSTREAM_ERROR"})
			return
		}

		copyProxyHeaders(w.Header(), resp.Header)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, resp.Body)
	}
}

func buildVideoThumbnailHandler(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}

		targetURL, err := validateRemoteMediaURL(r.URL.Query().Get("url"))
		if err != nil {
			WriteJSON(w, http.StatusBadRequest, err.Error(), map[string]string{"error_code": "INVALID_URL"})
			return
		}

		if looksLikeVideo(targetURL) && remoteURLReachable(r.Context(), logger, targetURL) {
			w.Header().Set("Content-Type", "text/plain; charset=utf-8")
			w.Header().Set("Cache-Control", "public, max-age=3600")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("VIDEO_PROXY:" + targetURL))
			return
		}

		w.Header().Set("Content-Type", "image/svg+xml")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, bytes.NewBufferString(defaultVideoThumbnailSVG))
	}
}

func validateRemoteMediaURL(raw string) (string, error) {
	target := strings.TrimSpace(raw)
	if target == "" {
		return "", errInvalidURL("url is required")
	}
	parsed, err := url.Parse(target)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errInvalidURL("Invalid URL format")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errInvalidURL("Only HTTP/HTTPS URLs are allowed")
	}
	return parsed.String(), nil
}

type invalidURLError string

func (e invalidURLError) Error() string { return string(e) }

func errInvalidURL(message string) error { return invalidURLError(message) }

func looksLikeVideo(targetURL string) bool {
	lower := strings.ToLower(targetURL)
	for _, ext := range []string{".mp4", ".webm", ".ogg", ".avi", ".mov", ".wmv", ".flv"} {
		if strings.Contains(lower, ext) {
			return true
		}
	}
	return false
}

func remoteURLReachable(ctx context.Context, logger *slog.Logger, targetURL string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, targetURL, nil)
	if err != nil {
		return false
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		logger.Warn("video thumbnail head probe failed", "url", targetURL, "error", err.Error())
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func copyProxyHeaders(dst http.Header, src http.Header) {
	if contentType := src.Get("Content-Type"); contentType != "" {
		dst.Set("Content-Type", contentType)
	}
	if contentLength := src.Get("Content-Length"); contentLength != "" {
		dst.Set("Content-Length", contentLength)
	}
	if acceptRanges := src.Get("Accept-Ranges"); acceptRanges != "" {
		dst.Set("Accept-Ranges", acceptRanges)
	}
	if etag := src.Get("ETag"); etag != "" {
		dst.Set("ETag", etag)
	}
	if lastModified := src.Get("Last-Modified"); lastModified != "" {
		dst.Set("Last-Modified", lastModified)
	}
}

const defaultVideoThumbnailSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 90 90"><rect width="90" height="90" fill="#1976d2" rx="8"/><circle cx="45" cy="45" r="18" fill="rgba(255,255,255,0.9)"/><polygon points="38,35 38,55 58,45" fill="#1976d2"/><text x="45" y="78" text-anchor="middle" fill="white" font-size="10" font-family="Arial">VIDEO</text></svg>`
