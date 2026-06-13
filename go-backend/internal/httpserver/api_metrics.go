package httpserver

import (
	"sort"
	"sync"
	"time"
)

type apiMetrics struct {
	mu         sync.RWMutex
	maxSamples int
	samples    []apiMetricSample
	next       int
	full       bool
}

type apiMetricSample struct {
	At         time.Time
	Method     string
	Path       string
	StatusCode int
	Duration   time.Duration
}

type apiPathMetric struct {
	Path      string  `json:"path"`
	Total     int     `json:"total"`
	Failed    int     `json:"failed"`
	ErrorRate float64 `json:"error_rate"`
}

type apiMetricsSnapshot struct {
	AvgResponseTimeMS float64         `json:"avg_response_time_ms"`
	P50ResponseTimeMS float64         `json:"p50_response_time_ms"`
	P95ResponseTimeMS float64         `json:"p95_response_time_ms"`
	P99ResponseTimeMS float64         `json:"p99_response_time_ms"`
	RequestsPerSecond float64         `json:"requests_per_second"`
	ErrorRate         float64         `json:"error_rate"`
	TotalRequests     int             `json:"total_requests"`
	FailedRequests    int             `json:"failed_requests"`
	WindowSeconds     int             `json:"window_seconds"`
	TopPaths          []apiPathMetric `json:"top_paths"`
	Timestamp         string          `json:"timestamp"`
}

func newAPIMetrics(maxSamples int) *apiMetrics {
	if maxSamples <= 0 {
		maxSamples = 5000
	}
	return &apiMetrics{
		maxSamples: maxSamples,
		samples:    make([]apiMetricSample, maxSamples),
	}
}

func (m *apiMetrics) Observe(method, path string, statusCode int, duration time.Duration) {
	if m == nil {
		return
	}
	if duration < 0 {
		duration = 0
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	m.samples[m.next] = apiMetricSample{
		At:         time.Now(),
		Method:     method,
		Path:       path,
		StatusCode: statusCode,
		Duration:   duration,
	}
	m.next = (m.next + 1) % m.maxSamples
	if m.next == 0 {
		m.full = true
	}
}

func (m *apiMetrics) Snapshot(windowSeconds int) apiMetricsSnapshot {
	if m == nil {
		return apiMetricsSnapshot{WindowSeconds: normalizeWindowSeconds(windowSeconds), Timestamp: time.Now().UTC().Format(time.RFC3339)}
	}
	windowSeconds = normalizeWindowSeconds(windowSeconds)
	cutoff := time.Now().Add(-time.Duration(windowSeconds) * time.Second)

	m.mu.RLock()
	rows := make([]apiMetricSample, 0, len(m.samples))
	limit := m.next
	if m.full {
		limit = len(m.samples)
	}
	for i := 0; i < limit; i++ {
		item := m.samples[i]
		if item.At.IsZero() || item.At.Before(cutoff) {
			continue
		}
		rows = append(rows, item)
	}
	m.mu.RUnlock()

	total := len(rows)
	failed := 0
	durations := make([]float64, 0, total)
	byPath := map[string]*apiPathMetric{}
	for _, item := range rows {
		duration := durationMS(item.Duration)
		durations = append(durations, duration)
		if item.StatusCode >= 400 {
			failed++
		}
		path := item.Path
		if path == "" {
			path = "unknown"
		}
		bucket := byPath[path]
		if bucket == nil {
			bucket = &apiPathMetric{Path: path}
			byPath[path] = bucket
		}
		bucket.Total++
		if item.StatusCode >= 400 {
			bucket.Failed++
		}
	}
	sort.Float64s(durations)

	topPaths := make([]apiPathMetric, 0, len(byPath))
	for _, item := range byPath {
		if item.Total > 0 {
			item.ErrorRate = round6(float64(item.Failed) / float64(item.Total))
		}
		topPaths = append(topPaths, *item)
	}
	sort.Slice(topPaths, func(i, j int) bool {
		if topPaths[i].Total == topPaths[j].Total {
			return topPaths[i].Path < topPaths[j].Path
		}
		return topPaths[i].Total > topPaths[j].Total
	})
	if len(topPaths) > 8 {
		topPaths = topPaths[:8]
	}

	return apiMetricsSnapshot{
		AvgResponseTimeMS: avgFloat64(durations),
		P50ResponseTimeMS: percentileFloat64(durations, 0.50),
		P95ResponseTimeMS: percentileFloat64(durations, 0.95),
		P99ResponseTimeMS: percentileFloat64(durations, 0.99),
		RequestsPerSecond: round4(float64(total) / float64(windowSeconds)),
		ErrorRate:         errorRate(total, failed),
		TotalRequests:     total,
		FailedRequests:    failed,
		WindowSeconds:     windowSeconds,
		TopPaths:          topPaths,
		Timestamp:         time.Now().UTC().Format(time.RFC3339),
	}
}

func normalizeWindowSeconds(value int) int {
	if value <= 0 {
		return 900
	}
	return value
}

func avgFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	var total float64
	for _, value := range values {
		total += value
	}
	return round3(total / float64(len(values)))
}

func percentileFloat64(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	pos := int(float64(len(values)-1)*p + 0.5)
	if pos < 0 {
		pos = 0
	}
	if pos >= len(values) {
		pos = len(values) - 1
	}
	return round3(values[pos])
}

func errorRate(total int, failed int) float64 {
	if total <= 0 {
		return 0
	}
	return round6(float64(failed) / float64(total))
}

func round3(value float64) float64 {
	return float64(int64(value*1000+0.5)) / 1000
}

func round4(value float64) float64 {
	return float64(int64(value*10000+0.5)) / 10000
}

func round6(value float64) float64 {
	return float64(int64(value*1000000+0.5)) / 1000000
}
