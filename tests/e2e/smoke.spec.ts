import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const SCREENSHOT_DIR = join(__dirname, '__screenshots__')
const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'demo-project')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true })
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(
    join(FIXTURE_DIR, 'package.json'),
    JSON.stringify({ name: 'demo-project', version: '1.0.0', description: 'Fixture for e2e' }, null, 2)
  )

  // Fresh app profile per run: tests never read or write the real settings.
  const userData = join(tmpdir(), 'claude-shell-e2e-smoke-userdata')
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })

  app = await electron.launch({
    args: [join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: { ...process.env, CLAUDE_SHELL_USER_DATA: userData } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Stub the native folder picker to return the fixture project.
  const fixture = FIXTURE_DIR.replace(/\\/g, '/')
  await app.evaluate(({ dialog }, fixturePath) => {
    dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [fixturePath] }) as Electron.OpenDialogReturnValue
  }, fixture)
})

test.afterAll(async () => {
  await app?.close()
})

test('landing page renders', async () => {
  await expect(page.getByRole('heading', { name: 'Claude Shell' })).toBeVisible()
  await page.screenshot({ path: join(SCREENSHOT_DIR, '01-landing.png') })
})

test('open project creates a session', async () => {
  await page.getByRole('button', { name: /open a project folder/i }).click()
  // Chat view appears with a tab for the fixture project
  await expect(page.getByTestId('tab').filter({ hasText: 'demo-project' })).toBeVisible({
    timeout: 30_000
  })
  await page.screenshot({ path: join(SCREENSHOT_DIR, '02-chat-empty.png') })
})

/**
 * Claude may nondeterministically touch paths that need permission (e.g. a
 * stray out-of-cwd read). While waiting for `locator`, answer any approval
 * modal with Allow so the turn can proceed.
 */
async function waitForWithAutoApprove(locator: ReturnType<Page['locator']>): Promise<void> {
  const allow = page.getByRole('button', { name: /allow/i })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (await locator.isVisible().catch(() => false)) return
    if (await allow.isVisible().catch(() => false)) await allow.click().catch(() => {})
    await page.waitForTimeout(500)
  }
  await expect(locator).toBeVisible({ timeout: 1 })
}

test('streaming chat with a tool call', async () => {
  test.skip(!!process.env.CI, 'needs Claude credentials')
  const composer = page.getByPlaceholder(/message claude/i)
  await composer.fill(
    'Read package.json in this folder and tell me the package name. Reply in one short sentence.'
  )
  await composer.press('Enter')

  // The assistant's answer should mention the package name (allowing any
  // permission prompts raised along the way)...
  await waitForWithAutoApprove(page.locator('.md', { hasText: 'demo-project' }))
  // ...and at least one tool card should have been rendered.
  await expect(page.locator('button', { hasText: /Read|Glob|Bash/ }).first()).toBeVisible()
  await page.screenshot({ path: join(SCREENSHOT_DIR, '04-answer.png') })
})

test('write triggers approval modal; deny feeds back', async () => {
  test.skip(!!process.env.CI, 'needs Claude credentials')
  const composer = page.getByPlaceholder(/message claude/i)
  await composer.fill(
    'Create a file named hello.txt in this folder containing exactly: hi. Do not do anything else. If you cannot create it, reply with the single word: blocked'
  )
  await composer.press('Enter')

  // The approval modal should appear for the Write tool.
  const denyButton = page.getByRole('button', { name: /deny/i })
  await expect(denyButton).toBeVisible({ timeout: 90_000 })
  await page.screenshot({ path: join(SCREENSHOT_DIR, '05-approval-modal.png') })

  await page
    .getByPlaceholder(/tell claude why/i)
    .fill('Not allowed in this test — reply with the single word: blocked')
  await denyButton.click()

  // Claude should acknowledge the denial.
  await expect(page.locator('.md', { hasText: /blocked/i })).toBeVisible({ timeout: 90_000 })
  await page.screenshot({ path: join(SCREENSHOT_DIR, '06-deny-feedback.png') })
})

test('two tabs stream independently without cross-talk', async () => {
  test.skip(!!process.env.CI, 'needs Claude credentials')

  // Second fixture folder for the new tab.
  const fixtureB = join(__dirname, '..', 'fixtures', 'demo-project-b')
  mkdirSync(fixtureB, { recursive: true })
  writeFileSync(join(fixtureB, 'README.md'), '# demo b')
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [p] }) as Electron.OpenDialogReturnValue
  }, fixtureB.replace(/\\/g, '/'))

  // Send a marker prompt in tab 1, then immediately open tab 2.
  const composer = page.getByPlaceholder(/message claude/i)
  await composer.fill('Reply with exactly the single word: APPLE')
  await composer.press('Enter')

  await page.getByTitle('New session (pick a folder)').click()
  await expect(page.getByTestId('tab').filter({ hasText: 'demo-project-b' })).toBeVisible({
    timeout: 30_000
  })

  // Tab 2 sends its own marker while tab 1 may still be streaming.
  await composer.fill('Reply with exactly the single word: BANANA')
  await composer.press('Enter')
  await waitForWithAutoApprove(page.locator('.md', { hasText: 'BANANA' }))
  await expect(page.locator('.md', { hasText: 'APPLE' })).toHaveCount(0)
  await page.screenshot({ path: join(SCREENSHOT_DIR, '07-tab2.png') })

  // Switch back to tab 1: APPLE is there, BANANA is not.
  await page.getByTestId('tab').filter({ hasText: /^demo-project$/ }).first().click()
  await waitForWithAutoApprove(page.locator('.md', { hasText: 'APPLE' }))
  await expect(page.locator('.md', { hasText: 'BANANA' })).toHaveCount(0)
  await page.screenshot({ path: join(SCREENSHOT_DIR, '08-tab1-isolated.png') })
})
