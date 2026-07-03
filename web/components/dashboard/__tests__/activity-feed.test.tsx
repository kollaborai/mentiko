import { render, screen, waitFor } from '@testing-library/react'
import { ActivityFeed } from '../activity-feed'

let mockRuns: Array<{
  id: string
  chain: string
  status: string
  started: string
}>

jest.mock('@/lib/ui-context/workspace-context', () => ({
  useWorkspace: () => ({
    workspaceId: 'test-ws',
    workspacePath: '/tmp/test',
    setWorkspaceId: jest.fn(),
    workspaces: [],
    refetch: jest.fn(),
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/lib/runs/runs-store', () => ({
  useSharedRuns: () => ({ runs: mockRuns ?? [], loading: false }),
}))

global.fetch = jest.fn()

describe('ActivityFeed', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRuns = [
      {
        id: 'run-1',
        chain: 'recoverable-chain',
        status: 'running',
        started: new Date(Date.now() - 30000).toISOString(),
      },
    ]
  })

  it('keeps shared runs visible when events cannot be fetched', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    ;(global.fetch as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'))

    render(<ActivityFeed />)

    await waitFor(() => {
      expect(screen.getByText('recoverable-chain')).toBeInTheDocument()
    })
    expect(consoleError).not.toHaveBeenCalled()

    consoleError.mockRestore()
  })
})
