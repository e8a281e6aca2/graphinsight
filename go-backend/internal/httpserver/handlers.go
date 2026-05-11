package httpserver

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"graphinsight/go-backend/internal/authz"
	"graphinsight/go-backend/internal/config"
	"graphinsight/go-backend/internal/graph"
	"graphinsight/go-backend/internal/orchestrator"
	"graphinsight/go-backend/internal/proxy"
)

func registerRoutes(
	mux *http.ServeMux,
	cfg config.Config,
	logger *slog.Logger,
	graphSvc graphService,
	graphInitErr error,
	proxyClient *proxy.Client,
	proxyInitErr error,
	authzClient *authz.Client,
	authzInitErr error,
	orchestratorClient *orchestrator.Client,
	orchestratorInitErr error,
) {
	guard := newBusinessPermissionGuard(cfg, logger, authzClient, authzInitErr)
	idempotencyStore := newIdempotencyStore(time.Duration(cfg.IdempotencyCacheTTLSeconds) * time.Second)
	orchestratorMetrics := newOrchestratorMetrics()

	mux.HandleFunc("/", withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
		WriteJSON(w, http.StatusOK, "欢迎使用 GraphInsight Go API", map[string]interface{}{
			"name":    cfg.AppName,
			"version": cfg.Version,
			"status":  "running",
			"docs":    "/docs",
		})
	}))

	mux.HandleFunc("/health", withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		data := map[string]interface{}{
			"status":  "healthy",
			"service": cfg.AppName,
			"version": cfg.Version,
		}
		if graphInitErr != nil {
			data["neo4j"] = map[string]interface{}{
				"connected":        false,
				"error":            graphInitErr.Error(),
				"config_mode":      cfg.Neo4jConfigSource,
				"config_source":    cfg.Neo4jConfigResolvedSource,
				"resolution_error": cfg.Neo4jConfigResolutionErr,
			}
		} else {
			data["neo4j"] = map[string]interface{}{
				"connected":     true,
				"uri":           cfg.Neo4jURI,
				"database":      cfg.Neo4jDatabase,
				"config_mode":   cfg.Neo4jConfigSource,
				"config_source": cfg.Neo4jConfigResolvedSource,
			}
		}
		if proxyInitErr != nil {
			data["python_backend"] = map[string]interface{}{"connected": false, "error": proxyInitErr.Error(), "base_url": cfg.PythonBackendBaseURL}
		} else {
			data["python_backend"] = map[string]interface{}{"connected": true, "base_url": cfg.PythonBackendBaseURL}
		}
		if authzInitErr != nil {
			data["authz"] = map[string]interface{}{
				"connected":                     false,
				"error":                         authzInitErr.Error(),
				"enforce_business_api":          cfg.RBACEnforceBusinessAPI,
				"permission_check_via_upstream": true,
			}
		} else {
			data["authz"] = map[string]interface{}{
				"connected":                     true,
				"enforce_business_api":          cfg.RBACEnforceBusinessAPI,
				"permission_check_via_upstream": true,
			}
		}
		if orchestratorInitErr != nil {
			data["orchestrator"] = map[string]interface{}{
				"connected":        false,
				"error":            orchestratorInitErr.Error(),
				"base_url":         cfg.PythonBackendBaseURL,
				"safe_retry_docqa": cfg.OrchestratorSafeRetryDocQA,
			}
		} else {
			data["orchestrator"] = map[string]interface{}{
				"connected":        true,
				"base_url":         cfg.PythonBackendBaseURL,
				"safe_retry_docqa": cfg.OrchestratorSafeRetryDocQA,
			}
		}
		data["orchestrator_metrics"] = orchestratorMetrics.HealthSummary()
		WriteJSON(w, http.StatusOK, "服务正常", data)
	}))

	registerNativeGraphRoutes(mux, logger, graphSvc, graphInitErr, guard)
	registerOrchestratedBusinessRoutes(
		mux,
		cfg,
		logger,
		orchestratorClient,
		orchestratorInitErr,
		orchestratorMetrics,
		idempotencyStore,
		guard,
	)
	registerAdminOwnedProxyRoutes(mux, logger, proxyClient, proxyInitErr, guard)
	registerLegacyPythonProxyRoutes(mux, logger, proxyClient, proxyInitErr)
}

func registerNativeGraphRoutes(
	mux *http.ServeMux,
	logger *slog.Logger,
	graphSvc graphService,
	graphInitErr error,
	guard businessPermissionGuard,
) {
	mux.HandleFunc("/api/query", withRouteOwner("go-native", guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if graphSvc == nil {
			logger.Error("query failed: graph service unavailable", "init_error", graphInitErr)
			writeGraphError(w, http.StatusServiceUnavailable, map[string]interface{}{
				"error":   "Database unavailable",
				"code":    "DATABASE_UNAVAILABLE",
				"message": "Cannot connect to Neo4j database",
			})
			return
		}

		var req graph.QueryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeGraphError(w, http.StatusBadRequest, map[string]interface{}{
				"error":   "Invalid request body",
				"code":    "INVALID_REQUEST",
				"message": err.Error(),
			})
			return
		}

		resp, err := graphSvc.ExecuteQuery(r.Context(), req.Cypher, req.Parameters)
		if err != nil {
			status, body := graph.ClassifyQueryError(err)
			logger.Warn("query failed", "status", status, "error", err.Error())
			writeGraphError(w, status, body)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})))

	mux.HandleFunc("/api/expand", withRouteOwner("go-native", guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if graphSvc == nil {
			logger.Error("expand failed: graph service unavailable", "init_error", graphInitErr)
			writeGraphError(w, http.StatusServiceUnavailable, map[string]interface{}{
				"error":   "Database unavailable",
				"code":    "DATABASE_UNAVAILABLE",
				"message": "Cannot connect to Neo4j database",
			})
			return
		}

		var req graph.ExpandRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeGraphError(w, http.StatusBadRequest, map[string]interface{}{
				"error":   "Invalid request body",
				"code":    "INVALID_REQUEST",
				"message": err.Error(),
			})
			return
		}

		resp, err := graphSvc.ExpandNode(r.Context(), req)
		if err != nil {
			status, body := graph.ClassifyQueryError(err)
			logger.Warn("expand failed", "status", status, "error", err.Error())
			writeGraphError(w, status, body)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})))

	mux.HandleFunc("/api/node/", withRouteOwner("go-native", guard.wrap("graph:read", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if graphSvc == nil {
			logger.Error("node detail failed: graph service unavailable", "init_error", graphInitErr)
			writeGraphError(w, http.StatusServiceUnavailable, map[string]interface{}{
				"error":   "Database unavailable",
				"code":    "DATABASE_UNAVAILABLE",
				"message": "Cannot connect to Neo4j database",
			})
			return
		}

		nodeID := strings.TrimPrefix(r.URL.Path, "/api/node/")
		resp, err := graphSvc.GetNodeDetail(r.Context(), nodeID)
		if err != nil {
			if errors.Is(err, graph.ErrNodeNotFound) {
				writeGraphError(w, http.StatusNotFound, map[string]interface{}{
					"error":   "Node not found",
					"code":    "NODE_NOT_FOUND",
					"message": "Node with ID " + nodeID + " does not exist",
				})
				return
			}
			status, body := graph.ClassifyQueryError(err)
			logger.Warn("node detail failed", "status", status, "error", err.Error())
			writeGraphError(w, status, body)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	})))
}

func registerOrchestratedBusinessRoutes(
	mux *http.ServeMux,
	cfg config.Config,
	logger *slog.Logger,
	orchestratorClient *orchestrator.Client,
	orchestratorInitErr error,
	orchestratorMetrics *orchestratorMetrics,
	idempotencyStore *idempotencyStore,
	guard businessPermissionGuard,
) {
	mux.HandleFunc("/api/docqa", guard.wrap("qa:ask", buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, cfg.OrchestratorSafeRetryDocQA, http.MethodPost, "/api/docqa",
	)))
	mux.HandleFunc("/api/docqa/deep-research", guard.wrap("qa:ask", buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, cfg.OrchestratorSafeRetryDocQA, http.MethodPost, "/api/docqa/deep-research",
	)))
	mux.HandleFunc("/api/docqa/health", guard.wrap("monitor:read", buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, false, http.MethodGet, "/api/docqa/health",
	)))
	mux.HandleFunc("/api/nl2cypher", guard.wrap("nl2cypher:use", buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, false, http.MethodPost, "/api/nl2cypher",
	)))
	mux.HandleFunc("/api/nl2cypher/examples", buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, false, http.MethodGet, "/api/nl2cypher/examples",
	))
	mux.HandleFunc("/api/nl2cypher/status", guard.wrap("config:read", buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, false, http.MethodGet, "/api/nl2cypher/status",
	)))
	mux.HandleFunc("/api/graph/build", guard.wrap("graph:build", buildOrchestratorIdempotentJSONHandler(
		logger,
		orchestratorClient,
		orchestratorInitErr,
		idempotencyStore,
		orchestratorMetrics,
		time.Duration(cfg.GraphBuildTimeoutSeconds)*time.Second,
		http.MethodPost,
		"/api/graph/build",
	)))
	documentsListHandler := buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, false, http.MethodGet, "/api/documents",
	)
	documentsDeletedListHandler := buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, false, http.MethodGet, "/api/documents/deleted",
	)
	documentsClearHandler := buildOrchestratorHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, false, http.MethodDelete, "/api/documents",
	)
	documentDeleteHandler := buildOrchestratorPassthroughPathHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, http.MethodDelete, "/api/documents/",
	)
	documentRestoreHandler := buildOrchestratorPassthroughPathHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, http.MethodPost, "/api/documents/",
	)
	mux.HandleFunc("/api/documents", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			if !guard.allowRequest(w, r, "kb:read") {
				return
			}
			documentsListHandler(w, r)
		case http.MethodDelete:
			if !guard.allowRequest(w, r, "kb:delete") {
				return
			}
			documentsClearHandler(w, r)
		default:
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		}
	})
	mux.HandleFunc("/api/documents/deleted", func(w http.ResponseWriter, r *http.Request) {
		if !guard.allowRequest(w, r, "kb:read") {
			return
		}
		documentsDeletedListHandler(w, r)
	})
	mux.HandleFunc("/api/documents/", func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/restore"):
			if !guard.allowRequest(w, r, "kb:write") {
				return
			}
			documentRestoreHandler(w, r)
		case r.Method == http.MethodDelete:
			if !guard.allowRequest(w, r, "kb:delete") {
				return
			}
			documentDeleteHandler(w, r)
		default:
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
		}
	})
	mux.HandleFunc("/api/documents/upload", guard.wrap("kb:write", buildOrchestratorUploadHandler(
		logger, orchestratorClient, orchestratorInitErr, orchestratorMetrics, http.MethodPost, "/api/documents/upload",
	)))
	mux.HandleFunc("/api/monitor/orchestrator", guard.wrap("monitor:read", func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, "go-native")
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		WriteJSON(w, http.StatusOK, "获取编排指标成功", orchestratorMetrics.Snapshot())
	}))
}

func registerLegacyPythonProxyRoutes(
	mux *http.ServeMux,
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
) {
	registerProxyRoute(mux, logger, proxyClient, proxyInitErr, "/api/media")
	registerProxyRoute(mux, logger, proxyClient, proxyInitErr, "/api/media/")
	registerProxyRoute(mux, logger, proxyClient, proxyInitErr, "/api/v1")
	registerProxyRoute(mux, logger, proxyClient, proxyInitErr, "/api/v1/")
}

func registerProxyRoute(mux *http.ServeMux, logger *slog.Logger, proxyClient *proxy.Client, proxyInitErr error, path string) {
	mux.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, "python-proxy")
		if proxyClient == nil {
			logger.Error("proxy failed: client unavailable", "path", r.URL.Path, "init_error", proxyInitErr)
			WriteJSON(w, http.StatusServiceUnavailable, "上游服务不可用", map[string]interface{}{
				"error_code": "UPSTREAM_UNAVAILABLE",
				"upstream":   "python-backend",
			})
			return
		}
		if err := proxyClient.Proxy(w, r); err != nil {
			logger.Error("proxy request failed", "path", r.URL.Path, "error", err.Error())
			WriteJSON(w, http.StatusBadGateway, "上游请求失败", map[string]interface{}{
				"error_code": "UPSTREAM_REQUEST_FAILED",
				"upstream":   "python-backend",
				"message":    err.Error(),
			})
			return
		}
	})
}

func registerAdminOwnedProxyRoutes(
	mux *http.ServeMux,
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) {
	registerAdminStaticRoute(mux, logger, proxyClient, proxyInitErr, guard, "/api/v1/admin/auth/login", "", http.MethodPost)
	registerAdminStaticRoute(mux, logger, proxyClient, proxyInitErr, guard, "/api/v1/admin/auth/register", "", http.MethodPost)
	registerAdminStaticRoute(mux, logger, proxyClient, proxyInitErr, guard, "/api/v1/admin/auth/logout", "", http.MethodPost)
	registerAdminStaticRoute(mux, logger, proxyClient, proxyInitErr, guard, "/api/v1/admin/auth/profile", "", http.MethodGet)
	registerAdminStaticRoute(mux, logger, proxyClient, proxyInitErr, guard, "/api/v1/admin/auth/change-password", "", http.MethodPost)
	registerAdminStaticRoute(mux, logger, proxyClient, proxyInitErr, guard, "/api/v1/admin/auth/authorize", "", http.MethodGet)

	mux.HandleFunc("/api/v1/admin/monitor/stats", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/monitor/health", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/monitor/performance", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/monitor/qa", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/monitor/slo", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/monitor/log-severity", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/monitor/alerts/check", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/monitor/health/simple", buildAdminMonitorHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin/jobs", buildAdminJobsHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/jobs/", buildAdminJobsHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin/qa-traces", buildAdminQATracesHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/qa-traces/", buildAdminQATracesHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin/config", buildAdminConfigHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/config/", buildAdminConfigHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin/logs", buildAdminLogsHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/logs/", buildAdminLogsHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin/rbac/roles", buildAdminRbacCatalogHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/rbac/permissions", buildAdminRbacCatalogHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/rbac/bindings", buildAdminRbacBindingsHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/rbac/bindings/", buildAdminRbacBindingsHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin/users", buildAdminUsersRootHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/users/", buildAdminUsersSubtreeHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin/profile", buildAdminProfileHandler(logger, proxyClient, proxyInitErr, guard))
	mux.HandleFunc("/api/v1/admin/profile/", buildAdminProfileHandler(logger, proxyClient, proxyInitErr, guard))

	mux.HandleFunc("/api/v1/admin", buildUnknownAdminHandler())
	mux.HandleFunc("/api/v1/admin/", buildUnknownAdminHandler())
}

func buildUnknownAdminHandler() http.HandlerFunc {
	return withRouteOwner("go-admin-proxy", func(w http.ResponseWriter, r *http.Request) {
		WriteJSON(w, http.StatusNotFound, "Not found", map[string]string{"error_code": "NOT_FOUND"})
	})
}

func buildAdminJobsHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/admin/jobs":
			permission := "job:read"
			if r.Method == http.MethodPost {
				permission = "job:manage"
			}
			buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, r.Method)(w, r)
			return
		case "/api/v1/admin/jobs/build-graph", "/api/v1/admin/jobs/clear-kb", "/api/v1/admin/jobs/reindex":
			if r.Method != http.MethodPost {
				WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
				return
			}
			buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", "job:manage", http.MethodPost)(w, r)
			return
		default:
			if strings.HasPrefix(r.URL.Path, "/api/v1/admin/jobs/") {
				permission := "job:read"
				switch r.Method {
				case http.MethodGet:
				case http.MethodPost:
					permission = "job:manage"
				default:
					WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
					return
				}
				buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, r.Method)(w, r)
				return
			}
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
	}
}

func buildAdminMonitorHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		permission := "monitor:read"
		method := http.MethodGet

		switch r.URL.Path {
		case "/api/v1/admin/monitor/alerts/check":
			method = http.MethodPost
		case "/api/v1/admin/monitor/health/simple":
			permission = ""
		case "/api/v1/admin/monitor/stats",
			"/api/v1/admin/monitor/health",
			"/api/v1/admin/monitor/performance",
			"/api/v1/admin/monitor/qa",
			"/api/v1/admin/monitor/slo",
			"/api/v1/admin/monitor/log-severity":
		default:
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}

		buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, method)(w, r)
	}
}

func buildAdminQATracesHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", "monitor:read", http.MethodGet)(w, r)
	}
}

func buildAdminConfigHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/admin/config":
			permission := "config:read"
			if r.Method != http.MethodGet {
				permission = "config:write"
			}
			buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, r.Method)(w, r)
			return
		default:
			if strings.HasPrefix(r.URL.Path, "/api/v1/admin/config/") {
				permission := "config:read"
				if r.Method != http.MethodGet {
					permission = "config:write"
				}
				buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, r.Method)(w, r)
				return
			}
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
	}
}

func buildAdminLogsHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/admin/logs":
			permission := "logs:read"
			if r.Method == http.MethodDelete {
				permission = "logs:clean"
			}
			buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, r.Method)(w, r)
			return
		default:
			if strings.HasPrefix(r.URL.Path, "/api/v1/admin/logs/") {
				permission := "logs:read"
				if r.Method == http.MethodDelete {
					permission = "logs:clean"
				}
				buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, r.Method)(w, r)
				return
			}
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
	}
}

func buildAdminRbacBindingsHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/admin/rbac/bindings" && !strings.HasPrefix(r.URL.Path, "/api/v1/admin/rbac/bindings/") {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
		permission := "user:manage"
		switch r.Method {
		case http.MethodGet, http.MethodPost, http.MethodDelete:
		default:
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, r.Method)(w, r)
	}
}

func buildAdminRbacCatalogHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/admin/rbac/roles", "/api/v1/admin/rbac/permissions":
		default:
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", "user:manage", http.MethodGet)(w, r)
	}
}

func buildAdminUsersRootHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/admin/users" {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
		switch r.Method {
		case http.MethodGet, http.MethodPost:
		default:
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", "user:manage", r.Method)(w, r)
	}
}

func buildAdminUsersSubtreeHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/admin/users/") {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
		switch r.Method {
		case http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete:
		default:
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", "user:manage", r.Method)(w, r)
	}
}

func buildAdminProfileHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/admin/profile" && r.URL.Path != "/api/v1/admin/profile/" {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
		switch r.Method {
		case http.MethodGet, http.MethodPut:
		default:
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", "", r.Method)(w, r)
	}
}

func registerAdminStaticRoute(
	mux *http.ServeMux,
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
	path string,
	permission string,
	method string,
) {
	mux.HandleFunc(path, buildAdminProxyHandler(logger, proxyClient, proxyInitErr, guard, "go-admin-proxy", permission, method))
}

func buildAdminProxyHandler(
	logger *slog.Logger,
	proxyClient *proxy.Client,
	proxyInitErr error,
	guard businessPermissionGuard,
	owner string,
	permission string,
	method string,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		markRouteOwner(w, owner)
		if r.Method != method {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if permission != "" && !guard.allowRequest(w, r, permission) {
			return
		}
		if proxyClient == nil {
			logger.Error("admin proxy failed: client unavailable", "path", r.URL.Path, "init_error", proxyInitErr)
			WriteJSON(w, http.StatusServiceUnavailable, "上游服务不可用", map[string]interface{}{
				"error_code": "UPSTREAM_UNAVAILABLE",
				"upstream":   "python-backend",
			})
			return
		}
		if err := proxyClient.Proxy(w, r); err != nil {
			logger.Error("admin proxy request failed", "path", r.URL.Path, "error", err.Error())
			WriteJSON(w, http.StatusBadGateway, "上游请求失败", map[string]interface{}{
				"error_code": "UPSTREAM_REQUEST_FAILED",
				"upstream":   "python-backend",
				"message":    err.Error(),
			})
			return
		}
	}
}

func writeGraphError(w http.ResponseWriter, status int, payload map[string]interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
