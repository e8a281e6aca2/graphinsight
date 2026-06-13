package httpserver

import (
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"crypto/rand"
	"encoding/hex"
)

const traceHeader = "X-Trace-Id"

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func Trace(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		traceID := strings.TrimSpace(r.Header.Get(traceHeader))
		if traceID == "" {
			traceID = newTraceID()
			r.Header.Set(traceHeader, traceID)
		}
		w.Header().Set(traceHeader, traceID)
		next.ServeHTTP(w, r)
	})
}

func newTraceID() string {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return hex.EncodeToString(buf[:])
	}
	return time.Now().UTC().Format("20060102T150405.000000000")
}

func Recovery(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Error("panic recovered", "panic", rec, "stack", string(debug.Stack()))
				WriteJSON(w, http.StatusInternalServerError, "系统内部错误", map[string]string{"error_code": "INTERNAL_ERROR"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func RequestLogging(logger *slog.Logger, next http.Handler, metricsOpt ...*apiMetrics) http.Handler {
	var metrics *apiMetrics
	if len(metricsOpt) > 0 {
		metrics = metricsOpt[0]
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		duration := time.Since(start)
		if metrics != nil {
			metrics.Observe(r.Method, r.URL.Path, recorder.status, duration)
		}
		logger.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"duration_ms", duration.Milliseconds(),
			"remote_addr", r.RemoteAddr,
		)
	})
}

func CORS(allowedOrigins []string, next http.Handler) http.Handler {
	allowedMap := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		allowedMap[strings.TrimSpace(origin)] = struct{}{}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := allowedMap[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Trace-Id, Idempotency-Key, x-idempotency-key, x-tenant-id, x-project-id, x-kb-id")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Expose-Headers", "X-Trace-Id, X-GraphInsight-Route-Owner, X-Idempotency-Key")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}
