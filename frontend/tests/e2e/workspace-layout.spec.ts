import { expect, test, type Page } from '@playwright/test';

const adminToken = process.env.E2E_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';

async function authenticate(page: Page) {
  test.skip(!adminToken, '工作区布局回归测试需要 ADMIN_TOKEN / E2E_ADMIN_TOKEN');
  await page.addInitScript((token: string) => {
    window.localStorage.setItem('admin_token', token);
  }, adminToken);
}

test.describe('Workspace Layout', () => {
  test('keeps right panel visible and can switch graph renderer at medium width', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await authenticate(page);

    await page.goto('/workspace?graph_demo=1');
    await page.getByRole('tab', { name: '关系图谱' }).click();

    const rightPanel = page.getByTestId('workspace-right-panel');
    await expect(rightPanel).toBeVisible();
    await expect(rightPanel.getByRole('tab', { name: '详情' })).toBeVisible();
    await expect(rightPanel.getByRole('tab', { name: '统计' })).toBeVisible();
    await expect(rightPanel.getByRole('tab', { name: '分析' })).toBeVisible();
    await expect(rightPanel.getByRole('tab', { name: '控制' })).toBeVisible();

    await expect(page.getByTestId('graph-canvas-root')).toBeVisible();
    await expect(page.getByRole('button', { name: '切换到 3D' })).toBeVisible();
    await page.getByRole('button', { name: '切换到 3D' }).click();
    await expect(page.getByRole('button', { name: '切换到 2D' })).toBeVisible();
    await expect(page.getByTestId('graph-canvas-3d')).toBeVisible();
    await expect(rightPanel).toBeVisible();
  });
});
