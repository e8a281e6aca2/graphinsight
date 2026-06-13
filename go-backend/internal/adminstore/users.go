package adminstore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"graphinsight/go-backend/internal/authz"
)

var ErrUserNotFound = errors.New("admin user not found")
var ErrUserConflict = errors.New("admin user conflict")
var ErrUserSelfOperation = errors.New("admin user self operation")
var ErrUserPasswordMismatch = errors.New("admin user password mismatch")
var ErrUserDisabled = errors.New("admin user disabled")
var ErrUserInvalidCredentials = errors.New("admin user invalid credentials")

type UserCreateRequest struct {
	Username   string
	Email      string
	Password   string
	FullName   *string
	Phone      *string
	Department *string
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type UserUpdateRequest struct {
	UserID     int
	Email      *string
	FullName   *string
	Phone      *string
	Department *string
	Avatar     *string
	IsActive   *bool
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type UserToggleStatusRequest struct {
	UserID     int
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type UserDeleteRequest struct {
	UserID     int
	SoftDelete bool
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type UserResetPasswordRequest struct {
	UserID      int
	NewPassword string
	OperatorID  *int
	TenantID    *string
	TraceID     *string
	IPAddress   *string
	UserAgent   *string
}

type UserBatchStatusRequest struct {
	UserIDs    []int
	IsActive   bool
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type UserBatchResetPasswordRequest struct {
	UserIDs     []int
	NewPassword string
	OperatorID  *int
	TenantID    *string
	TraceID     *string
	IPAddress   *string
	UserAgent   *string
}

type UserBatchDeleteRequest struct {
	UserIDs    []int
	SoftDelete bool
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

type UserBatchStatusResult struct {
	UpdatedCount   int   `json:"updated_count"`
	UpdatedIDs     []int `json:"updated_ids"`
	NotFoundIDs    []int `json:"not_found_ids"`
	SkippedSelfIDs []int `json:"skipped_self_ids"`
}

type UserBatchDeleteResult struct {
	DeletedCount   int   `json:"deleted_count"`
	DeletedIDs     []int `json:"deleted_ids"`
	NotFoundIDs    []int `json:"not_found_ids"`
	SkippedSelfIDs []int `json:"skipped_self_ids"`
}

type UserBatchResetPasswordResult struct {
	ResetCount     int   `json:"reset_count"`
	ResetIDs       []int `json:"reset_ids"`
	NotFoundIDs    []int `json:"not_found_ids"`
	SkippedSelfIDs []int `json:"skipped_self_ids"`
}

type UserExportAuditRequest struct {
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
	Rows       int
	Search     string
	IsActive   *bool
	Department string
	OrderBy    string
	OrderDesc  bool
}

type ProfileUpdateRequest struct {
	Subject           string
	Email             *string
	FullName          *string
	Phone             *string
	Avatar            *string
	PreferredHomePath *string
	OperatorID        *int
	TenantID          *string
	TraceID           *string
	IPAddress         *string
	UserAgent         *string
}

type ProfilePasswordChangeRequest struct {
	Subject     string
	OldPassword string
	NewPassword string
	OperatorID  *int
	TenantID    *string
	TraceID     *string
	IPAddress   *string
	UserAgent   *string
}

type UserLoginRequest struct {
	Email     string
	Password  string
	TenantID  *string
	TraceID   *string
	IPAddress *string
	UserAgent *string
}

type UserLogoutRequest struct {
	Subject   string
	TenantID  *string
	TraceID   *string
	IPAddress *string
	UserAgent *string
}

type UserRegisterRequest struct {
	Email     string
	Password  string
	TenantID  *string
	TraceID   *string
	IPAddress *string
	UserAgent *string
}

func (c *Client) LoginAdminUser(ctx context.Context, req UserLoginRequest) (UserItem, error) {
	if c == nil || c.db == nil {
		return UserItem{}, errors.New("admin store is not initialized")
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || strings.TrimSpace(req.Password) == "" {
		return UserItem{}, ErrUserInvalidCredentials
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserItem{}, fmt.Errorf("begin admin login transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var passwordHash string
	item, err := scanLoginUserItem(tx.QueryRowContext(ctx, `
		SELECT
			id,
			username,
			email,
			full_name,
			phone,
			department,
			avatar,
			preferred_home_path,
			is_active,
			last_login,
			last_login_ip,
			COALESCE(login_count, 0),
			created_at,
			updated_at,
			password_hash
		FROM admin_users
		WHERE email = $1
		ORDER BY id ASC
		LIMIT 1
	`, email), &passwordHash)
	if errors.Is(err, sql.ErrNoRows) {
		if logErr := insertAuthAuditLog(ctx, tx, "login", nil, req.TenantID, req.TraceID, req.IPAddress, req.UserAgent, "failed", optionalAuditString("邮箱或密码错误"), map[string]interface{}{"email": email}); logErr != nil {
			return UserItem{}, logErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return UserItem{}, fmt.Errorf("commit failed admin login audit transaction failed: %w", commitErr)
		}
		return UserItem{}, ErrUserInvalidCredentials
	}
	if err != nil {
		return UserItem{}, fmt.Errorf("query admin login user failed: %w", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password)); err != nil {
		if logErr := insertAuthAuditLog(ctx, tx, "login", nil, req.TenantID, req.TraceID, req.IPAddress, req.UserAgent, "failed", optionalAuditString("邮箱或密码错误"), map[string]interface{}{"email": email}); logErr != nil {
			return UserItem{}, logErr
		}
		if commitErr := tx.Commit(); commitErr != nil {
			return UserItem{}, fmt.Errorf("commit failed admin login audit transaction failed: %w", commitErr)
		}
		return UserItem{}, ErrUserInvalidCredentials
	}
	if !item.IsActive {
		return UserItem{}, ErrUserDisabled
	}

	item, err = scanUserItem(tx.QueryRowContext(ctx, `
		UPDATE admin_users
		SET
			last_login = NOW(),
			last_login_ip = $2,
			login_count = COALESCE(login_count, 0) + 1,
			updated_at = NOW()
		WHERE id = $1
		RETURNING
			id,
			username,
			email,
			full_name,
			phone,
			department,
			avatar,
			preferred_home_path,
			is_active,
			last_login,
			last_login_ip,
			COALESCE(login_count, 0),
			created_at,
			updated_at
	`, item.ID, req.IPAddress))
	if err != nil {
		return UserItem{}, fmt.Errorf("update admin login metadata failed: %w", err)
	}
	if err := insertAuthAuditLog(ctx, tx, "login", &item, req.TenantID, req.TraceID, req.IPAddress, req.UserAgent, "success", nil, map[string]interface{}{"username": item.Username}); err != nil {
		return UserItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserItem{}, fmt.Errorf("commit admin login transaction failed: %w", err)
	}
	return item, nil
}

func (c *Client) LogoutAdminUser(ctx context.Context, req UserLogoutRequest) error {
	if c == nil || c.db == nil {
		return errors.New("admin store is not initialized")
	}
	user, err := c.GetActiveUserBySubject(ctx, req.Subject)
	if err != nil {
		return err
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin admin logout transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)
	if err := insertAuthAuditLog(ctx, tx, "logout", &user, req.TenantID, req.TraceID, req.IPAddress, req.UserAgent, "success", nil, map[string]interface{}{}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit admin logout transaction failed: %w", err)
	}
	return nil
}

func (c *Client) RegisterAdminUser(ctx context.Context, req UserRegisterRequest) (UserItem, error) {
	if c == nil || c.db == nil {
		return UserItem{}, errors.New("admin store is not initialized")
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		return UserItem{}, ErrUserConflict
	}
	passwordHash, err := hashAdminUserPassword(req.Password)
	if err != nil {
		return UserItem{}, err
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserItem{}, fmt.Errorf("begin admin register transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var userCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_users`).Scan(&userCount); err != nil {
		return UserItem{}, fmt.Errorf("count admin users failed: %w", err)
	}
	if userCount > 0 {
		return UserItem{}, ErrUserConflict
	}

	username := deriveRegisterUsername(email)
	user, err := scanUserItem(tx.QueryRowContext(ctx, `
		INSERT INTO admin_users (
			username,
			email,
			password_hash,
			is_active,
			login_count
		)
		VALUES ($1, $2, $3, TRUE, 0)
		RETURNING
			id,
			username,
			email,
			full_name,
			phone,
			department,
			avatar,
			preferred_home_path,
			is_active,
			last_login,
			last_login_ip,
			COALESCE(login_count, 0),
			created_at,
			updated_at
	`, username, email, passwordHash))
	if err != nil {
		return UserItem{}, fmt.Errorf("insert registered admin user failed: %w", err)
	}

	roleIDs, err := ensureRbacSeedDataTx(ctx, tx)
	if err != nil {
		return UserItem{}, err
	}
	superAdminRoleID, ok := roleIDs["super_admin"]
	if !ok {
		return UserItem{}, fmt.Errorf("super_admin role seed missing")
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_user_role_bindings (
			user_id,
			role_id,
			scope_type,
			created_by
		)
		VALUES ($1, $2, 'global', $1)
		ON CONFLICT DO NOTHING
	`, user.ID, superAdminRoleID); err != nil {
		return UserItem{}, fmt.Errorf("insert super admin binding failed: %w", err)
	}

	if err := insertUserAuditLog(ctx, tx, "register", fmt.Sprintf("%d", user.ID), userAuditContext{
		OperatorID: &user.ID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"username": user.Username,
		"email":    user.Email,
	}); err != nil {
		return UserItem{}, err
	}

	if err := tx.Commit(); err != nil {
		return UserItem{}, fmt.Errorf("commit admin register transaction failed: %w", err)
	}
	return user, nil
}

func (c *Client) CreateUser(ctx context.Context, req UserCreateRequest) (UserItem, error) {
	if c == nil || c.db == nil {
		return UserItem{}, errors.New("admin store is not initialized")
	}
	req.Username = strings.TrimSpace(req.Username)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	if req.Username == "" || req.Email == "" || strings.TrimSpace(req.Password) == "" {
		return UserItem{}, fmt.Errorf("invalid user create request")
	}
	passwordHash, err := hashAdminUserPassword(req.Password)
	if err != nil {
		return UserItem{}, err
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserItem{}, fmt.Errorf("begin user create transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var existingID int
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM admin_users
		WHERE username = $1 OR email = $2
		LIMIT 1
	`, req.Username, req.Email).Scan(&existingID); err == nil {
		return UserItem{}, ErrUserConflict
	} else if !errors.Is(err, sql.ErrNoRows) {
		return UserItem{}, fmt.Errorf("check existing admin user failed: %w", err)
	}

	user, err := scanUserItem(tx.QueryRowContext(ctx, `
		INSERT INTO admin_users (
			username,
			email,
			password_hash,
			full_name,
			phone,
			department,
			is_active,
			login_count
		)
		VALUES ($1, $2, $3, $4, $5, $6, true, 0)
		RETURNING
			id,
			username,
			email,
			full_name,
			phone,
			department,
			avatar,
			preferred_home_path,
			is_active,
			last_login,
			last_login_ip,
			COALESCE(login_count, 0),
			created_at,
			updated_at
	`, req.Username, req.Email, passwordHash, req.FullName, req.Phone, req.Department))
	if err != nil {
		return UserItem{}, fmt.Errorf("insert admin user failed: %w", err)
	}
	if err := insertUserAuditLog(ctx, tx, "user_create", fmt.Sprintf("%d", user.ID), userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"target_username": user.Username,
		"target_email":    user.Email,
	}); err != nil {
		return UserItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserItem{}, fmt.Errorf("commit user create transaction failed: %w", err)
	}
	return user, nil
}

func (c *Client) ResetUserPassword(ctx context.Context, req UserResetPasswordRequest) error {
	if c == nil || c.db == nil {
		return errors.New("admin store is not initialized")
	}
	if req.UserID <= 0 {
		return ErrUserNotFound
	}
	passwordHash, err := hashAdminUserPassword(req.NewPassword)
	if err != nil {
		return err
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin user reset password transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var username string
	if err := tx.QueryRowContext(ctx, `
		UPDATE admin_users
		SET password_hash = $2, updated_at = NOW()
		WHERE id = $1
		RETURNING username
	`, req.UserID, passwordHash).Scan(&username); errors.Is(err, sql.ErrNoRows) {
		return ErrUserNotFound
	} else if err != nil {
		return fmt.Errorf("reset admin user password failed: %w", err)
	}
	if err := insertUserAuditLog(ctx, tx, "user_reset_password", fmt.Sprintf("%d", req.UserID), userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"target_username": username,
	}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit user reset password transaction failed: %w", err)
	}
	return nil
}

func (c *Client) UpdateUser(ctx context.Context, req UserUpdateRequest) (UserItem, error) {
	if c == nil || c.db == nil {
		return UserItem{}, errors.New("admin store is not initialized")
	}
	if req.UserID <= 0 {
		return UserItem{}, ErrUserNotFound
	}
	if req.OperatorID != nil && *req.OperatorID == req.UserID && req.IsActive != nil && !*req.IsActive {
		return UserItem{}, ErrUserSelfOperation
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserItem{}, fmt.Errorf("begin user update transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var currentEmail string
	if err := tx.QueryRowContext(ctx, `
		SELECT email
		FROM admin_users
		WHERE id = $1
		LIMIT 1
	`, req.UserID).Scan(&currentEmail); errors.Is(err, sql.ErrNoRows) {
		return UserItem{}, ErrUserNotFound
	} else if err != nil {
		return UserItem{}, fmt.Errorf("query admin user failed: %w", err)
	}
	if req.Email != nil {
		email := strings.ToLower(strings.TrimSpace(*req.Email))
		req.Email = &email
		if email != currentEmail {
			var existingID int
			if err := tx.QueryRowContext(ctx, `
				SELECT id
				FROM admin_users
				WHERE email = $1 AND id <> $2
				LIMIT 1
			`, email, req.UserID).Scan(&existingID); err == nil {
				return UserItem{}, ErrUserConflict
			} else if !errors.Is(err, sql.ErrNoRows) {
				return UserItem{}, fmt.Errorf("check admin user email failed: %w", err)
			}
		}
	}

	user, err := scanUserItem(tx.QueryRowContext(ctx, `
		UPDATE admin_users
		SET
			email = COALESCE($2, email),
			full_name = COALESCE($3, full_name),
			phone = COALESCE($4, phone),
			department = COALESCE($5, department),
			avatar = COALESCE($6, avatar),
			is_active = COALESCE($7, is_active),
			updated_at = NOW()
		WHERE id = $1
		RETURNING
			id,
			username,
			email,
			full_name,
			phone,
			department,
			avatar,
			preferred_home_path,
			is_active,
			last_login,
			last_login_ip,
			COALESCE(login_count, 0),
			created_at,
			updated_at
	`, req.UserID, req.Email, req.FullName, req.Phone, req.Department, req.Avatar, req.IsActive))
	if errors.Is(err, sql.ErrNoRows) {
		return UserItem{}, ErrUserNotFound
	}
	if err != nil {
		return UserItem{}, fmt.Errorf("update admin user failed: %w", err)
	}
	if err := insertUserAuditLog(ctx, tx, "user_update", fmt.Sprintf("%d", user.ID), userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"updated_fields": userUpdateFields(req),
	}); err != nil {
		return UserItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserItem{}, fmt.Errorf("commit user update transaction failed: %w", err)
	}
	return user, nil
}

func (c *Client) ToggleUserStatus(ctx context.Context, req UserToggleStatusRequest) (UserItem, error) {
	if c == nil || c.db == nil {
		return UserItem{}, errors.New("admin store is not initialized")
	}
	if req.UserID <= 0 {
		return UserItem{}, ErrUserNotFound
	}
	if req.OperatorID != nil && *req.OperatorID == req.UserID {
		return UserItem{}, ErrUserSelfOperation
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserItem{}, fmt.Errorf("begin user toggle transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	user, err := scanUserItem(tx.QueryRowContext(ctx, `
		UPDATE admin_users
		SET is_active = NOT is_active, updated_at = NOW()
		WHERE id = $1
		RETURNING
			id,
			username,
			email,
			full_name,
			phone,
			department,
			avatar,
			preferred_home_path,
			is_active,
			last_login,
			last_login_ip,
			COALESCE(login_count, 0),
			created_at,
			updated_at
	`, req.UserID))
	if errors.Is(err, sql.ErrNoRows) {
		return UserItem{}, ErrUserNotFound
	}
	if err != nil {
		return UserItem{}, fmt.Errorf("toggle admin user status failed: %w", err)
	}
	if err := insertUserAuditLog(ctx, tx, "user_toggle_status", fmt.Sprintf("%d", user.ID), userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"is_active": user.IsActive,
	}); err != nil {
		return UserItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserItem{}, fmt.Errorf("commit user toggle transaction failed: %w", err)
	}
	return user, nil
}

func (c *Client) DeleteUser(ctx context.Context, req UserDeleteRequest) error {
	if c == nil || c.db == nil {
		return errors.New("admin store is not initialized")
	}
	if req.UserID <= 0 {
		return ErrUserNotFound
	}
	if req.OperatorID != nil && *req.OperatorID == req.UserID {
		return ErrUserSelfOperation
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin user delete transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var affectedID int
	if req.SoftDelete {
		err = tx.QueryRowContext(ctx, `
			UPDATE admin_users
			SET is_active = false, updated_at = NOW()
			WHERE id = $1
			RETURNING id
		`, req.UserID).Scan(&affectedID)
	} else {
		err = tx.QueryRowContext(ctx, `
			DELETE FROM admin_users
			WHERE id = $1
			RETURNING id
		`, req.UserID).Scan(&affectedID)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return fmt.Errorf("delete admin user failed: %w", err)
	}
	if err := insertUserAuditLog(ctx, tx, "user_delete", fmt.Sprintf("%d", req.UserID), userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"soft_delete": req.SoftDelete,
	}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit user delete transaction failed: %w", err)
	}
	return nil
}

func (c *Client) BatchUpdateUserStatus(ctx context.Context, req UserBatchStatusRequest) (UserBatchStatusResult, error) {
	if c == nil || c.db == nil {
		return UserBatchStatusResult{}, errors.New("admin store is not initialized")
	}
	ids := normalizeUserIDList(req.UserIDs)
	result := UserBatchStatusResult{
		UpdatedIDs:     []int{},
		NotFoundIDs:    []int{},
		SkippedSelfIDs: []int{},
	}
	if len(ids) == 0 {
		return result, nil
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserBatchStatusResult{}, fmt.Errorf("begin user batch status transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	for _, userID := range ids {
		if req.OperatorID != nil && *req.OperatorID == userID {
			result.SkippedSelfIDs = append(result.SkippedSelfIDs, userID)
			continue
		}
		commandResult, err := tx.ExecContext(ctx, `
			UPDATE admin_users
			SET is_active = $2, updated_at = NOW()
			WHERE id = $1
		`, userID, req.IsActive)
		if err != nil {
			return UserBatchStatusResult{}, fmt.Errorf("batch update admin user status failed: %w", err)
		}
		affected, err := commandResult.RowsAffected()
		if err != nil {
			return UserBatchStatusResult{}, fmt.Errorf("read user batch status rows affected failed: %w", err)
		}
		if affected == 0 {
			result.NotFoundIDs = append(result.NotFoundIDs, userID)
			continue
		}
		result.UpdatedIDs = append(result.UpdatedIDs, userID)
	}
	result.UpdatedCount = len(result.UpdatedIDs)
	if err := insertUserAuditLog(ctx, tx, "user_batch_status", "", userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"is_active":        req.IsActive,
		"updated_ids":      result.UpdatedIDs,
		"not_found_ids":    result.NotFoundIDs,
		"skipped_self_ids": result.SkippedSelfIDs,
	}); err != nil {
		return UserBatchStatusResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserBatchStatusResult{}, fmt.Errorf("commit user batch status transaction failed: %w", err)
	}
	return result, nil
}

func (c *Client) UpdateProfileBySubject(ctx context.Context, req ProfileUpdateRequest) (UserItem, error) {
	if c == nil || c.db == nil {
		return UserItem{}, errors.New("admin store is not initialized")
	}
	req.Subject = strings.TrimSpace(req.Subject)
	if req.Subject == "" {
		return UserItem{}, authz.ErrUnauthorized
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserItem{}, fmt.Errorf("begin profile update transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var userID int
	var currentEmail string
	if err := tx.QueryRowContext(ctx, `
		SELECT id, email
		FROM admin_users
		WHERE (email = $1 OR username = $1) AND is_active = TRUE
		ORDER BY id ASC
		LIMIT 1
	`, req.Subject).Scan(&userID, &currentEmail); errors.Is(err, sql.ErrNoRows) {
		return UserItem{}, authz.ErrUnauthorized
	} else if err != nil {
		return UserItem{}, fmt.Errorf("query profile user failed: %w", err)
	}

	if req.Email != nil {
		email := strings.ToLower(strings.TrimSpace(*req.Email))
		req.Email = &email
		if email != currentEmail {
			var existingID int
			if err := tx.QueryRowContext(ctx, `
				SELECT id
				FROM admin_users
				WHERE email = $1 AND id <> $2
				LIMIT 1
			`, email, userID).Scan(&existingID); err == nil {
				return UserItem{}, ErrUserConflict
			} else if !errors.Is(err, sql.ErrNoRows) {
				return UserItem{}, fmt.Errorf("check profile email failed: %w", err)
			}
		}
	}

	user, err := scanUserItem(tx.QueryRowContext(ctx, `
		UPDATE admin_users
		SET
			email = COALESCE($2, email),
			full_name = COALESCE($3, full_name),
			phone = COALESCE($4, phone),
			avatar = COALESCE($5, avatar),
			preferred_home_path = COALESCE($6, preferred_home_path),
			updated_at = NOW()
		WHERE id = $1
		RETURNING
			id,
			username,
			email,
			full_name,
			phone,
			department,
			avatar,
			preferred_home_path,
			is_active,
			last_login,
			last_login_ip,
			COALESCE(login_count, 0),
			created_at,
			updated_at
	`, userID, req.Email, req.FullName, req.Phone, req.Avatar, req.PreferredHomePath))
	if err != nil {
		return UserItem{}, fmt.Errorf("update profile failed: %w", err)
	}
	if err := insertUserAuditLog(ctx, tx, "profile_update", fmt.Sprintf("%d", user.ID), userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"updated_fields": profileUpdateFields(req),
	}); err != nil {
		return UserItem{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserItem{}, fmt.Errorf("commit profile update transaction failed: %w", err)
	}
	return user, nil
}

func (c *Client) ChangeProfilePasswordBySubject(ctx context.Context, req ProfilePasswordChangeRequest) error {
	if c == nil || c.db == nil {
		return errors.New("admin store is not initialized")
	}
	req.Subject = strings.TrimSpace(req.Subject)
	if req.Subject == "" {
		return authz.ErrUnauthorized
	}
	newPasswordHash, err := hashAdminUserPassword(req.NewPassword)
	if err != nil {
		return err
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin profile password transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	var userID int
	var passwordHash string
	if err := tx.QueryRowContext(ctx, `
		SELECT id, password_hash
		FROM admin_users
		WHERE (email = $1 OR username = $1) AND is_active = TRUE
		ORDER BY id ASC
		LIMIT 1
	`, req.Subject).Scan(&userID, &passwordHash); errors.Is(err, sql.ErrNoRows) {
		return authz.ErrUnauthorized
	} else if err != nil {
		return fmt.Errorf("query profile password failed: %w", err)
	}
	if err := bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.OldPassword)); err != nil {
		return ErrUserPasswordMismatch
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE admin_users
		SET password_hash = $2, updated_at = NOW()
		WHERE id = $1
	`, userID, newPasswordHash); err != nil {
		return fmt.Errorf("change profile password failed: %w", err)
	}
	if err := insertUserAuditLog(ctx, tx, "profile_change_password", fmt.Sprintf("%d", userID), userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{}); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit profile password transaction failed: %w", err)
	}
	return nil
}

func (c *Client) BatchDeleteUsers(ctx context.Context, req UserBatchDeleteRequest) (UserBatchDeleteResult, error) {
	if c == nil || c.db == nil {
		return UserBatchDeleteResult{}, errors.New("admin store is not initialized")
	}
	ids := normalizeUserIDList(req.UserIDs)
	result := UserBatchDeleteResult{
		DeletedIDs:     []int{},
		NotFoundIDs:    []int{},
		SkippedSelfIDs: []int{},
	}
	if len(ids) == 0 {
		return result, nil
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserBatchDeleteResult{}, fmt.Errorf("begin user batch delete transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	for _, userID := range ids {
		if req.OperatorID != nil && *req.OperatorID == userID {
			result.SkippedSelfIDs = append(result.SkippedSelfIDs, userID)
			continue
		}
		var commandResult sql.Result
		if req.SoftDelete {
			commandResult, err = tx.ExecContext(ctx, `
				UPDATE admin_users
				SET is_active = false, updated_at = NOW()
				WHERE id = $1
			`, userID)
		} else {
			commandResult, err = tx.ExecContext(ctx, `
				DELETE FROM admin_users
				WHERE id = $1
			`, userID)
		}
		if err != nil {
			return UserBatchDeleteResult{}, fmt.Errorf("batch delete admin users failed: %w", err)
		}
		affected, err := commandResult.RowsAffected()
		if err != nil {
			return UserBatchDeleteResult{}, fmt.Errorf("read user batch delete rows affected failed: %w", err)
		}
		if affected == 0 {
			result.NotFoundIDs = append(result.NotFoundIDs, userID)
			continue
		}
		result.DeletedIDs = append(result.DeletedIDs, userID)
	}
	result.DeletedCount = len(result.DeletedIDs)
	if err := insertUserAuditLog(ctx, tx, "user_batch_delete", "", userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"soft_delete":      req.SoftDelete,
		"deleted_ids":      result.DeletedIDs,
		"not_found_ids":    result.NotFoundIDs,
		"skipped_self_ids": result.SkippedSelfIDs,
	}); err != nil {
		return UserBatchDeleteResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserBatchDeleteResult{}, fmt.Errorf("commit user batch delete transaction failed: %w", err)
	}
	return result, nil
}

func (c *Client) BatchResetUserPasswords(ctx context.Context, req UserBatchResetPasswordRequest) (UserBatchResetPasswordResult, error) {
	if c == nil || c.db == nil {
		return UserBatchResetPasswordResult{}, errors.New("admin store is not initialized")
	}
	ids := normalizeUserIDList(req.UserIDs)
	result := UserBatchResetPasswordResult{
		ResetIDs:       []int{},
		NotFoundIDs:    []int{},
		SkippedSelfIDs: []int{},
	}
	if len(ids) == 0 {
		return result, nil
	}
	passwordHash, err := hashAdminUserPassword(req.NewPassword)
	if err != nil {
		return UserBatchResetPasswordResult{}, err
	}

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return UserBatchResetPasswordResult{}, fmt.Errorf("begin user batch reset password transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	for _, userID := range ids {
		if req.OperatorID != nil && *req.OperatorID == userID {
			result.SkippedSelfIDs = append(result.SkippedSelfIDs, userID)
			continue
		}
		commandResult, err := tx.ExecContext(ctx, `
			UPDATE admin_users
			SET password_hash = $2, updated_at = NOW()
			WHERE id = $1
		`, userID, passwordHash)
		if err != nil {
			return UserBatchResetPasswordResult{}, fmt.Errorf("batch reset admin user password failed: %w", err)
		}
		affected, err := commandResult.RowsAffected()
		if err != nil {
			return UserBatchResetPasswordResult{}, fmt.Errorf("read user batch reset rows affected failed: %w", err)
		}
		if affected == 0 {
			result.NotFoundIDs = append(result.NotFoundIDs, userID)
			continue
		}
		result.ResetIDs = append(result.ResetIDs, userID)
	}
	result.ResetCount = len(result.ResetIDs)
	if err := insertUserAuditLog(ctx, tx, "user_batch_reset_password", "", userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, map[string]interface{}{
		"reset_ids":        result.ResetIDs,
		"not_found_ids":    result.NotFoundIDs,
		"skipped_self_ids": result.SkippedSelfIDs,
	}); err != nil {
		return UserBatchResetPasswordResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return UserBatchResetPasswordResult{}, fmt.Errorf("commit user batch reset password transaction failed: %w", err)
	}
	return result, nil
}

type userAuditContext struct {
	OperatorID *int
	TenantID   *string
	TraceID    *string
	IPAddress  *string
	UserAgent  *string
}

func insertUserAuditLog(ctx context.Context, tx *sql.Tx, action string, resourceID string, auditCtx userAuditContext, details map[string]interface{}) error {
	encodedDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("encode user audit details failed: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_logs (
			user_id,
			operator_id,
			tenant_id,
			trace_id,
			action,
			resource,
			resource_id,
			details,
			ip_address,
			user_agent,
			status
		)
		VALUES ($1, $1, $2, $3, $4, 'user', $5, $6, $7, $8, 'success')
	`, auditCtx.OperatorID, auditCtx.TenantID, auditCtx.TraceID, action, resourceID, string(encodedDetails), auditCtx.IPAddress, auditCtx.UserAgent); err != nil {
		return fmt.Errorf("insert user audit log failed: %w", err)
	}
	return nil
}

func userUpdateFields(req UserUpdateRequest) []string {
	fields := []string{}
	if req.Email != nil {
		fields = append(fields, "email")
	}
	if req.FullName != nil {
		fields = append(fields, "full_name")
	}
	if req.Phone != nil {
		fields = append(fields, "phone")
	}
	if req.Department != nil {
		fields = append(fields, "department")
	}
	if req.Avatar != nil {
		fields = append(fields, "avatar")
	}
	if req.IsActive != nil {
		fields = append(fields, "is_active")
	}
	return fields
}

func (c *Client) RecordUserExportAudit(ctx context.Context, req UserExportAuditRequest) error {
	if c == nil || c.db == nil {
		return errors.New("admin store is not initialized")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin user export audit transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)

	details := map[string]interface{}{
		"rows":       req.Rows,
		"search":     req.Search,
		"is_active":  req.IsActive,
		"department": req.Department,
		"order_by":   req.OrderBy,
		"order_desc": req.OrderDesc,
	}
	if err := insertUserAuditLog(ctx, tx, "user_export_csv", "", userAuditContext{
		OperatorID: req.OperatorID,
		TenantID:   req.TenantID,
		TraceID:    req.TraceID,
		IPAddress:  req.IPAddress,
		UserAgent:  req.UserAgent,
	}, details); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit user export audit transaction failed: %w", err)
	}
	return nil
}

func profileUpdateFields(req ProfileUpdateRequest) []string {
	fields := []string{}
	if req.Email != nil {
		fields = append(fields, "email")
	}
	if req.FullName != nil {
		fields = append(fields, "full_name")
	}
	if req.Phone != nil {
		fields = append(fields, "phone")
	}
	if req.Avatar != nil {
		fields = append(fields, "avatar")
	}
	if req.PreferredHomePath != nil {
		fields = append(fields, "preferred_home_path")
	}
	return fields
}

func normalizeUserIDList(ids []int) []int {
	seen := map[int]struct{}{}
	normalized := []int{}
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		normalized = append(normalized, id)
	}
	sort.Ints(normalized)
	return normalized
}

func hashAdminUserPassword(password string) (string, error) {
	if err := validateAdminUserPassword(password); err != nil {
		return "", err
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash admin user password failed: %w", err)
	}
	return string(hashed), nil
}

func validateAdminUserPassword(password string) error {
	if len(password) < 8 || len(password) > 100 {
		return fmt.Errorf("password length must be between 8 and 100")
	}
	hasLetter := false
	hasDigit := false
	for _, char := range password {
		if char >= '0' && char <= '9' {
			hasDigit = true
		}
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') {
			hasLetter = true
		}
	}
	if !hasLetter || !hasDigit {
		return fmt.Errorf("password must contain letters and digits")
	}
	return nil
}

func scanLoginUserItem(scanner userRowScanner, passwordHash *string) (UserItem, error) {
	var item UserItem
	var fullName sql.NullString
	var phone sql.NullString
	var department sql.NullString
	var avatar sql.NullString
	var preferredHomePath sql.NullString
	var lastLogin sql.NullTime
	var lastLoginIP sql.NullString
	var updatedAt sql.NullTime
	if err := scanner.Scan(
		&item.ID,
		&item.Username,
		&item.Email,
		&fullName,
		&phone,
		&department,
		&avatar,
		&preferredHomePath,
		&item.IsActive,
		&lastLogin,
		&lastLoginIP,
		&item.LoginCount,
		&item.CreatedAt,
		&updatedAt,
		passwordHash,
	); err != nil {
		return UserItem{}, err
	}
	item.FullName = stringPtrFromNull(fullName)
	item.Phone = stringPtrFromNull(phone)
	item.Department = stringPtrFromNull(department)
	item.Avatar = stringPtrFromNull(avatar)
	item.PreferredHomePath = stringPtrFromNull(preferredHomePath)
	if lastLogin.Valid {
		value := lastLogin.Time
		item.LastLogin = &value
	}
	item.LastLoginIP = stringPtrFromNull(lastLoginIP)
	if updatedAt.Valid {
		value := updatedAt.Time
		item.UpdatedAt = &value
	}
	return item, nil
}

func insertAuthAuditLog(ctx context.Context, tx *sql.Tx, action string, user *UserItem, tenantID *string, traceID *string, ipAddress *string, userAgent *string, status string, errorMessage *string, details map[string]interface{}) error {
	encodedDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("encode auth audit details failed: %w", err)
	}
	var userID *int
	var resourceID *string
	if user != nil {
		userID = &user.ID
		rawResourceID := fmt.Sprintf("%d", user.ID)
		resourceID = &rawResourceID
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO admin_logs (
			user_id,
			operator_id,
			tenant_id,
			trace_id,
			action,
			resource,
			resource_id,
			details,
			ip_address,
			user_agent,
			status,
			error_message
		)
		VALUES ($1, $1, $2, $3, $4, 'user', $5, $6, $7, $8, $9, $10)
	`, userID, tenantID, traceID, action, resourceID, string(encodedDetails), ipAddress, userAgent, status, errorMessage); err != nil {
		return fmt.Errorf("insert auth audit log failed: %w", err)
	}
	return nil
}

func optionalAuditString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func deriveRegisterUsername(email string) string {
	localPart := strings.TrimSpace(strings.SplitN(email, "@", 2)[0])
	if localPart == "" {
		return "admin"
	}
	return localPart
}
