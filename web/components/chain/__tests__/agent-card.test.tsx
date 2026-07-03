import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AgentCard, type AgentSession } from '../agent-card'

// Mock dependencies
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className, onClick }: {
    children: React.ReactNode
    className?: string
    onClick?: () => void
  }) => (
    <div className={className} onClick={onClick} data-testid="card">
      {children}
    </div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div data-testid="card-content">{children}</div>,
  CardHeader: ({ children }: { children: React.ReactNode }) => <div data-testid="card-header">{children}</div>,
  CardTitle: ({ children, className }: { children: React.ReactNode; className?: string }) => <h3 className={className}>{children}</h3>,
}))

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: {
    children: React.ReactNode
    onClick?: () => void
    disabled?: boolean
  }) => (
    <button onClick={onClick} disabled={disabled} data-testid="button">
      {children}
    </button>
  ),
}))

jest.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, onKeyDown, placeholder, ...props }: {
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
    placeholder?: string
  } & React.HTMLAttributes<HTMLInputElement>) => (
    <input
      value={value}
      onChange={(e) => onChange?.(e)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      data-testid="input"
      {...props}
    />
  ),
}))

jest.mock('@/components/ui/textarea', () => ({
  Textarea: ({ value, onChange, placeholder, ...props }: {
    value?: string
    onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    placeholder?: string
  } & React.HTMLAttributes<HTMLTextAreaElement>) => (
    <textarea
      value={value}
      onChange={(e) => onChange?.(e)}
      placeholder={placeholder}
      data-testid="textarea"
      {...props}
    />
  ),
}))

jest.mock('@/components/common/status-badge', () => ({
  StatusBadge: ({ status }: {
    status: string
    _size?: 'sm' | 'md' | 'lg'
  }) => (
    <span data-testid={`status-badge-${status}`}>{status}</span>
  ),
}))

jest.mock('@/components/ui/terminal-icon', () => ({
  TerminalIcon: ({ className }: { className?: string }) => (
    <svg data-testid="terminal-icon" className={className} />
  ),
}))

// Mock @aliimam/icons for the remaining glyphs used by the card.
jest.mock('@aliimam/icons', () => ({
  SendFilled: ({ className }: { className?: string }) => <svg data-testid="send-icon" className={className} />,
  StopFilled: ({ className }: { className?: string }) => <svg data-testid="square-icon" className={className} />,
  MaximizeFilled: ({ className }: { className?: string }) => <svg data-testid="maximize-icon" className={className} />,
  DocumentTextFilled: ({ className }: { className?: string }) => <svg data-testid="doc-icon" className={className} />,
  DocumentCodeFilled: ({ className }: { className?: string }) => <svg data-testid="doc-code-icon" className={className} />,
  Code1Filled: ({ className }: { className?: string }) => <svg data-testid="code-icon" className={className} />,
  HierarchyFilled: ({ className }: { className?: string }) => <svg data-testid="hierarchy-icon" className={className} />,
  TextalignLeftFilled: ({ className }: { className?: string }) => <svg data-testid="text-align-icon" className={className} />,
  ImageFilled: ({ className }: { className?: string }) => <svg data-testid="image-icon" className={className} />,
}))

describe('AgentCard', () => {
  const mockSession: AgentSession = {
    id: 'session-1',
    agentId: 'agent-1',
    name: 'test-agent',
    created: new Date().toISOString(),
    status: 'running',
  }

  describe('rendering', () => {
    it('renders agent card with session name', () => {
      render(<AgentCard session={mockSession} />)
      expect(screen.getByText('test-agent')).toBeInTheDocument()
    })

    it('shows status badge', () => {
      render(<AgentCard session={mockSession} />)
      expect(screen.getByTestId('status-badge-running')).toBeInTheDocument()
    })

    it('displays time created', () => {
      const createdAt = '2024-01-15T10:30:00Z'
      const session = { ...mockSession, created: createdAt }
      render(<AgentCard session={session} />)
      // toLocaleTimeString will output something like "10:30:00 AM" or similar
      const timeElement = screen.getByText(/\d{1,2}:\d{2}:\d{2}/)
      expect(timeElement).toBeInTheDocument()
    })

    it('renders terminal icon', () => {
      render(<AgentCard session={mockSession} />)
      expect(screen.getByTestId('terminal-icon')).toBeInTheDocument()
    })

    it('applies selected styling when selected', () => {
      const { container } = render(<AgentCard session={mockSession} selected={true} />)
      const card = container.querySelector('[data-testid="card"]')
      expect(card?.className).toContain('ring-2')
    })
  })

  describe('expand/collapse', () => {
    it('expands when maximize button clicked', () => {
      render(<AgentCard session={mockSession} />)
      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      expect(screen.getByTestId('card-content')).toBeInTheDocument()
      expect(screen.getByText(/no output yet/i)).toBeInTheDocument()
    })

    it('toggles expansion on repeated clicks', () => {
      render(<AgentCard session={mockSession} />)
      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')

      fireEvent.click(maximizeButton!)
      expect(screen.getByTestId('card-content')).toBeInTheDocument()

      fireEvent.click(maximizeButton!)
      // Content should be hidden after second click
      expect(screen.queryByTestId('card-content')).not.toBeInTheDocument()
    })

    it('shows output when expanded', () => {
      const output = 'Agent output line 1\nAgent output line 2'
      render(<AgentCard session={mockSession} output={output} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      expect(screen.getByText(/agent output line 1/i)).toBeInTheDocument()
      expect(screen.getByText(/agent output line 2/i)).toBeInTheDocument()
    })

    it('shows no output message when output is empty', () => {
      render(<AgentCard session={mockSession} output="" />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      expect(screen.getByText(/no output yet/i)).toBeInTheDocument()
    })
  })

  describe('message input', () => {
    it('shows input field when onMessage provided and expanded', () => {
      const mockOnMessage = jest.fn()
      render(<AgentCard session={mockSession} onMessage={mockOnMessage} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      expect(screen.getByTestId('message-input')).toBeInTheDocument()
    })

    it('sends message when send button clicked', async () => {
      const mockOnMessage = jest.fn()
      render(<AgentCard session={mockSession} onMessage={mockOnMessage} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      const input = screen.getByTestId('message-input')
      await userEvent.type(input, 'test message')

      const sendButton = screen.getByTestId('send-icon').closest('button')
      fireEvent.click(sendButton!)

      expect(mockOnMessage).toHaveBeenCalledWith('test message')
    })

    it('sends message when enter key pressed', async () => {
      const mockOnMessage = jest.fn()
      render(<AgentCard session={mockSession} onMessage={mockOnMessage} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      const input = screen.getByTestId('message-input')
      await userEvent.type(input, 'test message')

      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

      expect(mockOnMessage).toHaveBeenCalledWith('test message')
    })

    it('clears input after sending', async () => {
      const mockOnMessage = jest.fn()
      render(<AgentCard session={mockSession} onMessage={mockOnMessage} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      const input = screen.getByTestId('message-input') as HTMLInputElement
      await userEvent.type(input, 'test message')

      const sendButton = screen.getByTestId('send-icon').closest('button')
      fireEvent.click(sendButton!)

      expect(input.value).toBe('')
    })

    it('disables send button when input is empty', () => {
      const mockOnMessage = jest.fn()
      render(<AgentCard session={mockSession} onMessage={mockOnMessage} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      const sendButton = screen.getByTestId('send-icon').closest('button') as HTMLButtonElement
      expect(sendButton.disabled).toBe(true)
    })
  })

  describe('kill button', () => {
    it('shows kill button when onKill provided', () => {
      const mockOnKill = jest.fn()
      render(<AgentCard session={mockSession} onKill={mockOnKill} />)

      expect(screen.getByTestId('square-icon')).toBeInTheDocument()
    })

    it('calls onKill when kill button clicked', () => {
      const mockOnKill = jest.fn()
      render(<AgentCard session={mockSession} onKill={mockOnKill} />)

      const killButton = screen.getByTestId('square-icon').closest('button')
      fireEvent.click(killButton!)

      expect(mockOnKill).toHaveBeenCalled()
    })

    it('does not show kill button when onKill not provided', () => {
      render(<AgentCard session={mockSession} />)
      expect(screen.queryByTestId('square-icon')).not.toBeInTheDocument()
    })
  })

  describe('card selection', () => {
    it('calls onSelect when card clicked', () => {
      const mockOnSelect = jest.fn()
      render(<AgentCard session={mockSession} onSelect={mockOnSelect} />)

      const card = screen.getByTestId('card')
      fireEvent.click(card)

      expect(mockOnSelect).toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('handles very long output', () => {
      const longOutput = 'x'.repeat(10000)
      render(<AgentCard session={mockSession} output={longOutput} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      expect(screen.getByText(new RegExp('^x{100}'))).toBeInTheDocument()
    })

    it('handles different statuses', () => {
      const pendingSession = { ...mockSession, status: 'pending' as const }
      const { rerender } = render(<AgentCard session={pendingSession} />)
      expect(screen.getByTestId('status-badge-pending')).toBeInTheDocument()

      const completedSession = { ...mockSession, status: 'completed' as const }
      rerender(<AgentCard session={completedSession} />)
      expect(screen.getByTestId('status-badge-completed')).toBeInTheDocument()

      const failedSession = { ...mockSession, status: 'failed' as const }
      rerender(<AgentCard session={failedSession} />)
      expect(screen.getByTestId('status-badge-failed')).toBeInTheDocument()
    })

    it('handles session with no status', () => {
      const noStatusSession = { ...mockSession, status: undefined as unknown as 'pending' }
      render(<AgentCard session={noStatusSession} />)
      // Should default to pending status badge
      expect(screen.getByTestId('status-badge-pending')).toBeInTheDocument()
    })
  })

  describe('output display', () => {
    it('preserves whitespace in output', () => {
      const output = 'Line 1\n\nLine 3\n  Indented line'
      render(<AgentCard session={mockSession} output={output} />)

      const maximizeButton = screen.getByTestId('maximize-icon').closest('button')
      fireEvent.click(maximizeButton!)

      const pre = screen.getByText(/line 1/i).closest('pre')
      expect(pre?.textContent).toContain('Line 1')
      expect(pre?.textContent).toContain('Indented line')
    })

    it('truncates output in collapsed view', () => {
      const output = 'This is a very long output that should be handled properly'
      render(<AgentCard session={mockSession} output={output} />)

      // In collapsed view, output shouldn't be visible
      expect(screen.queryByText(/very long output/i)).not.toBeInTheDocument()
    })
  })
})
