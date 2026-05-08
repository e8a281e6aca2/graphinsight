import { expect, test, type Page } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'yh@qs.al';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
const adminToken = process.env.E2E_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';
const checkUiLogin = ['1', 'true', 'yes'].includes(
  (process.env.E2E_CHECK_UI_LOGIN || '').trim().toLowerCase()
);

function loginFromUI() {
  test.skip(!checkUiLogin, '默认跳过 UI 登录页验证；如需启用，请设置 E2E_CHECK_UI_LOGIN=1');
  test.skip(!adminPassword, 'UI 登录测试需要 ADMIN_PASSWORD / E2E_ADMIN_PASSWORD');
}

async function authenticate(page: Page) {
  if (adminToken) {
    await page.addInitScript((token: string) => {
      window.localStorage.setItem('admin_token', token);
    }, adminToken);
    return;
  }

  test.skip(!adminPassword, '页面导航测试需要 ADMIN_TOKEN 或 ADMIN_PASSWORD');
  await page.goto('/admin/login');
  await page.getByLabel('邮箱').fill(adminEmail);
  await page.getByLabel('密码').fill(adminPassword);
  const loginResponsePromise = page.waitForResponse((response) =>
    response.url().includes('/api/v1/admin/auth/login')
  );
  await page.getByRole('button', { name: '登录控制台' }).click();
  const loginResponse = await loginResponsePromise;
  if (!loginResponse.ok()) {
    throw new Error(`admin login failed: status=${loginResponse.status()} body=${await loginResponse.text()}`);
  }
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
}

test.describe('Admin Console Core Flow', () => {
  test('admin can login from UI', async ({ page }) => {
    await loginFromUI();
    await page.goto('/admin/login');
    await page.getByLabel('邮箱').fill(adminEmail);
    await page.getByLabel('密码').fill(adminPassword);
    const loginResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/v1/admin/auth/login')
    );
    await page.getByRole('button', { name: '登录控制台' }).click();
    const loginResponse = await loginResponsePromise;
    if (!loginResponse.ok()) {
      throw new Error(`admin login failed: status=${loginResponse.status()} body=${await loginResponse.text()}`);
    }

    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole('heading', { name: '系统仪表板' })).toBeVisible();
    await expect(page.getByText('系统健康状态')).toBeVisible();
  });

  test('authenticated admin can browse core admin pages', async ({ page }) => {
    await authenticate(page);

    await page.goto('/admin/dashboard');
    await expect(page.getByRole('heading', { name: '系统仪表板' })).toBeVisible();

    await page.getByRole('button', { name: '配置中心' }).first().click();
    await expect(page).toHaveURL(/\/admin\/config$/);
    await expect(page.getByRole('heading', { name: '配置中心' })).toBeVisible();
    await page.getByRole('tab', { name: 'AI 服务配置' }).click();
    await expect(page.getByRole('button', { name: /测试当前模型/ })).toBeVisible();

    await page.getByRole('button', { name: '任务中心' }).click();
    await expect(page).toHaveURL(/\/admin\/jobs$/);
    await expect(page.getByRole('heading', { name: '任务中心' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建建图任务' })).toBeVisible();

    await page.getByRole('button', { name: '问答追踪' }).click();
    await expect(page).toHaveURL(/\/admin\/qa-traces$/);
    await expect(page.getByRole('heading', { name: '问答追踪' })).toBeVisible();
    await expect(
      page.getByText('暂无问答追踪记录').or(page.getByRole('table'))
    ).toBeVisible();
  });
});
