import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import { test, expect } from '@playwright/test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const SCREENSHOT_DIR = join(__dirname, '__screenshots__')

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // A config dir with no .credentials.json → app should show onboarding.
  const emptyConfig = join(tmpdir(), 'claude-shell-e2e-empty-config')
  mkdirSync(emptyConfig, { recursive: true })

  const userData = join(tmpdir(), 'claude-shell-e2e-userdata')
  rmSync(userData, { recursive: true, force: true }) // fresh profile — no stored token
  mkdirSync(userData, { recursive: true })
  const env = {
    ...process.env,
    CLAUDE_CONFIG_DIR: emptyConfig,
    CLAUDE_SHELL_USER_DATA: userData
  }
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  delete env.ANTHROPIC_API_KEY

  app = await electron.launch({
    args: [join(__dirname, '..', '..', 'out', 'main', 'index.js')],
    env: env as Record<string, string>
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('logged-out state shows onboarding with token entry', async () => {
  await expect(page.getByText('Log in with your Claude account')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /open terminal/i })).toBeVisible()
  await page.screenshot({ path: join(SCREENSHOT_DIR, '09-onboarding.png') })

  // Bogus token is rejected with a friendly error.
  await page.getByPlaceholder(/paste your token/i).fill('not-a-token')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/does not look like a Claude token/i)).toBeVisible()

  // A well-formed token is accepted and unlocks the app.
  await page.getByPlaceholder(/paste your token/i).fill('sk-ant-oat01-e2e-fake-token')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByRole('heading', { name: 'Claude Shell' })).toBeVisible({
    timeout: 10_000
  })
  await page.screenshot({ path: join(SCREENSHOT_DIR, '10-after-login.png') })
})
