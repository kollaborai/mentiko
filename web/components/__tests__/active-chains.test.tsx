import { screen, waitFor } from '@testing-library/react'
import { ActiveChains } from '../active-chains'
import type { Status } from '../status-badge'
import { renderWithNamespace } from '@/lib/test-utils'

interface StatusBadgeMockProps {
  status: Status
  size?: 'sm' | 'md' | 'lg'
}

interface LiveIndicatorMockProps {
  connected: boolean
  size?: 'sm' | 'md'
  showText?: boolean
}

interface LinkMockProps {
  children: React.ReactNode
  href: string
  [key: string]: unknown
}

jest.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({
    workspaceId: 'test-ws',
    workspacePath: '/tmp/test',
    setWorkspaceId: jest.fn(),
    workspaces: [],
    refetch: jest.fn(),
  }),
}))

// Mock dependencies
jest.mock('@/lib/websocket', () => ({
  useWebSocket: () => ({
    connected: true,
    lastEvent: null,
  }),
}))

jest.mock('@/components/status-badge', () => ({
  StatusBadge: ({ status }: StatusBadgeMockProps) => (
    <span data-testid={`status-badge-${status}`}>{status}</span>
  ),
}))

jest.mock('@/components/live-indicator', () => ({
  LiveIndicator: ({ connected, size }: LiveIndicatorMockProps) => (
    <div data-testid="live-indicator" data-connected={connected} data-size={size}>
      {connected ? 'live' : 'offline'}
    </div>
  ),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: LinkMockProps) => <a href={href} {...props}>{children}</a>,
}))

// Mock fetch
global.fetch = jest.fn()

describe('ActiveChains', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ runs: [] }),
    })
  })

  describe('rendering', () => {
    it('renders the component with title', () => {
      renderWithNamespace(<ActiveChains />)
      expect(screen.getByText('Active Chains')).toBeInTheDocument()
    })

    it('shows loading state initially', () => {
      renderWithNamespace(<ActiveChains />)
      expect(screen.getByText(/loading/i)).toBeInTheDocument()
    })

    it('shows empty state when no runs', async () => {
      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.getByText(/no runs yet/i)).toBeInTheDocument()
      })
    })

    it('displays running count in header', async () => {
      const mockRuns = [
        {
          id: 'run-1',
          chain: 'test-chain',
          status: 'running',
          started: new Date().toISOString(),
        },
        {
          id: 'run-2',
          chain: 'test-chain-2',
          status: 'running',
          started: new Date().toISOString(),
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.getByText(/2 running now/i)).toBeInTheDocument()
      })
    })
  })

  describe('run list display', () => {
    it('displays runs when they exist', async () => {
      const mockRuns = [
        {
          id: 'run-1',
          chain: 'my-test-chain',
          status: 'running',
          started: new Date(Date.now() - 30000).toISOString(),
          goal: 'Test the chain',
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.getByText('my-test-chain')).toBeInTheDocument()
        expect(screen.getByText('Test the chain')).toBeInTheDocument()
      })
    })

    it('shows status badge for each run', async () => {
      const mockRuns = [
        {
          id: 'run-1',
          chain: 'test-chain',
          status: 'completed',
          started: new Date().toISOString(),
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.getByTestId('status-badge-completed')).toBeInTheDocument()
      })
    })

    it('displays relative time for runs', async () => {
      const mockRuns = [
        {
          id: 'run-1',
          chain: 'test-chain',
          status: 'running',
          started: new Date(Date.now() - 60000).toISOString(),
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.getByText(/ago/)).toBeInTheDocument()
      })
    })
  })

  describe('interaction', () => {
    it('links to run detail pages', async () => {
      const mockRuns = [
        {
          id: 'run-123',
          chain: 'test-chain',
          status: 'running',
          started: new Date().toISOString(),
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        const link = screen.getByRole('link', { name: /view run details for test-chain/i })
        expect(link).toHaveAttribute('href', '/runs?runId=run-123')
      })
    })

    it('has view all link to runs page', () => {
      renderWithNamespace(<ActiveChains />)
      const viewAllLink = screen.getByText(/view all/i).closest('a')
      expect(viewAllLink).toHaveAttribute('href', '/runs')
    })
  })

  describe('edge cases', () => {
    it('handles run with no goal', async () => {
      const mockRuns = [
        {
          id: 'run-1',
          chain: 'test-chain',
          status: 'running',
          started: new Date().toISOString(),
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.getByText(/no goal specified/i)).toBeInTheDocument()
      })
    })

    it('handles fetch error gracefully', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
      })
    })

    it('limits display to 6 runs', async () => {
      const mockRuns = Array.from({ length: 10 }, (_, i) => ({
        id: `run-${i}`,
        chain: `chain-${i}`,
        status: 'running' as const,
        started: new Date().toISOString(),
      }))
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        const links = screen.getAllByRole('link')
        // Should have 6 run links + 1 view all link
        const runLinks = links.filter(l => l.getAttribute('href')?.startsWith('/runs?runId='))
        expect(runLinks.length).toBe(6)
      })
    })

    it('displays different status icons', async () => {
      const mockRuns = [
        {
          id: 'run-1',
          chain: 'running-chain',
          status: 'running' as const,
          started: new Date().toISOString(),
        },
        {
          id: 'run-2',
          chain: 'pending-chain',
          status: 'pending' as const,
          started: new Date().toISOString(),
        },
        {
          id: 'run-3',
          chain: 'failed-chain',
          status: 'failed' as const,
          started: new Date().toISOString(),
        },
      ]
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ runs: mockRuns }),
      })

      renderWithNamespace(<ActiveChains />)
      await waitFor(() => {
        expect(screen.getByTestId('status-badge-running')).toBeInTheDocument()
        expect(screen.getByTestId('status-badge-pending')).toBeInTheDocument()
        expect(screen.getByTestId('status-badge-failed')).toBeInTheDocument()
      })
    })
  })
})
