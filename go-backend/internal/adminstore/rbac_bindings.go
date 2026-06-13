package adminstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var ErrRbacUserNotFound = errors.New("rbac user not found")
var ErrRbacRoleNotFound = errors.New("rbac role not found")
var ErrRbacBindingNotFound = errors.New("rbac binding not found")

type RbacBindingMutationRequest struct {
	UserID     int
	RoleName   string
	ScopeType  string
	TenantID   *string
	ProjectID  *string
	KBID       *string
	ExpiresAt  *time.Time
	OperatorID *int
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type RbacBindingDeleteRequest struct {
	BindingID  int
	OperatorID *int
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

func (c *Client) CreateRbacBinding(ctx context.Context, req RbacBindingMutationRequest) (RbacBinding, error) {
	if c == nil || c.db == nil {
		return RbacBinding{}, errors.New("admin store is not initialized")
	}
	req.RoleName = strings.TrimSpace(req.RoleName)
	req.ScopeType = normalizeRbacScopeType(req.ScopeType)
	if req.UserID <= 0 || req.RoleName == "" || !isAllowedRbacScopeType(req.ScopeType) {
		return RbacBinding{}, fmt.Errorf("invalid rbac binding request")
	}
	if !rbacScopeFieldsValid(req) {
		return RbacBinding{}, fmt.Errorf("invalid rbac binding scope")
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return RbacBinding{}, fmt.Errorf("begin rbac binding create transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	user, err := getRbacBindingUser(ctx, tx, req.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return RbacBinding{}, ErrRbacUserNotFound
	}
	if err != nil {
		return RbacBinding{}, err
	}

	roleID, err := getRbacRoleIDByName(ctx, tx, req.RoleName)
	if errors.Is(err, sql.ErrNoRows) {
		return RbacBinding{}, ErrRbacRoleNotFound
	}
	if err != nil {
		return RbacBinding{}, err
	}

	existing, err := findRbacBinding(ctx, tx, req.UserID, roleID, req.ScopeType, req.TenantID, req.ProjectID, req.KBID)
	if err == nil {
		existing.Username = &user.Username
		existing.Email = &user.Email
		existing.RoleName = req.RoleName
		return existing, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return RbacBinding{}, err
	}

	row := tx.QueryRowContext(ctx, `
		INSERT INTO admin_user_role_bindings (
			user_id,
			role_id,
			scope_type,
			tenant_id,
			project_id,
			kb_id,
			expires_at,
			created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, user_id, role_id, scope_type, tenant_id, project_id, kb_id, expires_at, created_by, created_at
	`, req.UserID, roleID, req.ScopeType, req.TenantID, req.ProjectID, req.KBID, req.ExpiresAt, req.OperatorID)
	binding, err := scanRbacBindingMutationRow(row)
	if err != nil {
		return RbacBinding{}, fmt.Errorf("insert rbac binding failed: %w", err)
	}
	binding.Username = &user.Username
	binding.Email = &user.Email
	binding.RoleName = req.RoleName

	if err := insertRbacBindingAuditLog(ctx, tx, "rbac_binding_create", fmt.Sprintf("%d", binding.ID), req.OperatorID, req.TraceID, req.IPAddress, req.UserAgent, map[string]interface{}{
		"user_id":    binding.UserID,
		"role_name":  binding.RoleName,
		"scope_type": binding.ScopeType,
		"tenant_id":  binding.TenantID,
		"project_id": binding.ProjectID,
		"kb_id":      binding.KBID,
		"expires_at": optionalTimeRFC3339(binding.ExpiresAt),
	}); err != nil {
		return RbacBinding{}, err
	}
	if err := tx.Commit(); err != nil {
		return RbacBinding{}, fmt.Errorf("commit rbac binding create transaction failed: %w", err)
	}
	return binding, nil
}

func (c *Client) DeleteRbacBinding(ctx context.Context, req RbacBindingDeleteRequest) error {
	if c == nil || c.db == nil {
		return errors.New("admin store is not initialized")
	}
	if req.BindingID <= 0 {
		return ErrRbacBindingNotFound
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin rbac binding delete transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var binding RbacBinding
	binding, err = scanRbacBindingMutationRow(tx.QueryRowContext(ctx, `
		DELETE FROM admin_user_role_bindings
		WHERE id = $1
		RETURNING id, user_id, role_id, scope_type, tenant_id, project_id, kb_id, expires_at, created_by, created_at
	`, req.BindingID))
	if errors.Is(err, sql.ErrNoRows) {
		return ErrRbacBindingNotFound
	}
	if err != nil {
		return fmt.Errorf("delete rbac binding failed: %w", err)
	}

	if err := insertRbacBindingAuditLog(ctx, tx, "rbac_binding_delete", fmt.Sprintf("%d", req.BindingID), req.OperatorID, req.TraceID, req.IPAddress, req.UserAgent, map[string]interface{}{
		"user_id":    binding.UserID,
		"role_id":    binding.RoleID,
		"scope_type": binding.ScopeType,
		"tenant_id":  binding.TenantID,
		"project_id": binding.ProjectID,
		"kb_id":      binding.KBID,
	}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit rbac binding delete transaction failed: %w", err)
	}
	return nil
}

type rbacBindingUser struct {
	Username string
	Email    string
}

func getRbacBindingUser(ctx context.Context, tx *sql.Tx, userID int) (rbacBindingUser, error) {
	var user rbacBindingUser
	if err := tx.QueryRowContext(ctx, `
		SELECT username, email
		FROM admin_users
		WHERE id = $1
		LIMIT 1
	`, userID).Scan(&user.Username, &user.Email); err != nil {
		return rbacBindingUser{}, err
	}
	return user, nil
}

func getRbacRoleIDByName(ctx context.Context, tx *sql.Tx, roleName string) (int, error) {
	var roleID int
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM admin_roles
		WHERE name = $1
		LIMIT 1
	`, roleName).Scan(&roleID); err != nil {
		return 0, err
	}
	return roleID, nil
}

func findRbacBinding(ctx context.Context, tx *sql.Tx, userID int, roleID int, scopeType string, tenantID *string, projectID *string, kbID *string) (RbacBinding, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT id, user_id, role_id, scope_type, tenant_id, project_id, kb_id, expires_at, created_by, created_at
		FROM admin_user_role_bindings
		WHERE user_id = $1
		  AND role_id = $2
		  AND scope_type = $3
		  AND tenant_id IS NOT DISTINCT FROM $4
		  AND project_id IS NOT DISTINCT FROM $5
		  AND kb_id IS NOT DISTINCT FROM $6
		LIMIT 1
	`, userID, roleID, scopeType, tenantID, projectID, kbID)
	return scanRbacBindingMutationRow(row)
}

type rbacBindingMutationScanner interface {
	Scan(dest ...interface{}) error
}

func scanRbacBindingMutationRow(scanner rbacBindingMutationScanner) (RbacBinding, error) {
	var binding RbacBinding
	var tenantID sql.NullString
	var projectID sql.NullString
	var kbID sql.NullString
	var expiresAt sql.NullTime
	var createdBy sql.NullInt64
	if err := scanner.Scan(
		&binding.ID,
		&binding.UserID,
		&binding.RoleID,
		&binding.ScopeType,
		&tenantID,
		&projectID,
		&kbID,
		&expiresAt,
		&createdBy,
		&binding.CreatedAt,
	); err != nil {
		return RbacBinding{}, err
	}
	binding.TenantID = stringPtrFromNull(tenantID)
	binding.ProjectID = stringPtrFromNull(projectID)
	binding.KBID = stringPtrFromNull(kbID)
	if expiresAt.Valid {
		value := expiresAt.Time
		binding.ExpiresAt = &value
	}
	if createdBy.Valid {
		value := int(createdBy.Int64)
		binding.CreatedBy = &value
	}
	return binding, nil
}

func insertRbacBindingAuditLog(ctx context.Context, tx *sql.Tx, action string, resourceID string, operatorID *int, traceID *string, ipAddress *string, userAgent *string, details map[string]interface{}) error {
	encodedDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("encode rbac binding audit details failed: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_logs (
			user_id,
			operator_id,
			trace_id,
			action,
			resource,
			resource_id,
			details,
			ip_address,
			user_agent,
			status
		)
		VALUES ($1, $1, $2, $3, 'rbac_binding', $4, $5, $6, $7, 'success')
	`, operatorID, traceID, action, resourceID, string(encodedDetails), ipAddress, userAgent); err != nil {
		return fmt.Errorf("insert rbac binding audit log failed: %w", err)
	}
	return nil
}

func normalizeRbacScopeType(scopeType string) string {
	normalized := strings.ToLower(strings.TrimSpace(scopeType))
	if normalized == "" {
		return "global"
	}
	return normalized
}

func isAllowedRbacScopeType(scopeType string) bool {
	switch scopeType {
	case "global", "tenant", "project", "kb":
		return true
	default:
		return false
	}
}

func rbacScopeFieldsValid(req RbacBindingMutationRequest) bool {
	switch req.ScopeType {
	case "tenant":
		return req.TenantID != nil && strings.TrimSpace(*req.TenantID) != ""
	case "project":
		return req.ProjectID != nil && strings.TrimSpace(*req.ProjectID) != ""
	case "kb":
		return req.KBID != nil && strings.TrimSpace(*req.KBID) != ""
	default:
		return true
	}
}

func optionalTimeRFC3339(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format(time.RFC3339)
	return &formatted
}
