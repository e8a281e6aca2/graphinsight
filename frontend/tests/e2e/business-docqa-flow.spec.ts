import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.ADMIN_EMAIL || 'yh@qs.al';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || '';
const adminToken = process.env.E2E_ADMIN_TOKEN || process.env.ADMIN_TOKEN || '';
const apiBaseUrl = (process.env.VITE_API_BASE_URL || 'http://127.0.0.1:8081').replace(/\/+$/, '');

type LoginResponse = {
  code: number;
  data?: {
    token?: string;
  };
};

type TraceListResponse = {
  code: number;
  data?: {
    items?: Array<{
      id: number;
      trace_id?: string | null;
      qa_type?: string;
      status?: string;
      question?: string;
    }>;
  };
};

type TraceDetailResponse = {
  code: number;
  data?: {
    trace_id?: string | null;
    qa_type?: string;
    status?: string;
    question?: string;
    citation_count?: number;
    answer_preview?: string | null;
  };
};

type TraceLookupResult = {
  id: number;
  traceId: string;
};

async function getAdminBearer(request: APIRequestContext) {
  if (adminToken) {
    return adminToken;
  }

  test.skip(!adminPassword, '业务链路测试需要 ADMIN_TOKEN 或 ADMIN_PASSWORD');

  const response = await request.post(`${apiBaseUrl}/api/v1/admin/auth/login`, {
    data: {
      username: adminEmail,
      password: adminPassword,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `admin login failed via request context: status=${response.status()} body=${await response.text()} baseUrl=${apiBaseUrl}`
    );
  }
  const body = (await response.json()) as LoginResponse;
  expect(body.code).toBe(200);
  expect(body.data?.token).toBeTruthy();
  return body.data!.token!;
}

async function waitForTraceByKeyword(
  request: APIRequestContext,
  bearer: string,
  keyword: string
): Promise<TraceLookupResult> {
  const deadline = Date.now() + 120_000;
  let lastBody: TraceListResponse | null = null;

  while (Date.now() < deadline) {
    const response = await request.get(`${apiBaseUrl}/api/v1/admin/qa-traces`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
      params: {
        keyword,
        page: '1',
        page_size: '10',
      },
    });
    expect(response.ok()).toBeTruthy();
    lastBody = (await response.json()) as TraceListResponse;
    const items = lastBody.data?.items || [];
    const matched = items.find((item) => item.question?.includes(keyword));
    if (matched?.trace_id) {
      return {
        id: matched.id,
        traceId: matched.trace_id,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  throw new Error(`QA trace not found by keyword=${keyword}; lastBody=${JSON.stringify(lastBody)}`);
}

async function openHome(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '文档问答' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '文档' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '图谱' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '文档库' })).toBeVisible();
}

function documentActionCard(page: Page, fileName: string, actionName: '删除' | '恢复') {
  return page
    .getByRole('heading', { name: fileName })
    .locator(`xpath=ancestor::*[button[normalize-space()="${actionName}"]][1]`);
}

test.describe('Business DocQA Flow', () => {
  test('upload, build, ask, trace, delete', async ({ page, request }) => {
    test.setTimeout(480_000);

    const bearer = await getAdminBearer(request);
    const uniqueId = `e2e-${Date.now()}`;
    const fileName = `codex-docqa-${uniqueId}.txt`;
    const traceKeyword = `TRACE-${uniqueId}`;
    const question = `这份文档主要用于验证什么？请忽略标记 ${traceKeyword}。`;

    await page.addInitScript((token: string) => {
      window.localStorage.setItem('admin_token', token);
    }, bearer);

    await openHome(page);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(
        [
          'GraphInsight business flow smoke document.',
          'Purpose: verify upload, build graph, docqa trace, and soft delete flow.',
          'This document is created by Playwright E2E for the local environment.',
          'Question expectation: the answer should mention verification or smoke flow.',
          'Current QA model target: qwen-flash.',
        ].join('\n'),
        'utf-8'
      ),
    });

    await expect(page.getByText(/上传成功\s+\d+\s+·\s+跳过\s+\d+/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(fileName)).toBeVisible({ timeout: 30_000 });

    const buildButton = page.getByRole('button', { name: '一键建图' });
    await buildButton.click();
    await expect(page.getByRole('button', { name: '已完成建图' })).toBeVisible({ timeout: 240_000 });

    const qaInput = page.getByPlaceholder('输入问题，Enter 发送，Shift+Enter 换行');
    await qaInput.fill(question);
    await qaInput.press('Enter');

    await expect(page.getByText(question)).toBeVisible();
    await expect(page.getByText(/引用摘要（\d+）/)).toBeVisible({ timeout: 180_000 });
    await expect(
      page.getByText(/验证|上传|建图|问答|链路|smoke/i).first()
    ).toBeVisible({ timeout: 180_000 });

    const trace = await waitForTraceByKeyword(request, bearer, traceKeyword);
    const traceDetailResponse = await request.get(`${apiBaseUrl}/api/v1/admin/qa-traces/${trace.id}`, {
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
    });
    expect(traceDetailResponse.ok()).toBeTruthy();
    const traceDetail = (await traceDetailResponse.json()) as TraceDetailResponse;
    expect(traceDetail.code).toBe(200);
    expect(traceDetail.data?.trace_id).toBe(trace.traceId);
    expect(traceDetail.data?.qa_type).toBe('docqa');
    expect(traceDetail.data?.status).toBe('success');
    expect(traceDetail.data?.question).toContain(traceKeyword);
    expect((traceDetail.data?.citation_count || 0) >= 1).toBeTruthy();

    await page.getByRole('tab', { name: '文档' }).click();
    const activeCard = documentActionCard(page, fileName, '删除');
    page.once('dialog', (dialog) => dialog.accept());
    await activeCard.getByRole('button', { name: '删除' }).click();

    await expect(page.getByText(`已移入回收站 ${fileName}`, { exact: false })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByRole('heading', { name: /回收站（\d+）/ })).toBeVisible();
    await expect(documentActionCard(page, fileName, '删除')).toHaveCount(0);
    await expect(documentActionCard(page, fileName, '恢复')).toHaveCount(1);
  });
});
