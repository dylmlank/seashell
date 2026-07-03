import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const SCREENSHOT_DIR = join(__dirname, '__screenshots__')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const userData = join(tmpdir(), 'claude-shell-e2e-resume-userdata')
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })

  app = await electron.launch({
    args: [join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: { ...process.env, CLAUDE_SHELL_USER_DATA: userData } as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('landing page lists recent sessions and resumes with context', async () => {
  test.skip(!!process.env.CI, 'needs Claude credentials and prior session history')

  await expect(page.getByText('Recent sessions')).toBeVisible()
  await page.screenshot({ path: join(SCREENSHOT_DIR, '11-landing-history.png') })

  // Resume a session from the smoke tests (they start with a package.json question).
  const pastSession = page.locator('[title*="package.json in this folder"]').first()
  await pastSession.waitFor({ timeout: 15_000 })
  await pastSession.click()

  // The stored transcript should be rebuilt in the chat view.
  await expect(page.getByText('Read package.json in this folder', { exact: false }).first()).toBeVisible(
    { timeout: 30_000 }
  )
  await page.screenshot({ path: join(SCREENSHOT_DIR, '12-resumed-replay.png') })

  // And Claude should still have the conversation context.
  const composer = page.getByPlaceholder(/message claude/i)
  await composer.fill(
    'Earlier in this conversation you found a package name. Reply with only that name in UPPERCASE.'
  )
  await composer.press('Enter')
  await expect(page.locator('.md', { hasText: /DEMO-PROJECT/ })).toBeVisible({ timeout: 90_000 })
  await page.screenshot({ path: join(SCREENSHOT_DIR, '13-resumed-context.png') })
})
