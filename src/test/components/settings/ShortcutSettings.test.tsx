import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ShortcutSettings from '@/components/settings/ShortcutSettings'
import { defaultShortcuts, useSettingsStore } from '@/stores/settingsStore'

describe('ShortcutSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      shortcuts: defaultShortcuts,
      shortcutsEnabled: true,
    })
  })

  afterEach(() => {
    cleanup()
    useSettingsStore.setState({ shortcutsEnabled: true })
  })

  it('toggles keyboard shortcuts from the settings page', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettings />)

    const toggle = screen.getByRole('checkbox', { name: '启用快捷键' })
    expect(toggle).toBeChecked()

    await user.click(toggle)

    expect(useSettingsStore.getState().shortcutsEnabled).toBe(false)
  })
})
