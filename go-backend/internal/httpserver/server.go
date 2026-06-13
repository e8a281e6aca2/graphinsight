package httpserver

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"graphinsight/go-backend/internal/adminstore"
	"graphinsight/go-backend/internal/config"
	"graphinsight/go-backend/internal/graph"
	"graphinsight/go-backend/internal/orchestrator"
	"graphinsight/go-backend/internal/proxy"
)

type Server struct {
	cfg          config.Config
	logger       *slog.Logger
	httpServer   *http.Server
	graphService *graph.Service
	adminStore   *adminstore.Client
}

func New(cfg config.Config, logger *slog.Logger) *Server {
	mux := http.NewServeMux()
	apiMetrics := newAPIMetrics(5000)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	graphSvc, graphInitErr := graph.NewService(ctx, cfg, logger)
	if graphInitErr != nil {
		logger.Warn("neo4j init failed, query endpoint will return 503", "error", graphInitErr.Error())
	}

	proxyClient, proxyInitErr := proxy.New(cfg)
	if proxyInitErr != nil {
		logger.Warn("python proxy init failed, extraction routes will return 503", "error", proxyInitErr.Error())
	}

	adminStore, adminStoreErr := adminstore.New(cfg)
	if adminStoreErr != nil {
		logger.Warn("admin store init failed, rbac native reads may return 503", "error", adminStoreErr.Error())
	} else {
		adminCtx, adminCancel := context.WithTimeout(context.Background(), 3*time.Second)
		if err := adminStore.CheckHealth(adminCtx); err != nil {
			logger.Warn("admin store health check failed, rbac native reads may return 503", "error", err.Error())
		}
		adminCancel()
	}

	orchestratorClient, orchestratorInitErr := orchestrator.New(cfg)
	if orchestratorInitErr != nil {
		logger.Warn("orchestrator client init failed, orchestrated routes may degrade", "error", orchestratorInitErr.Error())
	}

	registerRoutes(
		mux,
		cfg,
		logger,
		graphSvc,
		graphInitErr,
		proxyClient,
		proxyInitErr,
		orchestratorClient,
		orchestratorInitErr,
		adminStore,
		apiMetrics,
	)

	handler := CORS(cfg.AllowedOrigins, mux)
	handler = RequestLogging(logger, handler, apiMetrics)
	handler = Recovery(logger, handler)
	handler = Trace(handler)

	httpServer := &http.Server{
		Addr:              cfg.Addr(),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      time.Duration(cfg.HTTPWriteTimeoutSeconds) * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	if httpServer.WriteTimeout <= 0 {
		httpServer.WriteTimeout = 300 * time.Second
	}

	return &Server{
		cfg:          cfg,
		logger:       logger,
		httpServer:   httpServer,
		graphService: graphSvc,
		adminStore:   adminStore,
	}
}

func (s *Server) Start() error {
	s.logger.Info("go api starting", "addr", s.cfg.Addr(), "service", s.cfg.AppName, "version", s.cfg.Version)
	err := s.httpServer.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("http listen failed: %w", err)
	}
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("go api shutting down")
	if s.graphService != nil {
		if err := s.graphService.Close(ctx); err != nil {
			s.logger.Warn("close neo4j failed", "error", err.Error())
		}
	}
	if s.adminStore != nil {
		if err := s.adminStore.Close(); err != nil {
			s.logger.Warn("close admin store failed", "error", err.Error())
		}
	}
	return s.httpServer.Shutdown(ctx)
}
