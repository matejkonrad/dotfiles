import { expect, test } from 'claude-code/testing'

import { readPaneId } from '../hooks/register'

test('reads the new pane id from herdr tab create', async () => {
  expect(readPaneId('{"result":{"root_pane":{"pane_id":"p12"}}}')).toBe('p12')
})

test('gives no pane id for output herdr did not mean as a tab', async () => {
  expect(readPaneId('error: no such workspace')).toBeNull()
  expect(readPaneId('{"result":{}}')).toBeNull()
})
