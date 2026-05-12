import { render, screen, waitFor } from '@testing-library/react'
import { DashboardStats } from '../dashboard-stats'

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

interface LiveIndicatorMockProps {
  connected: boolean
  size?: 'sm' | 'md'
  showText?: boolean
}

jest.mock('@/components/live-indicator', () => ({
  LiveIndicator: ({ connected, size }: LiveIndicatorMockProps) => (
    <div data-testid="live-indicator" data-connected={connected} data-size={size}>
      {connected ? 'live' : 'offline'}
    </div>
  ),
}))

jest.mock('@aliimam/icons', () => {
  const icon = (name: string) => ({ className }: { className?: string }) => <svg data-testid={`${name}-icon`} className={className} />
  return {
    ActivityFilled: icon('activity'),
    LinkFilled: icon('branch'),
    UserFilled: icon('users'),
    ChartSuccessFilled: icon('check'),
    ChartFailFilled: icon('x'),
    CpuFilled: icon('cpu'),
    DataFilled: icon('data'),
    MonitorFilled: icon('monitor'),
    ClockFilled: icon('clock'),
    ShieldTickFilled: icon('shield'),
    ChartFilled: icon('chart'),
  }
})

jest.mock('@/components/system-status-widget', () => ({
  SystemStatusWidget: () => <div data-testid="system-status">status widget</div>,
}))

// Mock fetch
global.fetch = jest.fn()

describe('DashboardStats', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes('/api/chains')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ chains: Array(5).fill({ id: 'c', name: 'chain', agentCount: 3 }) }),
        })
      }
      if (url.includes('/api/runs')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runs: [
              { id: '1', status: 'running', started: new Date().toISOString() },
              { id: '2', status: 'running', started: new Date().toISOString() },
              { id: '3', status: 'completed', started: new Date().toISOString() },
              { id: '4', status: 'failed', started: new Date().toISOString() },
            ],
          }),
        })
      }
      if (url.includes('/api/agents')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ agents: Array(3).fill({ id: 'a' }) }),
        })
      }
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
  })

  afterEach(() => {
    // Always restore real timers after each test
    jest.useRealTimers()
  })

  describe('rendering', () => {
    it('renders all stat cards', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText(/chains/i)).toBeInTheDocument()
        expect(screen.getByText(/running/i)).toBeInTheDocument()
        expect(screen.getByText(/completed/i)).toBeInTheDocument()
        expect(screen.getByText(/failed/i)).toBeInTheDocument()
        expect(screen.getByText(/agents/i)).toBeInTheDocument()
      })
    })

    it('shows loading state initially', () => {
      render(<DashboardStats />)
      expect(screen.getAllByText(/\.\.\./i).length).toBeGreaterThan(0)
    })

    it('renders system status widget', () => {
      render(<DashboardStats />)
      expect(screen.getByTestId('system-status')).toBeInTheDocument()
    })
  })

  describe('data fetching', () => {
    it('displays chain count', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText('5')).toBeInTheDocument()
      })
    })

    it('displays running runs count', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText('2')).toBeInTheDocument()
      })
    })

    it('displays completed runs count', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        const completedCards = screen.getAllByText('1')
        expect(completedCards.length).toBeGreaterThan(0)
      })
    })

    it('displays failed runs count', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        const failedCards = screen.getAllByText('1')
        expect(failedCards.length).toBeGreaterThan(0)
      })
    })

    it('displays agents count', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        const agentCards = screen.getAllByText('3')
        expect(agentCards.length).toBeGreaterThan(0)
      })
    })

    it('fetches data from correct endpoints', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/chains/list')
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/runs?limit=100'))
        expect(global.fetch).toHaveBeenCalledWith('/api/agents')
      })
    })
  })

  describe('stat card structure', () => {
    it('displays subtext for running stat', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText(/executing now/i)).toBeInTheDocument()
      })
    })

    it('displays subtext for completed stat', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText(/successfully/i)).toBeInTheDocument()
      })
    })

    it('displays subtext for failed stat', async () => {
      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText(/needs attention/i)).toBeInTheDocument()
      })
    })

    it('has proper grid layout', () => {
      const { container } = render(<DashboardStats />)
      const grid = container.querySelector('.grid')
      expect(grid).toBeInTheDocument()
      expect(grid?.className).toContain('grid-cols-2')
    })
  })

  describe('edge cases', () => {
    it('handles empty runs array', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chains')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ chains: [] }),
          })
        }
        if (url.includes('/api/runs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ runs: [] }),
          })
        }
        if (url.includes('/api/agents')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ agents: [] }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      render(<DashboardStats />)

      await waitFor(() => {
        // Wait for loading to complete - check that "..." is gone
        expect(screen.queryAllByText('...').length).toBe(0)
        // Then check for 0 values
        expect(screen.getAllByText('0').length).toBeGreaterThan(0)
      }, { timeout: 3000 })
    })

    it('handles fetch error gracefully', async () => {
      ;(global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'))

      render(<DashboardStats />)

      await waitFor(() => {
        // Should still render even with fetch error
        expect(screen.getByText(/chains/i)).toBeInTheDocument()
      })
    })

    it('handles partial data responses', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chains')) {
          return Promise.resolve({ ok: false, json: async () => ({}) })
        }
        if (url.includes('/api/runs')) {
          return Promise.resolve({ ok: false, json: async () => ({}) })
        }
        return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) })
      })

      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText(/agents/i)).toBeInTheDocument()
      })
    })

    it('handles zero for all stats', async () => {
      ;(global.fetch as jest.Mock).mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ chains: [], runs: [], agents: [] }),
        })
      )

      render(<DashboardStats />)

      await waitFor(() => {
        const zeros = screen.getAllByText('0')
        expect(zeros.length).toBeGreaterThan(0)
      })
    })

    it('handles very large numbers', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chains')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ chains: Array(1000).fill(null) }),
          })
        }
        if (url.includes('/api/runs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              runs: Array(500).fill({ status: 'completed' }),
            }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) })
      })

      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText('1000')).toBeInTheDocument()
        expect(screen.getByText('500')).toBeInTheDocument()
      })
    })
  })

  // TODO: Fix fake timer tests - they cause issues with subsequent tests
  // describe('polling behavior', () => {
  //   it('sets up interval to refresh data', () => {
  //     jest.useFakeTimers()
  //     try {
  //       render(<DashboardStats />)
  //
  //       // Fast forward 8 seconds
  //       jest.advanceTimersByTime(8000)
  //
  //       expect(global.fetch).toHaveBeenCalled()
  //     } finally {
  //       jest.useRealTimers()
  //     }
  //   })
  //
  //   it('clears interval on unmount', () => {
  //     jest.useFakeTimers()
  //     try {
  //       const clearIntervalSpy = jest.spyOn(global, 'clearInterval')
  //
  //       const { unmount } = render(<DashboardStats />)
  //       unmount()
  //
  //       expect(clearIntervalSpy).toHaveBeenCalled()
  //     } finally {
  //       jest.useRealTimers()
  //     }
  //   })
  // })

  describe('run status calculation', () => {
    it('correctly counts running status', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chains')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ chains: [] }),
          })
        }
        if (url.includes('/api/runs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              runs: [
                { id: '1', status: 'running' },
                { id: '2', status: 'running' },
                { id: '3', status: 'running' },
              ],
            }),
          })
        }
        if (url.includes('/api/agents')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ agents: [] }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      render(<DashboardStats />)

      await waitFor(() => {
        expect(screen.getByText('3')).toBeInTheDocument()
      })
    })

    it('correctly counts pending status as running', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chains')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ chains: [] }),
          })
        }
        if (url.includes('/api/runs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              runs: [
                { id: '1', status: 'running' },
                { id: '2', status: 'pending' },
                { id: '3', status: 'completed' },
              ],
            }),
          })
        }
        if (url.includes('/api/agents')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ agents: [] }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      render(<DashboardStats />)

      await waitFor(() => {
        // 2 running/pending
        const runningCards = screen.getAllByText('2')
        expect(runningCards.length).toBeGreaterThan(0)
      })
    })

    it('correctly counts completed status', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chains')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ chains: [] }),
          })
        }
        if (url.includes('/api/runs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              runs: [
                { id: '1', status: 'completed' },
                { id: '2', status: 'completed' },
                { id: '3', status: 'failed' },
              ],
            }),
          })
        }
        if (url.includes('/api/agents')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ agents: [] }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      render(<DashboardStats />)

      await waitFor(() => {
        const completedCards = screen.getAllByText('2')
        expect(completedCards.length).toBeGreaterThan(0)
      })
    })

    it('correctly counts failed status', async () => {
      ;(global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/api/chains')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ chains: [] }),
          })
        }
        if (url.includes('/api/runs')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              runs: [
                { id: '1', status: 'failed' },
                { id: '2', status: 'failed' },
                { id: '3', status: 'completed' },
              ],
            }),
          })
        }
        if (url.includes('/api/agents')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ agents: [] }),
          })
        }
        return Promise.resolve({ ok: true, json: async () => ({}) })
      })

      render(<DashboardStats />)

      await waitFor(() => {
        const failedCards = screen.getAllByText('2')
        expect(failedCards.length).toBeGreaterThan(0)
      })
    })
  })
})
