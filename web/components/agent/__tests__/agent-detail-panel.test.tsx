import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentDetailPanel, type AgentDetail } from '../agent-detail-panel'

jest.mock('@/lib/workspace-context', () => ({
  useWorkspace: () => ({
    workspaceId: 'test-ws',
    workspacePath: '/tmp/test',
    setWorkspaceId: jest.fn(),
    workspaces: [],
    refetch: jest.fn(),
  }),
}))

jest.mock('@/components/agent/agent-avatar', () => ({
  AgentAvatar: ({ seed }: { seed: string }) => <div data-testid="agent-avatar">{seed}</div>,
}))

// Mock the UI components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
}))

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>{children}</span>
  ),
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <button data-testid="button" onClick={onClick} className={className}>{children}</button>
  ),
}))

// Mock lucide-react icons (component still uses some from lucide)
jest.mock('lucide-react', () => ({
  Bot: () => <span data-testid="bot-icon" />,
  Clock: () => <span data-testid="clock-icon" />,
  RotateCw: () => <span data-testid="rotate-icon" />,
  FileText: () => <span data-testid="file-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  FolderOpen: () => <span data-testid="folder-icon" />,
  MessageSquare: () => <span data-testid="message-icon" />,
  Copy: () => <span data-testid="copy-icon" />,
  Check: () => <span data-testid="check-icon" />,
}))

// Mock @aliimam/icons (chevrons migrated here, plus icons used by child components)
jest.mock('@aliimam/icons', () => ({
  ArrowDown1Filled: () => <span data-testid="chevron-down" />,
  ArrowRight1Filled: () => <span data-testid="chevron-right" />,
  CopyFilled: () => <span data-testid="copy-icon" />,
  TickCircleFilled: () => <span data-testid="check-icon" />,
}))

const createMockAgent = (overrides?: Partial<AgentDetail>): AgentDetail => ({
  id: 'test-agent',
  name: 'Test Agent',
  role: 'Testing everything',
  prompt: 'This is a test prompt for the agent. It should be long enough to test truncation.',
  triggers: ['manual-start', 'event-a'],
  emits: 'test-complete',
  status: 'pending',
  timeout: 30,
  retry: { max_retries: 3, backoff: 'exponential' },
  gateway: 'anthropic',
  context: {
    workspace: '/test/workspace',
    read_first: ['file1.ts', 'file2.ts'],
  },
  authorities: {
    can: ['read', 'write'],
    needs_approval: ['delete'],
  },
  ...overrides,
})

describe('AgentDetailPanel', () => {
  describe('rendering - collapsed state', () => {
    it('renders agent name', () => {
      render(<AgentDetailPanel agent={createMockAgent()} />)
      expect(screen.getByText('Test Agent')).toBeInTheDocument()
    })

    it('renders agent role when not compact', () => {
      render(<AgentDetailPanel agent={createMockAgent()} />)
      expect(screen.getByText('Testing everything')).toBeInTheDocument()
    })

    it('does not render role when compact', () => {
      render(<AgentDetailPanel agent={createMockAgent()} compact />)
      expect(screen.queryByText('Testing everything')).not.toBeInTheDocument()
    })

    it('renders agent id badge', () => {
      render(<AgentDetailPanel agent={createMockAgent()} />)
      expect(screen.getAllByText('test-agent').length).toBeGreaterThanOrEqual(1)
    })

    it('renders status badge when status provided', () => {
      render(<AgentDetailPanel agent={createMockAgent({ status: 'running' })} />)
      expect(screen.getByText('running')).toBeInTheDocument()
    })

    it('does not render status badge when status not provided', () => {
      render(<AgentDetailPanel agent={createMockAgent({ status: undefined })} />)
      expect(screen.queryByText('pending')).not.toBeInTheDocument()
    })

    it('renders chevron right when collapsed', () => {
      render(<AgentDetailPanel agent={createMockAgent()} />)
      expect(screen.getByTestId('chevron-right')).toBeInTheDocument()
      expect(screen.queryByTestId('chevron-down')).not.toBeInTheDocument()
    })

    it('renders gateway badge when provided', () => {
      render(<AgentDetailPanel agent={createMockAgent({ gateway: 'openai' })} defaultExpanded={true} />)
      expect(screen.getAllByText('openai').length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('expand/collapse behavior', () => {
    it('expands when header is clicked', async () => {
      const user = userEvent.setup()
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={false} />)

      const button = screen.getByRole('button')
      await user.click(button)

      expect(screen.getByTestId('chevron-down')).toBeInTheDocument()
      expect(screen.queryByTestId('chevron-right')).not.toBeInTheDocument()
    })

    it('collapses when expanded header is clicked', async () => {
      const user = userEvent.setup()
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={true} />)

      expect(screen.getByTestId('chevron-down')).toBeInTheDocument()

      const buttons = screen.getAllByRole('button')
      await user.click(buttons[0])

      expect(screen.getByTestId('chevron-right')).toBeInTheDocument()
    })

    it('starts expanded when defaultExpanded is true', () => {
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={true} />)
      expect(screen.getByTestId('chevron-down')).toBeInTheDocument()
    })

    it('starts collapsed when defaultExpanded is false', () => {
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={false} />)
      expect(screen.getByTestId('chevron-right')).toBeInTheDocument()
    })
  })

  describe('expanded details', () => {
    it('shows id when expanded', () => {
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={true} />)
      expect(screen.getAllByText('test-agent').length).toBeGreaterThanOrEqual(1)
    })

    it('shows role section', () => {
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={true} />)
      expect(screen.getByText('role')).toBeInTheDocument()
      // Role appears twice - once in header, once in expanded section
      expect(screen.getAllByText('Testing everything').length).toBeGreaterThanOrEqual(1)
    })

    it('shows triggers section', () => {
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={true} />)
      expect(screen.getByText('triggers')).toBeInTheDocument()
      expect(screen.getByText('manual-start')).toBeInTheDocument()
      expect(screen.getByText('event-a')).toBeInTheDocument()
    })

    it('shows none when triggers empty', () => {
      render(<AgentDetailPanel agent={createMockAgent({ triggers: [] })} defaultExpanded={true} />)
      expect(screen.getByText('none (starts chain)')).toBeInTheDocument()
    })

    it('shows emits section', () => {
      render(<AgentDetailPanel agent={createMockAgent()} defaultExpanded={true} />)
      expect(screen.getByText('emits')).toBeInTheDocument()
      expect(screen.getByText('test-complete')).toBeInTheDocument()
    })

    it('shows (none) when emits is empty', () => {
      render(<AgentDetailPanel agent={createMockAgent({ emits: '' })} defaultExpanded={true} />)
      expect(screen.getByText('(none)')).toBeInTheDocument()
    })

    it('shows timeout section when timeout exists', () => {
      render(<AgentDetailPanel agent={createMockAgent({ timeout: 60 })} defaultExpanded={true} />)
      expect(screen.getByText('timeout')).toBeInTheDocument()
      expect(screen.getByText('60s')).toBeInTheDocument()
    })

    it('shows retry section when retry config exists', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        retry: { max_retries: 5, backoff: 'linear' }
      })} defaultExpanded={true} />)
      expect(screen.getByText('retry')).toBeInTheDocument()
      expect(screen.getByText('5x · linear')).toBeInTheDocument()
    })

    it('does not show timeout/retry section when neither exist', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        timeout: undefined,
        retry: undefined
      })} defaultExpanded={true} />)
      expect(screen.queryByText('timeout')).not.toBeInTheDocument()
      expect(screen.queryByText('retry')).not.toBeInTheDocument()
    })
  })

  describe('authorities section', () => {
    it('shows authorities section when provided', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        authorities: {
          can: ['read', 'write', 'execute'],
          needs_approval: ['delete', 'sudo']
        }
      })} defaultExpanded={true} />)
      expect(screen.getByText('authorities')).toBeInTheDocument()
      expect(screen.getByText('can')).toBeInTheDocument()
      expect(screen.getByText('needs approval')).toBeInTheDocument()
    })

    it('shows none when can array is empty', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        authorities: { can: [], needs_approval: ['delete'] }
      })} defaultExpanded={true} />)
      expect(screen.getByText('authorities')).toBeInTheDocument()
      expect(screen.getByText('none')).toBeInTheDocument()
    })

    it('shows none when needs_approval array is empty', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        authorities: { can: ['read'], needs_approval: [] }
      })} defaultExpanded={true} />)
      const canText = screen.getAllByText('none')
      expect(canText.length).toBeGreaterThan(0)
    })

    it('does not show authorities section when not provided', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        authorities: undefined
      })} defaultExpanded={true} />)
      expect(screen.queryByText('authorities')).not.toBeInTheDocument()
    })
  })

  describe('context section', () => {
    it('shows context section when provided', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        context: {
          workspace: '/my/workspace',
          read_first: ['file.ts', 'test.ts']
        }
      })} defaultExpanded={true} />)
      expect(screen.getByText('context')).toBeInTheDocument()
      expect(screen.getByText('workspace')).toBeInTheDocument()
      expect(screen.getByText('read first')).toBeInTheDocument()
    })

    it('shows workspace path', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        context: { workspace: '/test/path' }
      })} defaultExpanded={true} />)
      expect(screen.getByText('/test/path')).toBeInTheDocument()
    })

    it('shows none when read_first is empty', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        context: { workspace: '/test', read_first: [] }
      })} defaultExpanded={true} />)
      expect(screen.getByText('none')).toBeInTheDocument()
    })

    it('does not show context section when not provided', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        context: undefined
      })} defaultExpanded={true} />)
      expect(screen.queryByText('context')).not.toBeInTheDocument()
    })
  })

  describe('prompt preview', () => {
    it('shows prompt section when prompt exists', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        prompt: 'Test prompt content'
      })} defaultExpanded={true} />)
      expect(screen.getByText('prompt')).toBeInTheDocument()
      expect(screen.getByText('Test prompt content')).toBeInTheDocument()
    })

    it('truncates long prompts by default', () => {
      const longPrompt = 'a'.repeat(300)
      render(<AgentDetailPanel agent={createMockAgent({
        prompt: longPrompt
      })} defaultExpanded={true} />)
      expect(screen.getByText(/^a{200}\.\.\.$/)).toBeInTheDocument()
    })

    it('shows show more button for long prompts', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        prompt: 'a'.repeat(300)
      })} defaultExpanded={true} />)
      expect(screen.getByText('show more')).toBeInTheDocument()
    })

    it('expands prompt when show more is clicked', async () => {
      const user = userEvent.setup()
      const longPrompt = 'a'.repeat(300)
      render(<AgentDetailPanel agent={createMockAgent({
        prompt: longPrompt
      })} defaultExpanded={true} />)

      const showMoreButton = screen.getByText('show more')
      await user.click(showMoreButton)

      expect(screen.getByText('show less')).toBeInTheDocument()
      expect(screen.getByText(longPrompt)).toBeInTheDocument()
    })

    it('does not show show more button for short prompts', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        prompt: 'Short prompt'
      })} defaultExpanded={true} />)
      expect(screen.queryByText('show more')).not.toBeInTheDocument()
    })

    it('does not show prompt section when prompt is empty', () => {
      render(<AgentDetailPanel agent={createMockAgent({
        prompt: undefined
      })} defaultExpanded={true} />)
      expect(screen.queryByText('prompt')).not.toBeInTheDocument()
    })
  })

  describe('status colors', () => {
    it('applies pending status color', () => {
      const { container } = render(<AgentDetailPanel agent={createMockAgent({
        status: 'pending'
      })} />)
      const badge = container.querySelector('[data-testid="badge"]')
      expect(badge).toHaveClass('bg-yellow-500/20')
    })

    it('applies running status color', () => {
      const { container } = render(<AgentDetailPanel agent={createMockAgent({
        status: 'running'
      })} />)
      const badge = container.querySelector('[data-testid="badge"]')
      expect(badge).toHaveClass('bg-blue-500/20')
    })

    it('applies complete status color', () => {
      const { container } = render(<AgentDetailPanel agent={createMockAgent({
        status: 'complete'
      })} />)
      const badge = container.querySelector('[data-testid="badge"]')
      expect(badge).toHaveClass('bg-green-500/20')
    })

    it('applies error status color', () => {
      const { container } = render(<AgentDetailPanel agent={createMockAgent({
        status: 'error'
      })} />)
      const badge = container.querySelector('[data-testid="badge"]')
      expect(badge).toHaveClass('bg-red-500/20')
    })
  })

  describe('custom className', () => {
    it('applies custom className to card', () => {
      const { container } = render(<AgentDetailPanel
        agent={createMockAgent()}
        className="custom-test-class"
      />)
      const card = container.querySelector('.bg-card')
      expect(card).toHaveClass('custom-test-class')
    })
  })

  describe('edge cases', () => {
    it('handles agent with minimal properties', () => {
      const minimalAgent: AgentDetail = {
        id: 'minimal',
        name: 'Minimal Agent',
        triggers: [],
        emits: 'event',
      }
      expect(() => render(<AgentDetailPanel agent={minimalAgent} />)).not.toThrow()
    })

    it('handles agent with all optional properties', () => {
      const fullAgent = createMockAgent()
      expect(() => render(<AgentDetailPanel agent={fullAgent} />)).not.toThrow()
    })

    it('handles very long agent names', () => {
      const longName = 'a'.repeat(200)
      render(<AgentDetailPanel agent={createMockAgent({ name: longName })} />)
      expect(screen.getByText(longName)).toBeInTheDocument()
    })

    it('handles special characters in prompt', () => {
      const specialPrompt = 'Prompt with <script> tags and "quotes" and \'apostrophes\''
      render(<AgentDetailPanel agent={createMockAgent({
        prompt: specialPrompt
      })} defaultExpanded={true} />)
      expect(screen.getByText(specialPrompt)).toBeInTheDocument()
    })
  })

  describe('accessibility', () => {
    it('header button is keyboard accessible', () => {
      render(<AgentDetailPanel agent={createMockAgent()} />)
      const button = screen.getByRole('button')
      expect(button).toBeInTheDocument()
    })
  })
})
