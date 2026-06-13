package adminstore

import (
	"context"
	"database/sql"
	"fmt"
)

type rbacPermissionSeed struct {
	Code         string
	ResourceType string
	Action       string
	Description  string
}

var systemRoleDescriptions = map[string]string{
	"super_admin":   "系统超级管理员",
	"project_admin": "项目管理员",
	"operator":      "运营操作员",
	"viewer":        "只读用户",
}

var permissionSeeds = []rbacPermissionSeed{
	{Code: "graph:read", ResourceType: "graph", Action: "read", Description: "图谱查询与查看"},
	{Code: "graph:build", ResourceType: "graph", Action: "build", Description: "图谱构建与重建"},
	{Code: "kb:read", ResourceType: "kb", Action: "read", Description: "知识库读取"},
	{Code: "kb:write", ResourceType: "kb", Action: "write", Description: "知识库写入"},
	{Code: "kb:delete", ResourceType: "kb", Action: "delete", Description: "知识库删除"},
	{Code: "qa:ask", ResourceType: "qa", Action: "ask", Description: "文档问答"},
	{Code: "nl2cypher:use", ResourceType: "nl2cypher", Action: "use", Description: "自然语言转 Cypher"},
	{Code: "config:read", ResourceType: "config", Action: "read", Description: "配置读取"},
	{Code: "config:write", ResourceType: "config", Action: "write", Description: "配置写入"},
	{Code: "logs:read", ResourceType: "logs", Action: "read", Description: "日志读取"},
	{Code: "logs:clean", ResourceType: "logs", Action: "clean", Description: "日志清理"},
	{Code: "monitor:read", ResourceType: "monitor", Action: "read", Description: "监控读取"},
	{Code: "user:manage", ResourceType: "user", Action: "manage", Description: "用户和权限管理"},
	{Code: "job:read", ResourceType: "job", Action: "read", Description: "任务读取"},
	{Code: "job:manage", ResourceType: "job", Action: "manage", Description: "任务管理"},
}

var rolePermissionSeeds = map[string][]string{
	"super_admin": {
		"graph:read", "graph:build", "kb:read", "kb:write", "kb:delete", "qa:ask", "nl2cypher:use",
		"config:read", "config:write", "logs:read", "logs:clean", "monitor:read", "user:manage",
		"job:read", "job:manage",
	},
	"project_admin": {
		"graph:read", "graph:build", "kb:read", "kb:write", "kb:delete", "qa:ask", "nl2cypher:use",
		"config:read", "logs:read", "monitor:read", "job:read", "job:manage",
	},
	"operator": {
		"graph:read", "graph:build", "kb:read", "kb:write", "qa:ask", "nl2cypher:use", "job:read",
	},
	"viewer": {
		"graph:read", "kb:read", "qa:ask", "nl2cypher:use", "job:read",
	},
}

func (c *Client) ensureRbacSeedData(ctx context.Context) error {
	if c == nil || c.db == nil {
		return fmt.Errorf("admin store is not initialized")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin rbac seed transaction failed: %w", err)
	}
	defer rollbackUnlessCommitted(tx)
	if _, err := ensureRbacSeedDataTx(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit rbac seed transaction failed: %w", err)
	}
	return nil
}

func ensureRbacSeedDataTx(ctx context.Context, tx *sql.Tx) (map[string]int, error) {
	roleIDs := make(map[string]int, len(systemRoleDescriptions))
	for roleName, description := range systemRoleDescriptions {
		var roleID int
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO admin_roles (name, description, is_system)
			VALUES ($1, $2, TRUE)
			ON CONFLICT (name) DO UPDATE
			SET description = EXCLUDED.description,
			    is_system = EXCLUDED.is_system
			RETURNING id
		`, roleName, description).Scan(&roleID); err != nil {
			return nil, fmt.Errorf("upsert admin role %s failed: %w", roleName, err)
		}
		roleIDs[roleName] = roleID
	}

	permissionIDs := make(map[string]int, len(permissionSeeds))
	for _, item := range permissionSeeds {
		var permissionID int
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO admin_permissions (code, resource_type, action, description)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (code) DO UPDATE
			SET resource_type = EXCLUDED.resource_type,
			    action = EXCLUDED.action,
			    description = EXCLUDED.description
			RETURNING id
		`, item.Code, item.ResourceType, item.Action, item.Description).Scan(&permissionID); err != nil {
			return nil, fmt.Errorf("upsert admin permission %s failed: %w", item.Code, err)
		}
		permissionIDs[item.Code] = permissionID
	}

	for roleName, permissionCodes := range rolePermissionSeeds {
		roleID, ok := roleIDs[roleName]
		if !ok {
			return nil, fmt.Errorf("missing seeded role id for %s", roleName)
		}
		for _, permissionCode := range permissionCodes {
			permissionID, ok := permissionIDs[permissionCode]
			if !ok {
				return nil, fmt.Errorf("missing seeded permission id for %s", permissionCode)
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO admin_role_permissions (role_id, permission_id)
				VALUES ($1, $2)
				ON CONFLICT DO NOTHING
			`, roleID, permissionID); err != nil {
				return nil, fmt.Errorf("upsert role permission %s/%s failed: %w", roleName, permissionCode, err)
			}
		}
	}

	return roleIDs, nil
}
