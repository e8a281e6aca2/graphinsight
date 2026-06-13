package httpserver

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"graphinsight/go-backend/internal/config"
	"graphinsight/go-backend/internal/graph"
)

const (
	documentsSoftDeleteDirName = ".trash"
	documentsSoftDeleteMetaExt = ".meta.json"
	defaultSoftDeleteRetention = 7
	documentDryRunPreviewLimit = 20
)

var supportedDocumentExts = map[string]struct{}{
	".txt":      {},
	".md":       {},
	".markdown": {},
	".csv":      {},
	".json":     {},
	".log":      {},
	".docx":     {},
	".pdf":      {},
}

type deletedDocumentMeta struct {
	DocID        string      `json:"doc_id"`
	Name         string      `json:"name"`
	Ext          string      `json:"ext"`
	Size         int64       `json:"size"`
	OriginalPath string      `json:"original_path"`
	TrashPath    string      `json:"trash_path"`
	DeletedAt    int64       `json:"deleted_at"`
	ExpiresAt    int64       `json:"expires_at"`
	PurgeGraph   *bool       `json:"purge_graph"`
	Operator     interface{} `json:"operator"`
}

type deletedDocumentRecord struct {
	Meta     *deletedDocumentMeta
	MetaPath string
}

func buildNativeDocumentsListHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if !guard.allowRequest(w, r, "kb:read") {
			return
		}
		items, err := listActiveDocumentItems(cfg)
		if err != nil {
			logger.Error("list documents failed", "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "获取文档列表失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}
		WriteJSON(w, http.StatusOK, "ok", map[string]interface{}{"items": items})
	})
}

func buildNativeDeletedDocumentsListHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if !guard.allowRequest(w, r, "kb:read") {
			return
		}

		items, err := listDeletedDocumentItems(logger, cfg)
		if err != nil {
			logger.Error("list deleted documents failed", "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "获取回收站列表失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}
		WriteJSON(w, http.StatusOK, "ok", map[string]interface{}{"items": items})
	})
}

func buildNativeDocumentsUploadHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if !guard.allowRequest(w, r, "kb:write") {
			return
		}
		if err := r.ParseMultipartForm(64 << 20); err != nil {
			logger.Error("parse upload form failed", "error", err.Error())
			WriteJSON(w, http.StatusBadRequest, "无效上传请求", map[string]string{"error_code": "INVALID_REQUEST"})
			return
		}

		files := r.MultipartForm.File["files"]
		if len(files) == 0 {
			WriteJSON(w, http.StatusBadRequest, "缺少上传文件", map[string]string{"error_code": "INVALID_REQUEST"})
			return
		}

		docDir, err := ensureDir(cfg.DocumentStoragePath)
		if err != nil {
			logger.Error("ensure document dir failed", "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "上传失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}

		uploaded := make([]map[string]interface{}, 0, len(files))
		skipped := make([]map[string]interface{}, 0)
		for _, header := range files {
			item, skippedItem := saveUploadedDocument(docDir, header)
			if item != nil {
				uploaded = append(uploaded, item)
			}
			if skippedItem != nil {
				skipped = append(skipped, skippedItem)
			}
		}

		WriteJSON(w, http.StatusOK, "上传完成", map[string]interface{}{
			"uploaded": uploaded,
			"skipped":  skipped,
		})
	})
}

func buildNativeDocumentDeleteHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
	graphSvc graphService,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if !guard.allowRequest(w, r, "kb:delete") {
			return
		}

		docID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/documents/"))
		if docID == "" || strings.Contains(docID, "/") {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}

		purgeGraph := parseBoolQuery(r, "purge_graph", true)
		softDelete := parseBoolQuery(r, "soft_delete", true)
		dryRun := parseBoolQuery(r, "dry_run", false)
		verifyAfter := parseBoolQuery(r, "verify_after", true)

		beforeActiveDocs, err := countActiveDocuments(cfg)
		if err != nil {
			logger.Error("count active documents failed", "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}

		filePath, err := findActiveDocumentPathByID(cfg, docID)
		if err != nil {
			logger.Error("find active document failed", "doc_id", docID, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}

		var beforeGraph *graph.DocumentGraphStats
		var graphPreview *graph.DocumentGraphStats
		if purgeGraph {
			if graphSvc == nil {
				WriteJSON(w, http.StatusServiceUnavailable, "图谱服务不可用", map[string]string{"error_code": "DATABASE_UNAVAILABLE"})
				return
			}
			totals, err := graphSvc.GetDocumentGraphTotals(r.Context())
			if err != nil {
				logger.Error("get document graph totals failed", "doc_id", docID, "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			beforeGraph = &totals
			preview, err := graphSvc.PreviewDeleteDocumentGraph(r.Context(), docID)
			if err != nil {
				logger.Error("preview delete document graph failed", "doc_id", docID, "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			graphPreview = &preview
		}

		if dryRun {
			if filePath == "" && !hasGraphChanges(graphPreview) {
				WriteJSON(w, http.StatusNotFound, "文档不存在", map[string]string{"error_code": "NOT_FOUND"})
				return
			}

			var afterGraphEstimate map[string]interface{}
			if beforeGraph != nil && graphPreview != nil {
				afterGraphEstimate = map[string]interface{}{
					"documents": maxInt64(beforeGraph.Documents-graphPreview.Documents, 0),
					"chunks":    maxInt64(beforeGraph.Chunks-graphPreview.Chunks, 0),
					"relations": maxInt64(beforeGraph.Relations-graphPreview.Relations, 0),
				}
			}

			WriteJSON(w, http.StatusOK, "删除预览完成", map[string]interface{}{
				"doc_id":  docID,
				"dry_run": true,
				"mode":    deleteModeName(softDelete),
				"candidate_file": map[string]interface{}{
					"exists": filePath != "",
					"name":   filepath.Base(filePath),
					"path":   filePathOrNil(filePath),
				},
				"graph": graphStatsMap(graphPreview),
				"verification_preview": map[string]interface{}{
					"before_active_documents": beforeActiveDocs,
					"after_active_documents":  maxInt(beforeActiveDocs-boolToInt(filePath != ""), 0),
					"after_graph_estimate":    afterGraphEstimate,
				},
			})
			return
		}

		fileDeleted := false
		fileAction := "none"
		var deletedEntry map[string]interface{}
		if filePath != "" {
			if softDelete {
				entry, err := softDeleteDocumentFile(cfg, filePath, docID, purgeGraph, currentOperator(r))
				if err != nil {
					logger.Error("soft delete document failed", "doc_id", docID, "error", err.Error())
					WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
					return
				}
				deletedEntry = entry
				fileAction = "soft_deleted"
			} else {
				if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
					logger.Error("hard delete document failed", "doc_id", docID, "error", err.Error())
					WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
					return
				}
				fileAction = "hard_deleted"
			}
			fileDeleted = true
		}

		var graphStats *graph.DocumentGraphStats
		if purgeGraph {
			stats, err := graphSvc.DeleteDocumentGraph(r.Context(), docID)
			if err != nil {
				logger.Error("delete document graph failed", "doc_id", docID, "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			graphStats = &stats
		}

		if !fileDeleted && !hasGraphChanges(graphStats) {
			WriteJSON(w, http.StatusNotFound, "文档不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}

		var verification map[string]interface{}
		if verifyAfter {
			afterActiveDocs, err := countActiveDocuments(cfg)
			if err != nil {
				logger.Error("count active documents after delete failed", "doc_id", docID, "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}

			var afterGraph *graph.DocumentGraphStats
			if purgeGraph {
				stats, err := graphSvc.GetDocumentGraphTotals(r.Context())
				if err != nil {
					logger.Error("get document graph totals after delete failed", "doc_id", docID, "error", err.Error())
					WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
					return
				}
				afterGraph = &stats
			}

			deletedCount, err := countDeletedDocuments(logger, cfg)
			if err != nil {
				logger.Error("count deleted documents failed", "doc_id", docID, "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "删除文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			verification = buildDocumentVerification(beforeActiveDocs, afterActiveDocs, deletedCount, beforeGraph, afterGraph)
		}

		WriteJSON(w, http.StatusOK, "删除完成", map[string]interface{}{
			"doc_id":        docID,
			"dry_run":       false,
			"mode":          deleteModeName(softDelete),
			"file_deleted":  fileDeleted,
			"file_action":   fileAction,
			"deleted_entry": deletedEntry,
			"graph":         graphStatsMap(graphStats),
			"verification":  verification,
		})
	})
}

func buildNativeDocumentsClearHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
	graphSvc graphService,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if !guard.allowRequest(w, r, "kb:delete") {
			return
		}

		purgeGraph := parseBoolQuery(r, "purge_graph", true)
		softDelete := parseBoolQuery(r, "soft_delete", true)
		dryRun := parseBoolQuery(r, "dry_run", false)
		verifyAfter := parseBoolQuery(r, "verify_after", true)

		filePaths, err := collectAllActiveDocumentPaths(cfg)
		if err != nil {
			logger.Error("collect active documents failed", "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "清空知识库失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}
		beforeActiveDocs := len(filePaths)

		var beforeGraph *graph.DocumentGraphStats
		var graphPreview *graph.DocumentGraphStats
		if purgeGraph {
			if graphSvc == nil {
				WriteJSON(w, http.StatusServiceUnavailable, "图谱服务不可用", map[string]string{"error_code": "DATABASE_UNAVAILABLE"})
				return
			}
			totals, err := graphSvc.GetDocumentGraphTotals(r.Context())
			if err != nil {
				logger.Error("get document graph totals failed", "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "清空知识库失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			beforeGraph = &totals
			preview, err := graphSvc.PreviewClearDocumentGraph(r.Context())
			if err != nil {
				logger.Error("preview clear document graph failed", "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "清空知识库失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			graphPreview = &preview
		}

		if dryRun {
			namesPreview := make([]string, 0, minInt(len(filePaths), documentDryRunPreviewLimit))
			for _, path := range filePaths[:minInt(len(filePaths), documentDryRunPreviewLimit)] {
				namesPreview = append(namesPreview, filepath.Base(path))
			}
			WriteJSON(w, http.StatusOK, "清空预览完成", map[string]interface{}{
				"dry_run":                 true,
				"mode":                    deleteModeName(softDelete),
				"candidate_files":         beforeActiveDocs,
				"candidate_names_preview": namesPreview,
				"graph":                   graphStatsMap(graphPreview),
			})
			return
		}

		removedFiles := 0
		removedErrors := make([]string, 0)
		deletedEntries := make([]map[string]interface{}, 0)
		for _, filePath := range filePaths {
			docID := makeDocumentID(filePath)
			if softDelete {
				entry, err := softDeleteDocumentFile(cfg, filePath, docID, purgeGraph, currentOperator(r))
				if err != nil {
					removedErrors = append(removedErrors, fmt.Sprintf("%s: %v", filepath.Base(filePath), err))
					logger.Warn("soft delete document during clear failed", "doc_id", docID, "path", filePath, "error", err.Error())
					continue
				}
				deletedEntries = append(deletedEntries, entry)
				removedFiles++
				continue
			}
			if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
				removedErrors = append(removedErrors, fmt.Sprintf("%s: %v", filepath.Base(filePath), err))
				logger.Warn("hard delete document during clear failed", "doc_id", docID, "path", filePath, "error", err.Error())
				continue
			}
			removedFiles++
		}

		var graphStats *graph.DocumentGraphStats
		if purgeGraph {
			stats, err := graphSvc.ClearDocumentGraph(r.Context())
			if err != nil {
				logger.Error("clear document graph failed", "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "清空知识库失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			graphStats = &stats
		}

		var verification map[string]interface{}
		if verifyAfter {
			afterActiveDocs, err := countActiveDocuments(cfg)
			if err != nil {
				logger.Error("count active documents after clear failed", "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "清空知识库失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			var afterGraph *graph.DocumentGraphStats
			if purgeGraph {
				stats, err := graphSvc.GetDocumentGraphTotals(r.Context())
				if err != nil {
					logger.Error("get document graph totals after clear failed", "error", err.Error())
					WriteJSON(w, http.StatusInternalServerError, "清空知识库失败", map[string]string{"error_code": "INTERNAL_ERROR"})
					return
				}
				afterGraph = &stats
			}
			deletedCount, err := countDeletedDocuments(logger, cfg)
			if err != nil {
				logger.Error("count deleted documents after clear failed", "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "清空知识库失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			verification = buildDocumentVerification(beforeActiveDocs, afterActiveDocs, deletedCount, beforeGraph, afterGraph)
		}

		WriteJSON(w, http.StatusOK, "知识库已清空", map[string]interface{}{
			"dry_run":            false,
			"mode":               deleteModeName(softDelete),
			"removed_files":      removedFiles,
			"failed_files":       len(removedErrors),
			"errors_preview":     removedErrors[:minInt(len(removedErrors), documentDryRunPreviewLimit)],
			"soft_deleted_files": len(deletedEntries),
			"graph":              graphStatsMap(graphStats),
			"verification":       verification,
		})
	})
}

func buildNativeDocumentRestoreHandler(
	cfg config.Config,
	logger *slog.Logger,
	guard businessPermissionGuard,
) http.HandlerFunc {
	return withRouteOwner("go-native", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, "Method not allowed", nil)
			return
		}
		if !guard.allowRequest(w, r, "kb:write") {
			return
		}
		if !strings.HasSuffix(r.URL.Path, "/restore") {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}

		docID := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/documents/"), "/restore"))
		if docID == "" || strings.Contains(docID, "/") {
			WriteJSON(w, http.StatusNotFound, "资源不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}

		verifyAfter := parseBoolQuery(r, "verify_after", true)
		record, err := findDeletedDocumentRecordByID(logger, cfg, docID)
		if err != nil {
			logger.Error("find deleted document failed", "doc_id", docID, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}
		if record == nil || record.Meta == nil {
			WriteJSON(w, http.StatusNotFound, "回收站中未找到该文档", map[string]string{"error_code": "NOT_FOUND"})
			return
		}

		trashPath := filepath.Clean(strings.TrimSpace(record.Meta.TrashPath))
		if trashPath == "" {
			WriteJSON(w, http.StatusNotFound, "回收站文件已不存在", map[string]string{"error_code": "NOT_FOUND"})
			return
		}
		if _, err := os.Stat(trashPath); err != nil {
			if os.IsNotExist(err) {
				WriteJSON(w, http.StatusNotFound, "回收站文件已不存在", map[string]string{"error_code": "NOT_FOUND"})
				return
			}
			logger.Error("stat trash file failed", "doc_id", docID, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}

		beforeActiveDocs, err := countActiveDocuments(cfg)
		if err != nil {
			logger.Error("count active documents before restore failed", "doc_id", docID, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}

		targetPath, err := resolveRestoreTargetPath(cfg, record.Meta)
		if err != nil {
			logger.Error("resolve restore target path failed", "doc_id", docID, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			logger.Error("ensure restore target dir failed", "doc_id", docID, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}
		if err := os.Rename(trashPath, targetPath); err != nil {
			logger.Error("restore document move failed", "doc_id", docID, "error", err.Error())
			WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
			return
		}
		_ = os.Remove(record.MetaPath)

		restoredDocID := makeDocumentID(targetPath)
		var verification map[string]interface{}
		if verifyAfter {
			afterActiveDocs, err := countActiveDocuments(cfg)
			if err != nil {
				logger.Error("count active documents after restore failed", "doc_id", docID, "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			deletedCount, err := countDeletedDocuments(logger, cfg)
			if err != nil {
				logger.Error("count deleted documents after restore failed", "doc_id", docID, "error", err.Error())
				WriteJSON(w, http.StatusInternalServerError, "恢复文档失败", map[string]string{"error_code": "INTERNAL_ERROR"})
				return
			}
			verification = buildDocumentVerification(beforeActiveDocs, afterActiveDocs, deletedCount, nil, nil)
		}

		WriteJSON(w, http.StatusOK, "恢复完成", map[string]interface{}{
			"doc_id":          restoredDocID,
			"original_doc_id": docID,
			"restored_name":   filepath.Base(targetPath),
			"restored_path":   targetPath,
			"graph_restored":  false,
			"note":            "仅恢复文档文件，图谱需重新构建",
			"verification":    verification,
		})
	})
}

func listActiveDocumentItems(cfg config.Config) ([]map[string]interface{}, error) {
	roots, err := resolveDocumentRoots(cfg)
	if err != nil {
		return nil, err
	}

	items := make([]map[string]interface{}, 0)
	for _, root := range roots {
		files, err := collectActiveDocumentPaths(root)
		if err != nil {
			return nil, err
		}
		for _, filePath := range files {
			info, err := os.Stat(filePath)
			if err != nil {
				return nil, err
			}
			items = append(items, map[string]interface{}{
				"id":         makeDocumentID(filePath),
				"name":       filepath.Base(filePath),
				"path":       filePath,
				"ext":        strings.ToLower(filepath.Ext(filePath)),
				"size":       info.Size(),
				"updated_at": info.ModTime().UnixMilli(),
			})
		}
	}

	sort.Slice(items, func(i, j int) bool {
		left, _ := items[i]["updated_at"].(int64)
		right, _ := items[j]["updated_at"].(int64)
		return left > right
	})
	return items, nil
}

func listDeletedDocumentItems(logger *slog.Logger, cfg config.Config) ([]map[string]interface{}, error) {
	trashDir, err := ensureTrashDir(cfg)
	if err != nil {
		return nil, err
	}
	metaFiles, err := collectDeletedMetaFiles(trashDir)
	if err != nil {
		return nil, err
	}

	nowMS := time.Now().UnixMilli()
	items := make([]map[string]interface{}, 0, len(metaFiles))
	for _, metaPath := range metaFiles {
		meta, err := loadDeletedDocumentMeta(metaPath)
		if err != nil {
			logger.Warn("load deleted document meta failed", "meta_path", metaPath, "error", err.Error())
			continue
		}
		if meta.DocID == "" {
			continue
		}
		if meta.ExpiresAt > 0 && meta.ExpiresAt <= nowMS {
			cleanupExpiredDeletedItem(logger, metaPath, meta.TrashPath)
			continue
		}
		if strings.TrimSpace(meta.TrashPath) == "" {
			continue
		}
		if _, err := os.Stat(meta.TrashPath); err != nil {
			if os.IsNotExist(err) {
				_ = os.Remove(metaPath)
				continue
			}
			return nil, err
		}

		var remainingMS interface{}
		if meta.ExpiresAt > 0 {
			remaining := meta.ExpiresAt - nowMS
			if remaining < 0 {
				remaining = 0
			}
			remainingMS = remaining
		}

		items = append(items, map[string]interface{}{
			"doc_id":        meta.DocID,
			"name":          firstNonEmpty(meta.Name, filepath.Base(meta.TrashPath)),
			"ext":           firstNonEmpty(meta.Ext, strings.ToLower(filepath.Ext(meta.TrashPath))),
			"size":          meta.Size,
			"original_path": meta.OriginalPath,
			"trash_path":    meta.TrashPath,
			"deleted_at":    meta.DeletedAt,
			"expires_at":    meta.ExpiresAt,
			"remaining_ms":  remainingMS,
			"purge_graph":   deletedMetaPurgeGraph(meta),
			"operator":      meta.Operator,
		})
	}

	sort.Slice(items, func(i, j int) bool {
		left, _ := items[i]["deleted_at"].(int64)
		right, _ := items[j]["deleted_at"].(int64)
		return left > right
	})
	return items, nil
}

func resolveDocumentRoots(cfg config.Config) ([]string, error) {
	primary, err := ensureDir(cfg.DocumentStoragePath)
	if err != nil {
		return nil, err
	}
	roots := []string{primary}

	fallback := filepath.Clean(strings.TrimSpace(cfg.DocumentStorageFallbackPath))
	if fallback == "" {
		return roots, nil
	}
	if fallback == primary {
		return roots, nil
	}
	if info, err := os.Stat(fallback); err == nil && info.IsDir() {
		roots = append(roots, fallback)
	}
	return roots, nil
}

func ensureTrashDir(cfg config.Config) (string, error) {
	primary, err := ensureDir(cfg.DocumentStoragePath)
	if err != nil {
		return "", err
	}
	trashDir := filepath.Join(primary, documentsSoftDeleteDirName)
	if err := os.MkdirAll(trashDir, 0o755); err != nil {
		return "", err
	}
	return trashDir, nil
}

func ensureDir(path string) (string, error) {
	cleaned := filepath.Clean(strings.TrimSpace(path))
	if err := os.MkdirAll(cleaned, 0o755); err != nil {
		return "", err
	}
	return cleaned, nil
}

func collectActiveDocumentPaths(root string) ([]string, error) {
	files := make([]string, 0)
	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == documentsSoftDeleteDirName {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if _, ok := supportedDocumentExts[ext]; !ok {
			return nil
		}
		files = append(files, filepath.Clean(path))
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

func collectDeletedMetaFiles(trashDir string) ([]string, error) {
	files := make([]string, 0)
	err := filepath.WalkDir(trashDir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if strings.HasSuffix(d.Name(), documentsSoftDeleteMetaExt) {
			files = append(files, filepath.Clean(path))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, nil
}

func loadDeletedDocumentMeta(metaPath string) (*deletedDocumentMeta, error) {
	raw, err := os.ReadFile(metaPath)
	if err != nil {
		return nil, err
	}
	var meta deletedDocumentMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil, err
	}
	if meta.TrashPath != "" {
		meta.TrashPath = filepath.Clean(meta.TrashPath)
	}
	if meta.OriginalPath != "" {
		meta.OriginalPath = filepath.Clean(meta.OriginalPath)
	}
	return &meta, nil
}

func cleanupExpiredDeletedItem(logger *slog.Logger, metaPath string, trashPath string) {
	if strings.TrimSpace(trashPath) != "" {
		if err := os.Remove(trashPath); err != nil && !os.IsNotExist(err) {
			logger.Warn("remove expired trash file failed", "trash_path", trashPath, "error", err.Error())
		}
	}
	if err := os.Remove(metaPath); err != nil && !os.IsNotExist(err) {
		logger.Warn("remove expired trash meta failed", "meta_path", metaPath, "error", err.Error())
	}
}

func makeDocumentID(path string) string {
	sum := sha1.Sum([]byte(path))
	return hex.EncodeToString(sum[:])[:12]
}

func firstNonEmpty(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	return fallback
}

func deletedMetaPurgeGraph(meta *deletedDocumentMeta) bool {
	if meta == nil || meta.PurgeGraph == nil {
		return true
	}
	return *meta.PurgeGraph
}

func saveUploadedDocument(docDir string, header *multipart.FileHeader) (map[string]interface{}, map[string]interface{}) {
	filename := safeDocumentFilename("")
	if header != nil {
		filename = safeDocumentFilename(header.Filename)
	}
	if filename == "" {
		name := ""
		if header != nil {
			name = header.Filename
		}
		return nil, map[string]interface{}{"name": name, "reason": "文件名无效"}
	}

	ext := strings.ToLower(filepath.Ext(filename))
	if _, ok := supportedDocumentExts[ext]; !ok {
		return nil, map[string]interface{}{"name": filename, "reason": "不支持的文件类型"}
	}

	if header == nil {
		return nil, map[string]interface{}{"name": filename, "reason": "文件名无效"}
	}

	target := filepath.Join(docDir, filename)
	if _, err := os.Stat(target); err == nil {
		stamp := time.Now().Unix()
		target = filepath.Join(docDir, renameDocumentWithStamp(filename, stamp))
	}

	src, err := header.Open()
	if err != nil {
		return nil, map[string]interface{}{"name": filename, "reason": err.Error()}
	}
	defer src.Close()

	dst, err := os.Create(target)
	if err != nil {
		return nil, map[string]interface{}{"name": filename, "reason": err.Error()}
	}
	if _, err := io.Copy(dst, src); err != nil {
		_ = dst.Close()
		return nil, map[string]interface{}{"name": filename, "reason": err.Error()}
	}
	if err := dst.Close(); err != nil {
		return nil, map[string]interface{}{"name": filename, "reason": err.Error()}
	}

	info, err := os.Stat(target)
	if err != nil {
		return nil, map[string]interface{}{"name": filename, "reason": err.Error()}
	}

	item := map[string]interface{}{
		"id":     makeDocumentID(target),
		"doc_id": makeDocumentID(target),
		"name":   filepath.Base(target),
		"path":   filepath.Clean(target),
		"ext":    ext,
		"size":   info.Size(),
	}
	return item, nil
}

func safeDocumentFilename(name string) string {
	return filepath.Base(strings.TrimSpace(name))
}

func renameDocumentWithStamp(filename string, stamp int64) string {
	ext := filepath.Ext(filename)
	stem := strings.TrimSuffix(filename, ext)
	return stem + "_" + strconv.FormatInt(stamp, 10) + ext
}

func parseBoolQuery(r *http.Request, key string, fallback bool) bool {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func countActiveDocuments(cfg config.Config) (int, error) {
	items, err := listActiveDocumentItems(cfg)
	if err != nil {
		return 0, err
	}
	return len(items), nil
}

func countDeletedDocuments(logger *slog.Logger, cfg config.Config) (int, error) {
	items, err := listDeletedDocumentItems(logger, cfg)
	if err != nil {
		return 0, err
	}
	return len(items), nil
}

func collectAllActiveDocumentPaths(cfg config.Config) ([]string, error) {
	roots, err := resolveDocumentRoots(cfg)
	if err != nil {
		return nil, err
	}
	files := make([]string, 0)
	for _, root := range roots {
		items, err := collectActiveDocumentPaths(root)
		if err != nil {
			return nil, err
		}
		files = append(files, items...)
	}
	sort.Strings(files)
	return files, nil
}

func findActiveDocumentPathByID(cfg config.Config, docID string) (string, error) {
	roots, err := resolveDocumentRoots(cfg)
	if err != nil {
		return "", err
	}
	for _, root := range roots {
		files, err := collectActiveDocumentPaths(root)
		if err != nil {
			return "", err
		}
		for _, path := range files {
			if makeDocumentID(path) == docID {
				return path, nil
			}
		}
	}
	return "", nil
}

func findDeletedDocumentRecordByID(logger *slog.Logger, cfg config.Config, docID string) (*deletedDocumentRecord, error) {
	trashDir, err := ensureTrashDir(cfg)
	if err != nil {
		return nil, err
	}
	metaFiles, err := collectDeletedMetaFiles(trashDir)
	if err != nil {
		return nil, err
	}
	nowMS := time.Now().UnixMilli()
	for _, metaPath := range metaFiles {
		meta, err := loadDeletedDocumentMeta(metaPath)
		if err != nil {
			logger.Warn("load deleted document meta failed", "meta_path", metaPath, "error", err.Error())
			continue
		}
		if meta == nil || strings.TrimSpace(meta.DocID) != docID {
			continue
		}
		if meta.ExpiresAt > 0 && meta.ExpiresAt <= nowMS {
			cleanupExpiredDeletedItem(logger, metaPath, meta.TrashPath)
			continue
		}
		return &deletedDocumentRecord{Meta: meta, MetaPath: metaPath}, nil
	}
	return nil, nil
}

func softDeleteDocumentFile(
	cfg config.Config,
	filePath string,
	docID string,
	purgeGraph bool,
	operator string,
) (map[string]interface{}, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return nil, err
	}
	trashDir, err := ensureTrashDir(cfg)
	if err != nil {
		return nil, err
	}
	deletedAt := time.Now().UnixMilli()
	expiresAt := deletedAt + int64(softDeleteRetentionDays())*24*60*60*1000
	suffix := strings.ToLower(filepath.Ext(filePath))
	trashPath := filepath.Join(trashDir, fmt.Sprintf("%s_%d%s", docID, deletedAt, suffix))
	for idx := 1; ; idx++ {
		if _, err := os.Stat(trashPath); os.IsNotExist(err) {
			break
		}
		trashPath = filepath.Join(trashDir, fmt.Sprintf("%s_%d_%d%s", docID, deletedAt, idx, suffix))
	}
	metaPath := trashPath + documentsSoftDeleteMetaExt
	if err := os.Rename(filePath, trashPath); err != nil {
		return nil, err
	}

	meta := deletedDocumentMeta{
		DocID:        docID,
		Name:         filepath.Base(filePath),
		Ext:          suffix,
		Size:         info.Size(),
		OriginalPath: filepath.Clean(filePath),
		TrashPath:    filepath.Clean(trashPath),
		DeletedAt:    deletedAt,
		ExpiresAt:    expiresAt,
		PurgeGraph:   boolPtr(purgeGraph),
	}
	if strings.TrimSpace(operator) != "" {
		meta.Operator = operator
	}
	raw, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		_ = os.Rename(trashPath, filePath)
		return nil, err
	}
	if err := os.WriteFile(metaPath, raw, 0o644); err != nil {
		_ = os.Rename(trashPath, filePath)
		return nil, err
	}

	return map[string]interface{}{
		"doc_id":        meta.DocID,
		"name":          meta.Name,
		"ext":           meta.Ext,
		"size":          meta.Size,
		"original_path": meta.OriginalPath,
		"trash_path":    meta.TrashPath,
		"deleted_at":    meta.DeletedAt,
		"expires_at":    meta.ExpiresAt,
		"purge_graph":   deletedMetaPurgeGraph(&meta),
		"operator":      meta.Operator,
	}, nil
}

func softDeleteRetentionDays() int {
	raw := strings.TrimSpace(os.Getenv("DOC_SOFT_DELETE_RETENTION_DAYS"))
	if raw == "" {
		return defaultSoftDeleteRetention
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 {
		return defaultSoftDeleteRetention
	}
	return value
}

func resolveRestoreTargetPath(cfg config.Config, meta *deletedDocumentMeta) (string, error) {
	primary, err := ensureDir(cfg.DocumentStoragePath)
	if err != nil {
		return "", err
	}
	target := filepath.Clean(strings.TrimSpace(meta.OriginalPath))
	roots, err := resolveDocumentRoots(cfg)
	if err != nil {
		return "", err
	}
	if target == "" || !pathWithinAnyRoot(target, roots) {
		target = filepath.Join(primary, firstNonEmpty(meta.Name, filepath.Base(meta.TrashPath)))
	}
	if _, err := os.Stat(target); err == nil {
		stamp := time.Now().Unix()
		target = filepath.Join(filepath.Dir(target), renameDocumentWithStamp(filepath.Base(target), stamp))
	}
	return filepath.Clean(target), nil
}

func pathWithinAnyRoot(target string, roots []string) bool {
	cleaned := filepath.Clean(strings.TrimSpace(target))
	if cleaned == "" {
		return false
	}
	for _, root := range roots {
		rel, err := filepath.Rel(filepath.Clean(root), cleaned)
		if err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func buildDocumentVerification(
	beforeActiveDocs int,
	afterActiveDocs int,
	deletedDocuments int,
	beforeGraph *graph.DocumentGraphStats,
	afterGraph *graph.DocumentGraphStats,
) map[string]interface{} {
	checks := map[string]interface{}{
		"active_documents_non_increase": afterActiveDocs <= beforeActiveDocs,
		"active_documents_delta":        afterActiveDocs - beforeActiveDocs,
	}
	if beforeGraph != nil && afterGraph != nil {
		checks["graph_documents_non_increase"] = afterGraph.Documents <= beforeGraph.Documents
		checks["graph_documents_delta"] = afterGraph.Documents - beforeGraph.Documents
		checks["graph_chunks_non_increase"] = afterGraph.Chunks <= beforeGraph.Chunks
		checks["graph_chunks_delta"] = afterGraph.Chunks - beforeGraph.Chunks
		checks["graph_relations_non_increase"] = afterGraph.Relations <= beforeGraph.Relations
		checks["graph_relations_delta"] = afterGraph.Relations - beforeGraph.Relations
	}
	return map[string]interface{}{
		"before": map[string]interface{}{
			"active_documents": beforeActiveDocs,
			"graph":            graphStatsMap(beforeGraph),
		},
		"after": map[string]interface{}{
			"active_documents":  afterActiveDocs,
			"deleted_documents": deletedDocuments,
			"graph":             graphStatsMap(afterGraph),
		},
		"checks": checks,
	}
}

func graphStatsMap(stats *graph.DocumentGraphStats) map[string]interface{} {
	if stats == nil {
		return nil
	}
	result := map[string]interface{}{
		"documents":       stats.Documents,
		"chunks":          stats.Chunks,
		"relations":       stats.Relations,
		"orphan_entities": stats.OrphanEntities,
	}
	if stats.Entities > 0 {
		result["entities"] = stats.Entities
	}
	return result
}

func hasGraphChanges(stats *graph.DocumentGraphStats) bool {
	if stats == nil {
		return false
	}
	return stats.Documents > 0 || stats.Chunks > 0 || stats.Relations > 0 || stats.OrphanEntities > 0
}

func currentOperator(r *http.Request) string {
	if r == nil {
		return ""
	}
	if value := strings.TrimSpace(r.Header.Get("x-auth-user-email")); value != "" {
		return value
	}
	return strings.TrimSpace(r.Header.Get("x-auth-user-name"))
}

func deleteModeName(softDelete bool) string {
	if softDelete {
		return "soft_delete"
	}
	return "hard_delete"
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func maxInt64(left int64, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}

func filePathOrNil(path string) interface{} {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	return path
}

func boolPtr(value bool) *bool {
	v := value
	return &v
}
