package httpserver

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

type orchestratorMetrics struct {
	mu          sync.RWMutex
	startedAt   time.Time
	total       int64
	totalFailed int64
	byRoute     map[string]*orchestratorRouteMetrics
}

type orchestratorRouteMetrics struct {
	Route         string           `json:"route"`
	Method        string           `json:"method"`
	Requests      int64            `json:"requests"`
	Failed        int64            `json:"failed"`
	AvgLatencyMS  float64          `json:"avg_latency_ms"`
	MaxLatencyMS  float64          `json:"max_latency_ms"`
	LastStatus    int              `json:"last_status"`
	LastError     string           `json:"last_error,omitempty"`
	LastAt        string           `json:"last_at,omitempty"`
	ErrorTaxonomy map[string]int64 `json:"error_taxonomy"`
	totalLatency  time.Duration
	maxLatency    time.Duration
}

type orchestratorMetricsSnapshot struct {
	StartedAt     string                     `json:"started_at"`
	TotalRequests int64                      `json:"total_requests"`
	Failed        int64                      `json:"failed"`
	Success       int64                      `json:"success"`
	Routes        []orchestratorRouteMetrics `json:"routes"`
}

func newOrchestratorMetrics() *orchestratorMetrics {
	return &orchestratorMetrics{
		startedAt: time.Now().UTC(),
		byRoute:   make(map[string]*orchestratorRouteMetrics),
	}
}

func (m *orchestratorMetrics) Observe(route, method string, status int, err error, latency time.Duration) {
	if m == nil {
		return
	}
	if latency < 0 {
		latency = 0
	}
	if strings.TrimSpace(route) == "" {
		route = "unknown"
	}
	if strings.TrimSpace(method) == "" {
		method = "UNKNOWN"
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	m.total++
	key := method + " " + route
	entry, ok := m.byRoute[key]
	if !ok {
		entry = &orchestratorRouteMetrics{
			Route:         route,
			Method:        method,
			ErrorTaxonomy: make(map[string]int64),
		}
		m.byRoute[key] = entry
	}

	entry.Requests++
	entry.LastStatus = status
	entry.LastAt = time.Now().UTC().Format(time.RFC3339)
	entry.totalLatency += latency
	if latency > entry.maxLatency {
		entry.maxLatency = latency
	}

	taxonomy := classifyOrchestratorOutcome(status, err)
	entry.ErrorTaxonomy[taxonomy]++
	if taxonomy != "success" {
		entry.Failed++
		m.totalFailed++
		if err != nil {
			entry.LastError = err.Error()
		} else if status >= 400 {
			entry.LastError = http.StatusText(status)
		}
	}
}

func (m *orchestratorMetrics) Snapshot() orchestratorMetricsSnapshot {
	if m == nil {
		return orchestratorMetricsSnapshot{}
	}
	m.mu.RLock()
	defer m.mu.RUnlock()

	routes := make([]orchestratorRouteMetrics, 0, len(m.byRoute))
	for _, item := range m.byRoute {
		cloned := orchestratorRouteMetrics{
			Route:         item.Route,
			Method:        item.Method,
			Requests:      item.Requests,
			Failed:        item.Failed,
			AvgLatencyMS:  durationMS(item.totalLatency) / float64(max64(item.Requests, 1)),
			MaxLatencyMS:  durationMS(item.maxLatency),
			LastStatus:    item.LastStatus,
			LastError:     item.LastError,
			LastAt:        item.LastAt,
			ErrorTaxonomy: make(map[string]int64, len(item.ErrorTaxonomy)),
		}
		for k, v := range item.ErrorTaxonomy {
			cloned.ErrorTaxonomy[k] = v
		}
		routes = append(routes, cloned)
	}
	sort.Slice(routes, func(i, j int) bool {
		if routes[i].Route == routes[j].Route {
			return routes[i].Method < routes[j].Method
		}
		return routes[i].Route < routes[j].Route
	})

	return orchestratorMetricsSnapshot{
		StartedAt:     m.startedAt.Format(time.RFC3339),
		TotalRequests: m.total,
		Failed:        m.totalFailed,
		Success:       m.total - m.totalFailed,
		Routes:        routes,
	}
}

func (m *orchestratorMetrics) HealthSummary() map[string]interface{} {
	snap := m.Snapshot()
	return map[string]interface{}{
		"total_requests": snap.TotalRequests,
		"failed":         snap.Failed,
		"success":        snap.Success,
	}
}

func classifyOrchestratorOutcome(status int, err error) string {
	if err != nil {
		switch {
		case errors.Is(err, ErrIdempotencyConflict):
			return "idempotency_conflict"
		case errors.Is(err, context.DeadlineExceeded):
			return "timeout"
		case errors.Is(err, context.Canceled):
			return "canceled"
		case status == http.StatusBadRequest:
			return "invalid_request"
		case status == http.StatusServiceUnavailable:
			return "upstream_unavailable"
		case status == http.StatusBadGateway:
			return "upstream_transport_error"
		default:
			return "internal_error"
		}
	}

	switch {
	case status >= 200 && status < 300:
		return "success"
	case status == http.StatusTooManyRequests:
		return "upstream_throttled"
	case status >= 500:
		return "upstream_5xx"
	case status >= 400:
		return "upstream_4xx"
	default:
		return "other"
	}
}

func durationMS(d time.Duration) float64 {
	return float64(d.Microseconds()) / 1000.0
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
