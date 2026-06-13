package adminstore

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

type QATypeMetric struct {
	QAType       string  `json:"qa_type"`
	Total        int     `json:"total"`
	Failed       int     `json:"failed"`
	SuccessRate  float64 `json:"success_rate"`
	CitationRate float64 `json:"citation_rate"`
	AvgCitations float64 `json:"avg_citations"`
	P95LatencyMS float64 `json:"p95_latency_ms"`
}

type QAQualitySnapshot struct {
	WindowSeconds  int            `json:"window_seconds"`
	TotalRequests  int            `json:"total_requests"`
	FailedRequests int            `json:"failed_requests"`
	SuccessRate    float64        `json:"success_rate"`
	FailureRate    float64        `json:"failure_rate"`
	CitationRate   float64        `json:"citation_rate"`
	AvgCitations   float64        `json:"avg_citations"`
	AvgLatencyMS   float64        `json:"avg_latency_ms"`
	P50LatencyMS   float64        `json:"p50_latency_ms"`
	P95LatencyMS   float64        `json:"p95_latency_ms"`
	P99LatencyMS   float64        `json:"p99_latency_ms"`
	ByType         []QATypeMetric `json:"by_type"`
	Timestamp      string         `json:"timestamp"`
}

type LogTopItem struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type LogAlertRoute struct {
	Policy       string `json:"policy"`
	Count        int    `json:"count"`
	ThresholdEnv string `json:"threshold_env"`
}

type LogAlertItem struct {
	ID         int     `json:"id"`
	Severity   string  `json:"severity"`
	Action     string  `json:"action,omitempty"`
	Resource   string  `json:"resource,omitempty"`
	ResourceID *string `json:"resource_id,omitempty"`
	Status     string  `json:"status,omitempty"`
	TraceID    string  `json:"trace_id,omitempty"`
	CreatedAt  *string `json:"created_at,omitempty"`
	Message    string  `json:"message,omitempty"`
}

type LogSeverityMetrics struct {
	WindowMinutes int                      `json:"window_minutes"`
	TotalLogs     int                      `json:"total_logs"`
	FailedLogs    int                      `json:"failed_logs"`
	SeverityCount map[string]int           `json:"severity_counts"`
	StatusCounts  map[string]int           `json:"status_counts"`
	ErrorRate     float64                  `json:"error_rate"`
	WarnRate      float64                  `json:"warn_rate"`
	FailedRate    float64                  `json:"failed_rate"`
	TopActions    []LogTopItem             `json:"top_actions"`
	TopResources  []LogTopItem             `json:"top_resources"`
	AlertRoutes   map[string]LogAlertRoute `json:"alert_routes"`
	RecentAlerts  []LogAlertItem           `json:"recent_alerts"`
	Timestamp     string                   `json:"timestamp"`
}

type JobSLOMetrics struct {
	WindowMinutes     int     `json:"window_minutes"`
	TotalJobs         int     `json:"total_jobs"`
	SucceededJobs     int     `json:"succeeded_jobs"`
	FailedJobs        int     `json:"failed_jobs"`
	CancelledJobs     int     `json:"cancelled_jobs"`
	RunningJobs       int     `json:"running_jobs"`
	PendingJobs       int     `json:"pending_jobs"`
	TimeoutFailedJobs int     `json:"timeout_failed_jobs"`
	SuccessRate       float64 `json:"success_rate"`
	TimeoutRate       float64 `json:"timeout_rate"`
	P95DurationMS     float64 `json:"p95_duration_ms"`
	P99DurationMS     float64 `json:"p99_duration_ms"`
	Timestamp         string  `json:"timestamp"`
}

func (c *Client) GetQAQualityMetrics(ctx context.Context, windowSeconds int) (QAQualitySnapshot, error) {
	if c == nil || c.db == nil {
		return QAQualitySnapshot{}, errorsNewAdminStoreUninitialized()
	}
	windowSeconds = clampInt(windowSeconds, 60, 86400)
	since := time.Now().UTC().Add(-time.Duration(windowSeconds) * time.Second)
	rows, err := c.db.QueryContext(ctx, `
		SELECT
			COALESCE(qa_type, 'unknown'),
			COALESCE(status, 'success'),
			latency_ms,
			COALESCE(citation_count, 0)
		FROM admin_qa_traces
		WHERE created_at >= $1
		ORDER BY created_at DESC
	`, since)
	if err != nil {
		return QAQualitySnapshot{}, fmt.Errorf("query qa quality metrics failed: %w", err)
	}
	defer rows.Close()

	snapshot := QAQualitySnapshot{
		WindowSeconds: windowSeconds,
		ByType:        []QATypeMetric{},
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}
	latencies := []float64{}
	citations := []float64{}
	cited := 0
	buckets := map[string]*qaQualityBucket{}

	for rows.Next() {
		var qaType string
		var status string
		var latency sql.NullInt64
		var citationCount int
		if err := rows.Scan(&qaType, &status, &latency, &citationCount); err != nil {
			return QAQualitySnapshot{}, fmt.Errorf("scan qa quality metrics failed: %w", err)
		}
		qaType = firstNonEmptyForStore(strings.TrimSpace(qaType), "unknown")
		citationCount = maxInt(0, citationCount)
		success := strings.EqualFold(strings.TrimSpace(status), "success")

		snapshot.TotalRequests++
		if !success {
			snapshot.FailedRequests++
		}
		if citationCount > 0 {
			cited++
		}
		citations = append(citations, float64(citationCount))

		bucket := buckets[qaType]
		if bucket == nil {
			bucket = &qaQualityBucket{QAType: qaType}
			buckets[qaType] = bucket
		}
		bucket.Total++
		if !success {
			bucket.Failed++
		}
		if citationCount > 0 {
			bucket.Cited++
		}
		bucket.Citations = append(bucket.Citations, float64(citationCount))

		if latency.Valid && latency.Int64 >= 0 {
			value := float64(latency.Int64)
			latencies = append(latencies, value)
			bucket.Latencies = append(bucket.Latencies, value)
		}
	}
	if err := rows.Err(); err != nil {
		return QAQualitySnapshot{}, fmt.Errorf("iterate qa quality metrics failed: %w", err)
	}

	if snapshot.TotalRequests > 0 {
		snapshot.SuccessRate = roundFloat(float64(snapshot.TotalRequests-snapshot.FailedRequests)/float64(snapshot.TotalRequests), 6)
		snapshot.FailureRate = roundFloat(float64(snapshot.FailedRequests)/float64(snapshot.TotalRequests), 6)
		snapshot.CitationRate = roundFloat(float64(cited)/float64(snapshot.TotalRequests), 6)
	}
	snapshot.AvgCitations = averageFloats(citations)
	snapshot.AvgLatencyMS = averageFloats(latencies)
	snapshot.P50LatencyMS = percentileFloats(latencies, 0.50)
	snapshot.P95LatencyMS = percentileFloats(latencies, 0.95)
	snapshot.P99LatencyMS = percentileFloats(latencies, 0.99)

	keys := make([]string, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		bucket := buckets[key]
		metric := QATypeMetric{
			QAType:       bucket.QAType,
			Total:        bucket.Total,
			Failed:       bucket.Failed,
			AvgCitations: averageFloats(bucket.Citations),
			P95LatencyMS: percentileFloats(bucket.Latencies, 0.95),
		}
		if bucket.Total > 0 {
			metric.SuccessRate = roundFloat(float64(bucket.Total-bucket.Failed)/float64(bucket.Total), 6)
			metric.CitationRate = roundFloat(float64(bucket.Cited)/float64(bucket.Total), 6)
		}
		snapshot.ByType = append(snapshot.ByType, metric)
	}
	return snapshot, nil
}

func (c *Client) GetLogSeverityMetrics(ctx context.Context, windowMinutes int) (LogSeverityMetrics, error) {
	if c == nil || c.db == nil {
		return LogSeverityMetrics{}, errorsNewAdminStoreUninitialized()
	}
	windowMinutes = clampInt(windowMinutes, 5, 10080)
	since := time.Now().UTC().Add(-time.Duration(windowMinutes) * time.Minute)
	rows, err := c.db.QueryContext(ctx, `
		SELECT
			id,
			COALESCE(status, 'success'),
			action,
			resource,
			resource_id,
			trace_id,
			error_message,
			created_at
		FROM admin_logs
		WHERE created_at >= $1
		ORDER BY created_at DESC
	`, since)
	if err != nil {
		return LogSeverityMetrics{}, fmt.Errorf("query log severity metrics failed: %w", err)
	}
	defer rows.Close()

	metrics := LogSeverityMetrics{
		WindowMinutes: windowMinutes,
		SeverityCount: map[string]int{
			"info":  0,
			"warn":  0,
			"error": 0,
		},
		StatusCounts: map[string]int{},
		TopActions:   []LogTopItem{},
		TopResources: []LogTopItem{},
		AlertRoutes: map[string]LogAlertRoute{
			"error": {
				Policy:       "page_or_webhook",
				ThresholdEnv: "ALERT_LOG_ERROR_RATE_THRESHOLD",
			},
			"warn": {
				Policy:       "webhook_or_digest",
				ThresholdEnv: "ALERT_LOG_WARN_RATE_THRESHOLD",
			},
		},
		RecentAlerts: []LogAlertItem{},
		Timestamp:    time.Now().UTC().Format(time.RFC3339),
	}
	actionCounts := map[string]int{}
	resourceCounts := map[string]int{}

	for rows.Next() {
		var id int
		var status string
		var action sql.NullString
		var resource sql.NullString
		var resourceID sql.NullString
		var traceID sql.NullString
		var errorMessage sql.NullString
		var createdAt sql.NullTime
		if err := rows.Scan(&id, &status, &action, &resource, &resourceID, &traceID, &errorMessage, &createdAt); err != nil {
			return LogSeverityMetrics{}, fmt.Errorf("scan log severity metrics failed: %w", err)
		}

		actionValue := stringFromNullOrDefault(action, "unknown")
		resourceValue := stringFromNullOrDefault(resource, "unknown")
		statusValue := firstNonEmptyForStore(strings.TrimSpace(status), "unknown")
		severity := classifyLogSeverity(statusValue, actionValue, stringPtrFromNull(errorMessage))

		metrics.TotalLogs++
		metrics.SeverityCount[severity]++
		metrics.StatusCounts[statusValue]++
		actionCounts[actionValue]++
		resourceCounts[resourceValue]++

		if severity == "warn" || severity == "error" {
			if len(metrics.RecentAlerts) < 20 {
				alert := LogAlertItem{
					ID:         id,
					Severity:   severity,
					Action:     stringFromNullOrDefault(action, ""),
					Resource:   stringFromNullOrDefault(resource, ""),
					ResourceID: stringPtrFromNull(resourceID),
					Status:     statusValue,
					TraceID:    stringFromNullOrDefault(traceID, ""),
					Message:    stringFromNullOrDefault(errorMessage, ""),
				}
				if createdAt.Valid {
					value := createdAt.Time.UTC().Format(time.RFC3339)
					alert.CreatedAt = &value
				}
				metrics.RecentAlerts = append(metrics.RecentAlerts, alert)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return LogSeverityMetrics{}, fmt.Errorf("iterate log severity metrics failed: %w", err)
	}

	errorCount := metrics.SeverityCount["error"]
	warnCount := metrics.SeverityCount["warn"]
	metrics.FailedLogs = metrics.StatusCounts["failed"]
	if metrics.TotalLogs > 0 {
		metrics.ErrorRate = roundFloat(float64(errorCount)/float64(metrics.TotalLogs), 6)
		metrics.WarnRate = roundFloat(float64(warnCount)/float64(metrics.TotalLogs), 6)
		metrics.FailedRate = roundFloat(float64(metrics.FailedLogs)/float64(metrics.TotalLogs), 6)
	}
	metrics.TopActions = topLogItems(actionCounts, 8)
	metrics.TopResources = topLogItems(resourceCounts, 8)
	metrics.AlertRoutes["error"] = LogAlertRoute{
		Policy:       "page_or_webhook",
		Count:        errorCount,
		ThresholdEnv: "ALERT_LOG_ERROR_RATE_THRESHOLD",
	}
	metrics.AlertRoutes["warn"] = LogAlertRoute{
		Policy:       "webhook_or_digest",
		Count:        warnCount,
		ThresholdEnv: "ALERT_LOG_WARN_RATE_THRESHOLD",
	}
	return metrics, nil
}

func (c *Client) GetJobSLOMetrics(ctx context.Context, windowMinutes int) (JobSLOMetrics, error) {
	if c == nil || c.db == nil {
		return JobSLOMetrics{}, errorsNewAdminStoreUninitialized()
	}
	windowMinutes = clampInt(windowMinutes, 5, 10080)
	since := time.Now().UTC().Add(-time.Duration(windowMinutes) * time.Minute)
	rows, err := c.db.QueryContext(ctx, `
		SELECT
			COALESCE(status, 'pending'),
			error_message,
			started_at,
			finished_at
		FROM admin_jobs
		WHERE created_at >= $1
		ORDER BY created_at DESC
	`, since)
	if err != nil {
		return JobSLOMetrics{}, fmt.Errorf("query job slo metrics failed: %w", err)
	}
	defer rows.Close()

	metrics := JobSLOMetrics{
		WindowMinutes: windowMinutes,
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}
	durations := []float64{}
	for rows.Next() {
		var status string
		var errorMessage sql.NullString
		var startedAt sql.NullTime
		var finishedAt sql.NullTime
		if err := rows.Scan(&status, &errorMessage, &startedAt, &finishedAt); err != nil {
			return JobSLOMetrics{}, fmt.Errorf("scan job slo metrics failed: %w", err)
		}
		status = strings.TrimSpace(status)
		metrics.TotalJobs++
		switch status {
		case "succeeded":
			metrics.SucceededJobs++
			if startedAt.Valid && finishedAt.Valid {
				duration := finishedAt.Time.Sub(startedAt.Time)
				if duration >= 0 {
					durations = append(durations, float64(duration)/float64(time.Millisecond))
				}
			}
		case "failed":
			metrics.FailedJobs++
			if errorMessage.Valid && strings.HasPrefix(errorMessage.String, "JobExecutionTimeoutError") {
				metrics.TimeoutFailedJobs++
			}
		case "cancelled":
			metrics.CancelledJobs++
		case "running":
			metrics.RunningJobs++
		case "pending":
			metrics.PendingJobs++
		}
	}
	if err := rows.Err(); err != nil {
		return JobSLOMetrics{}, fmt.Errorf("iterate job slo metrics failed: %w", err)
	}
	if metrics.TotalJobs > 0 {
		metrics.SuccessRate = roundFloat(float64(metrics.SucceededJobs)/float64(metrics.TotalJobs), 6)
		metrics.TimeoutRate = roundFloat(float64(metrics.TimeoutFailedJobs)/float64(metrics.TotalJobs), 6)
	}
	metrics.P95DurationMS = percentileFloats(durations, 0.95)
	metrics.P99DurationMS = percentileFloats(durations, 0.99)
	return metrics, nil
}

type qaQualityBucket struct {
	QAType    string
	Total     int
	Failed    int
	Cited     int
	Citations []float64
	Latencies []float64
}

func errorsNewAdminStoreUninitialized() error {
	return fmt.Errorf("admin store is not initialized")
}

func clampInt(value int, minValue int, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
}

func averageFloats(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return roundFloat(total/float64(len(values)), 3)
}

func percentileFloats(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]float64{}, values...)
	sort.Float64s(ordered)
	pos := int(math.Round(float64(len(ordered)-1) * p))
	if pos < 0 {
		pos = 0
	}
	if pos >= len(ordered) {
		pos = len(ordered) - 1
	}
	return roundFloat(ordered[pos], 3)
}

func topLogItems(values map[string]int, limit int) []LogTopItem {
	items := make([]LogTopItem, 0, len(values))
	for name, count := range values {
		items = append(items, LogTopItem{Name: name, Count: count})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Count != items[j].Count {
			return items[i].Count > items[j].Count
		}
		return items[i].Name < items[j].Name
	})
	if len(items) > limit {
		return items[:limit]
	}
	return items
}

func stringFromNullOrDefault(value sql.NullString, fallback string) string {
	if value.Valid && strings.TrimSpace(value.String) != "" {
		return value.String
	}
	return fallback
}

func firstNonEmptyForStore(value string, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}
