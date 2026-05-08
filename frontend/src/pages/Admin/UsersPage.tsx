/**
 * 用户管理页面
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';
import { Add, Delete, Download, Edit, LockReset, PersonOff, Refresh, Search } from '@mui/icons-material';
import AdminLayout from '../../components/Admin/AdminLayout';
import { usersApi } from '../../services/adminService';
import type {
  AdminUserBatchDeleteResult,
  AdminUserBatchResetPasswordResult,
  AdminUserBatchStatusResult,
  AdminUserItem,
} from '../../types/admin';

type BatchResultView = {
  actionLabel: string;
  successCount: number;
  successIds: number[];
  notFoundIds: number[];
  skippedSelfIds: number[];
  executedAt: string;
};

const UsersPage: React.FC = () => {
  const [items, setItems] = useState<AdminUserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [resetTarget, setResetTarget] = useState<AdminUserItem | null>(null);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUserItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [editTarget, setEditTarget] = useState<AdminUserItem | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [actionLoadingUserId, setActionLoadingUserId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleteSubmitting, setBatchDeleteSubmitting] = useState(false);
  const [batchResetOpen, setBatchResetOpen] = useState(false);
  const [batchResetSubmitting, setBatchResetSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchResultView | null>(null);

  const [createForm, setCreateForm] = useState({
    username: '',
    email: '',
    password: '',
    full_name: '',
    phone: '',
    department: '',
  });
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [batchDeleteConfirmText, setBatchDeleteConfirmText] = useState('');
  const [batchResetPassword, setBatchResetPassword] = useState('');
  const [batchResetConfirmText, setBatchResetConfirmText] = useState('');
  const [editForm, setEditForm] = useState({
    email: '',
    full_name: '',
    phone: '',
    department: '',
  });

  useEffect(() => {
    loadUsers();
  }, [page, rowsPerPage, isActive]);

  useEffect(() => {
    const currentIds = new Set(items.map((item) => item.id));
    setSelectedIds((prev) => prev.filter((id) => currentIds.has(id)));
  }, [items]);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await usersApi.getUsers({
        page: page + 1,
        page_size: rowsPerPage,
        search: search || undefined,
        is_active: isActive === 'all' ? undefined : isActive === 'active',
      });
      setItems(response.items || []);
      setTotal(response.total || 0);
    } catch (err: any) {
      setError(err.message || '加载用户失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    if (page !== 0) {
      setPage(0);
      return;
    }
    void loadUsers();
  };

  const handleCreateUser = async () => {
    if (!createForm.username || !createForm.email || !createForm.password) {
      setError('用户名、邮箱、密码为必填项');
      return;
    }
    try {
      setCreateSubmitting(true);
      await usersApi.createUser({
        username: createForm.username.trim(),
        email: createForm.email.trim(),
        password: createForm.password,
        full_name: createForm.full_name.trim() || undefined,
        phone: createForm.phone.trim() || undefined,
        department: createForm.department.trim() || undefined,
      });
      setCreateOpen(false);
      setCreateForm({
        username: '',
        email: '',
        password: '',
        full_name: '',
        phone: '',
        department: '',
      });
      setNotice('用户创建成功');
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '创建用户失败');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleToggleStatus = async (user: AdminUserItem) => {
    try {
      setActionLoadingUserId(user.id);
      await usersApi.toggleUserStatus(user.id);
      setNotice(`已${user.is_active ? '停用' : '启用'}用户 ${user.username}`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '更新状态失败');
    } finally {
      setActionLoadingUserId(null);
    }
  };

  const handleDeleteUser = (user: AdminUserItem) => {
    setDeleteTarget(user);
    setDeleteConfirmText('');
  };

  const handleConfirmDeleteUser = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText !== deleteTarget.username) {
      setError('确认文本不匹配，请输入目标用户名');
      return;
    }
    try {
      setDeleteSubmitting(true);
      setActionLoadingUserId(deleteTarget.id);
      await usersApi.deleteUser(deleteTarget.id, true);
      setNotice(`用户 ${deleteTarget.username} 已删除`);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '删除用户失败');
    } finally {
      setDeleteSubmitting(false);
      setActionLoadingUserId(null);
    }
  };

  const handleOpenEdit = (user: AdminUserItem) => {
    setEditTarget(user);
    setEditForm({
      email: user.email || '',
      full_name: user.full_name || '',
      phone: user.phone || '',
      department: user.department || '',
    });
  };

  const handleOpenResetDialog = (user: AdminUserItem) => {
    setResetTarget(user);
    setResetPassword('');
    setResetConfirmText('');
  };

  const handleUpdateUser = async () => {
    if (!editTarget) return;
    if (!editForm.email) {
      setError('邮箱不能为空');
      return;
    }
    try {
      setEditSubmitting(true);
      await usersApi.updateUser(editTarget.id, {
        email: editForm.email.trim(),
        full_name: editForm.full_name.trim() || undefined,
        phone: editForm.phone.trim() || undefined,
        department: editForm.department.trim() || undefined,
      });
      setEditTarget(null);
      setNotice(`用户 ${editTarget.username} 信息已更新`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '更新用户失败');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleToggleSelectAllCurrentPage = (checked: boolean) => {
    if (!checked) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(items.map((item) => item.id));
  };

  const handleToggleSelectOne = (userId: number, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        return Array.from(new Set([...prev, userId]));
      }
      return prev.filter((id) => id !== userId);
    });
  };

  const handleBatchUpdateStatus = async (isActiveTarget: boolean) => {
    if (selectedIds.length === 0) {
      setError('请先选择用户');
      return;
    }
    try {
      setLoading(true);
      const result: AdminUserBatchStatusResult = await usersApi.batchUpdateStatus({
        user_ids: selectedIds,
        is_active: isActiveTarget,
      });
      setNotice(`已批量${isActiveTarget ? '启用' : '停用'} ${selectedIds.length} 个用户`);
      setBatchResult({
        actionLabel: isActiveTarget ? '批量启用' : '批量停用',
        successCount: result.updated_count || 0,
        successIds: result.updated_ids || [],
        notFoundIds: result.not_found_ids || [],
        skippedSelfIds: result.skipped_self_ids || [],
        executedAt: new Date().toISOString(),
      });
      setSelectedIds([]);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '批量更新状态失败');
    } finally {
      setLoading(false);
    }
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) {
      setError('请先选择用户');
      return;
    }
    setBatchDeleteOpen(true);
  };

  const handleConfirmBatchDelete = async () => {
    if (batchDeleteConfirmText !== 'DELETE') {
      setError('确认文本不匹配，请输入 DELETE');
      return;
    }
    try {
      setBatchDeleteSubmitting(true);
      const result: AdminUserBatchDeleteResult = await usersApi.batchDeleteUsers({
        user_ids: selectedIds,
        soft_delete: true,
      });
      setNotice(`已批量删除 ${selectedIds.length} 个用户`);
      setBatchResult({
        actionLabel: '批量删除',
        successCount: result.deleted_count || 0,
        successIds: result.deleted_ids || [],
        notFoundIds: result.not_found_ids || [],
        skippedSelfIds: result.skipped_self_ids || [],
        executedAt: new Date().toISOString(),
      });
      setSelectedIds([]);
      setBatchDeleteOpen(false);
      setBatchDeleteConfirmText('');
      await loadUsers();
    } catch (err: any) {
      setError(err.message || '批量删除失败');
    } finally {
      setBatchDeleteSubmitting(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      const blob = await usersApi.exportUsersCsv({
        search: search || undefined,
        is_active: isActive === 'all' ? undefined : isActive === 'active',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `users_${stamp}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setNotice('用户 CSV 导出完成');
    } catch (err: any) {
      setError(err.message || '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    if (!resetPassword || resetPassword.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (resetConfirmText !== resetTarget.username) {
      setError('确认文本不匹配，请输入目标用户名');
      return;
    }
    try {
      setResetSubmitting(true);
      await usersApi.resetUserPassword(resetTarget.id, { new_password: resetPassword });
      setNotice(`已重置用户 ${resetTarget.username} 密码`);
      setResetTarget(null);
      setResetPassword('');
      setResetConfirmText('');
    } catch (err: any) {
      setError(err.message || '重置密码失败');
    } finally {
      setResetSubmitting(false);
    }
  };

  const handleOpenBatchReset = () => {
    if (selectedIds.length === 0) {
      setError('请先选择用户');
      return;
    }
    setBatchResetOpen(true);
  };

  const handleConfirmBatchReset = async () => {
    if (!batchResetPassword || batchResetPassword.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    if (batchResetConfirmText !== 'RESET') {
      setError('确认文本不匹配，请输入 RESET');
      return;
    }
    try {
      setBatchResetSubmitting(true);
      const result: AdminUserBatchResetPasswordResult = await usersApi.batchResetPassword({
        user_ids: selectedIds,
        new_password: batchResetPassword,
      });
      setNotice(`已批量重置 ${selectedIds.length} 个用户密码`);
      setBatchResult({
        actionLabel: '批量重置密码',
        successCount: result.reset_count || 0,
        successIds: result.reset_ids || [],
        notFoundIds: result.not_found_ids || [],
        skippedSelfIds: result.skipped_self_ids || [],
        executedAt: new Date().toISOString(),
      });
      setSelectedIds([]);
      setBatchResetOpen(false);
      setBatchResetPassword('');
      setBatchResetConfirmText('');
    } catch (err: any) {
      setError(err.message || '批量重置密码失败');
    } finally {
      setBatchResetSubmitting(false);
    }
  };

  const formatDate = (value?: string) => {
    if (!value) return '-';
    return new Date(value).toLocaleString('zh-CN');
  };

  const formatIdList = (ids: number[]) => {
    if (!ids || ids.length === 0) return '-';
    const maxShow = 30;
    const preview = ids.slice(0, maxShow).join(', ');
    return ids.length > maxShow ? `${preview} ...` : preview;
  };

  const actionBar = (
    <Stack direction="row" spacing={1}>
      {selectedIds.length > 0 && (
        <Button variant="outlined" color="success" onClick={() => void handleBatchUpdateStatus(true)} disabled={loading}>
          批量启用({selectedIds.length})
        </Button>
      )}
      {selectedIds.length > 0 && (
        <Button variant="outlined" color="warning" onClick={() => void handleBatchUpdateStatus(false)} disabled={loading}>
          批量停用({selectedIds.length})
        </Button>
      )}
      {selectedIds.length > 0 && (
        <Button variant="outlined" onClick={handleOpenBatchReset} disabled={loading}>
          批量重置密码({selectedIds.length})
        </Button>
      )}
      {selectedIds.length > 0 && (
        <Button variant="outlined" color="error" onClick={() => void handleBatchDelete()} disabled={loading}>
          批量删除({selectedIds.length})
        </Button>
      )}
      <Button variant="outlined" startIcon={<Download />} onClick={() => void handleExportCsv()} disabled={exporting}>
        {exporting ? '导出中...' : '导出 CSV'}
      </Button>
      <Button variant="contained" startIcon={<Add />} onClick={() => setCreateOpen(true)}>
        新增用户
      </Button>
      <Button variant="outlined" startIcon={<Refresh />} onClick={loadUsers} disabled={loading}>
        刷新
      </Button>
    </Stack>
  );

  return (
    <AdminLayout title="用户管理" subtitle="管理员账号与权限分配" actions={actionBar}>
      <Container maxWidth="lg" sx={{ px: 0 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {batchResult && (
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ mb: 1 }}>
                <Typography variant="h6">批量操作结果</Typography>
                <Chip label={batchResult.actionLabel} color="primary" size="small" />
                <Chip label={`成功 ${batchResult.successCount}`} color="success" size="small" />
                <Chip label={`未找到 ${batchResult.notFoundIds.length}`} size="small" />
                <Chip label={`跳过自身 ${batchResult.skippedSelfIds.length}`} color="warning" size="small" />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                执行时间：{formatDate(batchResult.executedAt)}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                成功 ID：{formatIdList(batchResult.successIds)}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', mb: 0.5 }}>
                未找到 ID：{formatIdList(batchResult.notFoundIds)}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                跳过 ID：{formatIdList(batchResult.skippedSelfIds)}
              </Typography>
            </CardContent>
          </Card>
        )}

        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
              <TextField
                fullWidth
                placeholder="搜索用户名 / 邮箱 / 部门"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search color="action" />
                    </InputAdornment>
                  ),
                }}
              />
              <TextField
                select
                label="状态"
                value={isActive}
                onChange={(event) => {
                  setIsActive(event.target.value as 'all' | 'active' | 'inactive');
                  setPage(0);
                }}
                sx={{ minWidth: 140 }}
              >
                <MenuItem value="all">全部</MenuItem>
                <MenuItem value="active">启用</MenuItem>
                <MenuItem value="inactive">停用</MenuItem>
              </TextField>
              <Button variant="contained" onClick={handleSearch} disabled={loading}>
                查询
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            {loading && items.length === 0 ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={items.length > 0 && selectedIds.length === items.length}
                          indeterminate={selectedIds.length > 0 && selectedIds.length < items.length}
                          onChange={(event) => handleToggleSelectAllCurrentPage(event.target.checked)}
                        />
                      </TableCell>
                      <TableCell>用户名</TableCell>
                      <TableCell>邮箱</TableCell>
                      <TableCell>部门</TableCell>
                      <TableCell>状态</TableCell>
                      <TableCell>最近登录</TableCell>
                      <TableCell>登录次数</TableCell>
                      <TableCell>创建时间</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9} align="center">
                          <Typography color="text.secondary">暂无用户</Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      items.map((user) => (
                        <TableRow key={user.id}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              checked={selectedIds.includes(user.id)}
                              onChange={(event) => handleToggleSelectOne(user.id, event.target.checked)}
                            />
                          </TableCell>
                          <TableCell>{user.username}</TableCell>
                          <TableCell>{user.email || '-'}</TableCell>
                          <TableCell>{user.department || '-'}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={user.is_active ? '启用' : '停用'}
                              color={user.is_active ? 'success' : 'default'}
                            />
                          </TableCell>
                          <TableCell>{formatDate(user.last_login)}</TableCell>
                          <TableCell>{user.login_count ?? 0}</TableCell>
                          <TableCell>{formatDate(user.created_at)}</TableCell>
                          <TableCell align="right">
                            <Stack direction="row" justifyContent="flex-end" spacing={1}>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<Edit />}
                                onClick={() => handleOpenEdit(user)}
                                disabled={actionLoadingUserId === user.id}
                              >
                                编辑
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color={user.is_active ? 'warning' : 'success'}
                                startIcon={<PersonOff />}
                                onClick={() => void handleToggleStatus(user)}
                                disabled={actionLoadingUserId === user.id}
                              >
                                {user.is_active ? '停用' : '启用'}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<LockReset />}
                                onClick={() => handleOpenResetDialog(user)}
                                disabled={actionLoadingUserId === user.id}
                              >
                                重置密码
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                color="error"
                                startIcon={<Delete />}
                                onClick={() => void handleDeleteUser(user)}
                                disabled={actionLoadingUserId === user.id}
                              >
                                删除
                              </Button>
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
                <TablePagination
                  component="div"
                  count={total}
                  page={page}
                  onPageChange={(_, newPage) => setPage(newPage)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(event) => {
                    setRowsPerPage(parseInt(event.target.value, 10));
                    setPage(0);
                  }}
                  rowsPerPageOptions={[10, 20, 50, 100]}
                />
              </>
            )}
          </CardContent>
        </Card>
      </Container>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>新增用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="用户名"
              value={createForm.username}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
              fullWidth
            />
            <TextField
              label="邮箱"
              value={createForm.email}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
              fullWidth
            />
            <TextField
              label="初始密码"
              type="password"
              value={createForm.password}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, password: event.target.value }))}
              fullWidth
            />
            <TextField
              label="姓名"
              value={createForm.full_name}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, full_name: event.target.value }))}
              fullWidth
            />
            <TextField
              label="手机号"
              value={createForm.phone}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, phone: event.target.value }))}
              fullWidth
            />
            <TextField
              label="部门"
              value={createForm.department}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, department: event.target.value }))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} disabled={createSubmitting}>
            取消
          </Button>
          <Button variant="contained" onClick={() => void handleCreateUser()} disabled={createSubmitting}>
            创建
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(resetTarget)}
        onClose={() => {
          setResetTarget(null);
          setResetPassword('');
          setResetConfirmText('');
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>重置密码</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              目标用户：{resetTarget?.username}
            </Typography>
            <TextField
              label="新密码"
              type="password"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              fullWidth
            />
            <TextField
              label={`输入用户名确认（${resetTarget?.username || ''}）`}
              value={resetConfirmText}
              onChange={(event) => setResetConfirmText(event.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setResetTarget(null);
              setResetPassword('');
              setResetConfirmText('');
            }}
            disabled={resetSubmitting}
          >
            取消
          </Button>
          <Button variant="contained" onClick={() => void handleResetPassword()} disabled={resetSubmitting}>
            确认重置
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteConfirmText('');
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>删除用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              该操作将删除用户：{deleteTarget?.username}
            </Typography>
            <TextField
              label={`输入用户名确认（${deleteTarget?.username || ''}）`}
              value={deleteConfirmText}
              onChange={(event) => setDeleteConfirmText(event.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteTarget(null);
              setDeleteConfirmText('');
            }}
            disabled={deleteSubmitting}
          >
            取消
          </Button>
          <Button variant="contained" color="error" onClick={() => void handleConfirmDeleteUser()} disabled={deleteSubmitting}>
            确认删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={batchDeleteOpen}
        onClose={() => {
          setBatchDeleteOpen(false);
          setBatchDeleteConfirmText('');
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>批量删除用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              将批量删除 {selectedIds.length} 个用户，输入 `DELETE` 确认操作。
            </Typography>
            <TextField
              label="确认文本"
              value={batchDeleteConfirmText}
              onChange={(event) => setBatchDeleteConfirmText(event.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setBatchDeleteOpen(false);
              setBatchDeleteConfirmText('');
            }}
            disabled={batchDeleteSubmitting}
          >
            取消
          </Button>
          <Button variant="contained" color="error" onClick={() => void handleConfirmBatchDelete()} disabled={batchDeleteSubmitting}>
            确认批量删除
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={batchResetOpen}
        onClose={() => {
          setBatchResetOpen(false);
          setBatchResetPassword('');
          setBatchResetConfirmText('');
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>批量重置密码</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              将批量重置 {selectedIds.length} 个用户密码，输入 `RESET` 确认操作。
            </Typography>
            <TextField
              label="新密码"
              type="password"
              value={batchResetPassword}
              onChange={(event) => setBatchResetPassword(event.target.value)}
              fullWidth
            />
            <TextField
              label="确认文本"
              value={batchResetConfirmText}
              onChange={(event) => setBatchResetConfirmText(event.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setBatchResetOpen(false);
              setBatchResetPassword('');
              setBatchResetConfirmText('');
            }}
            disabled={batchResetSubmitting}
          >
            取消
          </Button>
          <Button variant="contained" onClick={() => void handleConfirmBatchReset()} disabled={batchResetSubmitting}>
            确认批量重置
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(editTarget)} onClose={() => setEditTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>编辑用户</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              用户名：{editTarget?.username}
            </Typography>
            <TextField
              label="邮箱"
              value={editForm.email}
              onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
              fullWidth
            />
            <TextField
              label="姓名"
              value={editForm.full_name}
              onChange={(event) => setEditForm((prev) => ({ ...prev, full_name: event.target.value }))}
              fullWidth
            />
            <TextField
              label="手机号"
              value={editForm.phone}
              onChange={(event) => setEditForm((prev) => ({ ...prev, phone: event.target.value }))}
              fullWidth
            />
            <TextField
              label="部门"
              value={editForm.department}
              onChange={(event) => setEditForm((prev) => ({ ...prev, department: event.target.value }))}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditTarget(null)} disabled={editSubmitting}>
            取消
          </Button>
          <Button variant="contained" onClick={() => void handleUpdateUser()} disabled={editSubmitting}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={2600} onClose={() => setNotice('')}>
        <Alert onClose={() => setNotice('')} severity="success" sx={{ width: '100%' }}>
          {notice}
        </Alert>
      </Snackbar>
    </AdminLayout>
  );
};

export default UsersPage;
