import { screen, fireEvent, waitFor } from '@testing-library/react'
import { ChainDebugTools } from '../chain-debug-tools'
import { renderWithNamespace } from '@/lib/test-utils'

// Mock UI components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) => (
    <button data-testid="button" onClick={onClick} disabled={disabled} className={className}>{children}</button>
  ),
}))

// Mock @aliimam/icons
jest.mock('@aliimam/icons', () => ({
  CommandSquareFilled: ({ className }: { className?: string }) => (
    <svg data-testid="command-icon" className={className} />
  ),
  ArrowDown2Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-down-icon" className={className} />
  ),
  ArrowRight2Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-right-icon" className={className} />
  ),
  DataFilled: ({ className }: { className?: string }) => (
    <svg data-testid="data-icon" className={className} />
  ),
  RefreshFilled: ({ className }: { className?: string }) => (
    <svg data-testid="refresh-icon" className={className} />
  ),
  ActivityFilled: ({ className }: { className?: string }) => (
    <svg data-testid="activity-icon" className={className} />
  ),
  DocumentTextFilled: ({ className }: { className?: string }) => (
    <svg data-testid="doc-icon" className={className} />
  ),
  BotMessageSquare: ({ className }: { className?: string }) => (
    <svg data-testid="bot-icon" className={className} />
  ),
  ClockFilled: ({ className }: { className?: string }) => (
    <svg data-testid="clock-icon" className={className} />
  ),
  SearchNormalFilled: ({ className }: { className?: string }) => (
    <svg data-testid="search-icon" className={className} />
  ),
  ArrowLeft2Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-left-icon" className={className} />
  ),
  SendFilled: ({ className }: { className?: string }) => (
    <svg data-testid="send-icon" className={className} />
  ),
  ArrowUp2Filled: ({ className }: { className?: string }) => (
    <svg data-testid="arrow-up-icon" className={className} />
  ),
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

// Mock useNamespaceFetch
const mockFetchWithNamespace = jest.fn()
jest.mock('@/lib/hooks/use-namespace-fetch', () => ({
  useNamespaceFetch: () => ({
    fetchWithNamespace: mockFetchWithNamespace,
  }),
}))

// Mock unwrapApiData
jest.mock('@/lib/api/api-client', () => ({
  unwrapApiData: (data: { success: boolean; data: unknown }) => data.data,
}))

// Default state response for StateInspector
function mockStateResponse() {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: {
        timestamp: new Date().toISOString(),
        run_id: 'test-run',
        chain_id: 'test-chain',
        status: 'idle',
        current_agent: null,
        variables: { global: {}, chain: {}, agent: {} },
        recent_output: [],
        pending_events: [],
      },
    }),
  }
}

// Default debug action response
function mockDebugResponse(status = 'paused') {
  return {
    ok: true,
    json: async () => ({
      success: true,
      data: { success: true, state: { status } },
    }),
  }
}

describe('ChainDebugTools', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    // Smart mock: return state for state URL, debug response for debug URL
    mockFetchWithNamespace.mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/debug/state')) {
        return mockStateResponse()
      }
      if (url.includes('/debug') && options?.method === 'POST') {
        return mockDebugResponse()
      }
      if (url.includes('/debug') && !url.includes('/debug/state')) {
        // GET debug with ?agent= param
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { prompt: 'test prompt', context: { triggers: ['start'] } },
          }),
        }
      }
      return mockStateResponse()
    })
  })

  it('renders collapsed by default', () => {
    renderWithNamespace(
      <ChainDebugTools chainId="test-chain" agents={[{ id: 'agent-1', name: 'Agent One' }]} />
    )

    expect(screen.getByText('debug tools')).toBeInTheDocument()
    // Console should NOT be visible when collapsed
    expect(screen.queryByText('debug console')).not.toBeInTheDocument()
  })

  it('expands to show debug console and state inspector', async () => {
    renderWithNamespace(
      <ChainDebugTools chainId="test-chain" agents={[{ id: 'agent-1', name: 'Agent One' }]} />
    )

    // Click to expand
    fireEvent.click(screen.getByText('debug tools'))

    expect(screen.getByText('debug console')).toBeInTheDocument()
    // State inspector loads async
    expect(await screen.findByText('state inspector')).toBeInTheDocument()
  })

  it('shows agent names in help text', () => {
    renderWithNamespace(
      <ChainDebugTools
        chainId="test-chain"
        agents={[
          { id: 'agent-1', name: 'Researcher' },
          { id: 'agent-2', name: 'Writer' },
        ]}
      />
    )

    fireEvent.click(screen.getByText('debug tools'))

    expect(screen.getByText(/agent-1 \(Researcher\)/)).toBeInTheDocument()
    expect(screen.getByText(/agent-2 \(Writer\)/)).toBeInTheDocument()
  })

  it('sends pause command to debug API', async () => {
    renderWithNamespace(
      <ChainDebugTools chainId="test-chain" agents={[]} />
    )

    fireEvent.click(screen.getByText('debug tools'))

    // Type "pause" command
    const input = screen.getByPlaceholderText('command...')
    fireEvent.change(input, { target: { value: 'pause' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        '/api/chains/test-chain/debug',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'pause' }),
        })
      )
    })
  })

  it('sends resume command to debug API', async () => {
    renderWithNamespace(
      <ChainDebugTools chainId="test-chain" agents={[]} />
    )

    fireEvent.click(screen.getByText('debug tools'))

    const input = screen.getByPlaceholderText('command...')
    fireEvent.change(input, { target: { value: 'resume' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        '/api/chains/test-chain/debug',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'resume' }),
        })
      )
    })
  })

  it('sends inspect command as GET with agent param', async () => {
    renderWithNamespace(
      <ChainDebugTools chainId="test-chain" agents={[{ id: 'agent-1', name: 'Researcher' }]} />
    )

    fireEvent.click(screen.getByText('debug tools'))

    const input = screen.getByPlaceholderText('command...')
    fireEvent.change(input, { target: { value: 'inspect agent-1' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(mockFetchWithNamespace).toHaveBeenCalledWith(
        '/api/chains/test-chain/debug?agent=agent-1'
      )
    })
  })

  it('rejects unknown commands without hitting API (beyond state fetch)', async () => {
    renderWithNamespace(
      <ChainDebugTools chainId="test-chain" agents={[]} />
    )

    fireEvent.click(screen.getByText('debug tools'))

    // Wait for initial state fetch
    await screen.findByText('state inspector')

    const initialCallCount = mockFetchWithNamespace.mock.calls.length

    const input = screen.getByPlaceholderText('command...')
    fireEvent.change(input, { target: { value: 'rm -rf /' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByText(/unknown command: rm/)).toBeInTheDocument()
    })

    // No additional API calls beyond the initial state fetch
    expect(mockFetchWithNamespace.mock.calls.length).toBe(initialCallCount)
  })

  it('rejects eval and shell commands', async () => {
    renderWithNamespace(
      <ChainDebugTools chainId="test-chain" agents={[]} />
    )

    fireEvent.click(screen.getByText('debug tools'))
    await screen.findByText('state inspector')

    const initialCallCount = mockFetchWithNamespace.mock.calls.length

    const input = screen.getByPlaceholderText('command...')
    fireEvent.change(input, { target: { value: 'eval("malicious")' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(screen.getByText(/unknown command: eval/)).toBeInTheDocument()
    })

    expect(mockFetchWithNamespace.mock.calls.length).toBe(initialCallCount)
  })
})
