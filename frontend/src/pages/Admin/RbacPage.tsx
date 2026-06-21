/**
 * 权限管理页面
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardContent,
  Container,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Delete } from '@mui/icons-material';
import { rbacApi, usersApi } from '../../services/adminService';
import type {
  AdminUserItem,
  BindingItem,
  BindingCreateRequest,
  RoleItem,
  ScopeType,
} from '../../types/admin';
import AdminLayout from '../../components/Admin/AdminLayout';
import AdminRefreshButton from '../../components/Admin/AdminRefreshButton';
import { LoadingState } from '../../components/Loading/AppleSpinner';
import { getErrorMessage } from '../../utils/errorMessage';

const scopeOptions: ScopeType[] = ['global', 'tenant', 'project', 'kb'];

const RbacPage: React.FC = () => {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [bindings, setBindings] = useState<BindingItem[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    role_name: '',
    scope_type: 'global' as ScopeType,
    tenant_id: '',
    project_id: '',
    kb_id: '',
    expires_at: '',
  });

  const selectedUser = useMemo(() => {
    if (!selectedUserId) return undefined;
    return users.find((user) => user.id === selectedUserId);
  }, [selectedUserId, users]);

  useEffect(() => {
    void loadInitial();
  }, []);

  const loadInitial = async () => {
    try {
      setLoading(true);
      const [roleData, userData] = await Promise.all([
        rbacApi.getRoles(),
        usersApi.getUsers({ page: 1, page_size: 200 }),
      ]);
      setRoles(roleData || []);
      setUsers(userData?.items || []);
      setError('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, '加载权限数据失败'));
    } finally {
      setLoading(false);
    }
  };

  const loadBindings = async (userId?: number) => {
    try {
      setLoading(true);
      const data = await rbacApi.getBindings(userId ? { user_id: userId } : undefined);
      setBindings(data || []);
      setError('');
    } catch (err: unknown) {
      setError(getErrorMessage(err, '加载绑定失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleUserChange = (value: number | '') => {
    setSelectedUserId(value);
    if (value) {
      void loadBindings(value);
    } else {
      setBindings([]);
    }
  };

  const handleCreate = async () => {
    if (!selectedUserId) {
      setError('请先选择用户');
      return;
    }
    if (!form.role_name) {
      setError('请选择角色');
      return;
    }
    const payload: BindingCreateRequest = {
      user_id: Number(selectedUserId),
      role_name: form.role_name,
      scope_type: form.scope_type,
      tenant_id: form.tenant_id || undefined,
      project_id: form.project_id || undefined,
      kb_id: form.kb_id || undefined,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : undefined,
    };

    try {
      setSaving(true);
      await rbacApi.createBinding(payload);
      setMessage('绑定创建成功');
      await loadBindings(Number(selectedUserId));
    } catch (err: unknown) {
      setError(getErrorMessage(err, '绑定创建失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (bindingId: number) => {
    try {
      setSaving(true);
      await rbacApi.deleteBinding(bindingId);
      setMessage('绑定已删除');
      if (selectedUserId) {
        await loadBindings(Number(selectedUserId));
      } else {
        await loadBindings();
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, '删除绑定失败'));
    } finally {
      setSaving(false);
    }
  };

  const actionBar = (
    <AdminRefreshButton onClick={loadInitial} loading={loading} />
  );

  return (
    <AdminLayout title="权限管理" subtitle="角色、权限与作用域绑定" actions={actionBar}>
      <Container maxWidth="lg" sx={{ px: 0 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {loading && roles.length === 0 ? (
          <LoadingState label="正在加载权限数据" minHeight={320} />
        ) : null}

        <Stack spacing={3}>
          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                选择用户
              </Typography>
              <FormControl fullWidth>
                <InputLabel>用户</InputLabel>
                <Select
                  label="用户"
                  value={selectedUserId}
                  onChange={(event) => {
                    const value = event.target.value as string | number;
                    handleUserChange(value === '' ? '' : Number(value));
                  }}
                >
                  <MenuItem value="">
                    <em>请选择</em>
                  </MenuItem>
                  {users.map((user) => (
                    <MenuItem key={user.id} value={user.id}>
                      {user.username} {user.email ? `(${user.email})` : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                新增绑定
              </Typography>
              <Stack spacing={2}>
                <FormControl fullWidth>
                  <InputLabel>角色</InputLabel>
                  <Select
                    label="角色"
                    value={form.role_name}
                    onChange={(event) => setForm((prev) => ({ ...prev, role_name: String(event.target.value) }))}
                  >
                    <MenuItem value="">
                      <em>请选择</em>
                    </MenuItem>
                    {roles.map((role) => (
                      <MenuItem key={role.id} value={role.name}>
                        {role.name} {role.description ? `- ${role.description}` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>作用域</InputLabel>
                  <Select
                    label="作用域"
                    value={form.scope_type}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, scope_type: event.target.value as ScopeType }))
                    }
                  >
                    {scopeOptions.map((option) => (
                      <MenuItem key={option} value={option}>
                        {option}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  label="Tenant ID"
                  value={form.tenant_id}
                  onChange={(event) => setForm((prev) => ({ ...prev, tenant_id: event.target.value }))}
                  placeholder="可选"
                />
                <TextField
                  label="Project ID"
                  value={form.project_id}
                  onChange={(event) => setForm((prev) => ({ ...prev, project_id: event.target.value }))}
                  placeholder="可选"
                />
                <TextField
                  label="Knowledge Base ID"
                  value={form.kb_id}
                  onChange={(event) => setForm((prev) => ({ ...prev, kb_id: event.target.value }))}
                  placeholder="可选"
                />
                <TextField
                  label="过期时间"
                  type="datetime-local"
                  InputLabelProps={{ shrink: true }}
                  value={form.expires_at}
                  onChange={(event) => setForm((prev) => ({ ...prev, expires_at: event.target.value }))}
                />
                <Button variant="contained" onClick={handleCreate} disabled={saving}>
                  创建绑定
                </Button>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                绑定列表
              </Typography>
              {bindings.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {selectedUser ? '当前用户暂无绑定' : '请先选择用户'}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>角色</TableCell>
                      <TableCell>作用域</TableCell>
                      <TableCell>Tenant</TableCell>
                      <TableCell>Project</TableCell>
                      <TableCell>KB</TableCell>
                      <TableCell>到期时间</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {bindings.map((binding) => (
                      <TableRow key={binding.id}>
                        <TableCell>{binding.role_name}</TableCell>
                        <TableCell>{binding.scope_type}</TableCell>
                        <TableCell>{binding.tenant_id || '-'}</TableCell>
                        <TableCell>{binding.project_id || '-'}</TableCell>
                        <TableCell>{binding.kb_id || '-'}</TableCell>
                        <TableCell>{binding.expires_at ? new Date(binding.expires_at).toLocaleString() : '-'}</TableCell>
                        <TableCell align="right">
                          <IconButton onClick={() => handleDelete(binding.id)} size="small" disabled={saving}>
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Container>

      <Snackbar
        open={!!message}
        autoHideDuration={3000}
        onClose={() => setMessage('')}
        message={message}
      />
    </AdminLayout>
  );
};

export default RbacPage;
