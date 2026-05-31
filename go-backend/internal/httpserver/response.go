package httpserver

import (
	"encoding/json"
	"net/http"
	"time"
)

const routeOwnerHeader = "X-GraphInsight-Route-Owner"

type APIResponse struct {
	Code      int         `json:"code"`
	Message   string      `json:"message"`
	Data      interface{} `json:"data,omitempty"`
	Timestamp string      `json:"timestamp"`
	TraceID   string      `json:"trace_id,omitempty"`
}

func markRouteOwner(w http.ResponseWriter, owner string) {
	if owner == "" {
		return
	}
	w.Header().Set(routeOwnerHeader, owner)
}

func withRouteOwner(owner string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, owner)
		next(w, r)
	}
}

func WriteJSON(w http.ResponseWriter, status int, message string, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(APIResponse{
		Code:      status,
		Message:   message,
		Data:      data,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		TraceID:   w.Header().Get(traceHeader),
	})
}
