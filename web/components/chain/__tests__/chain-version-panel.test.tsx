import { screen, fireEvent, waitFor } from '@testing-library/react'
import { ChainVersionPanel } from '../chain-version-panel'
import { renderWithNamespace } from '@/lib/test-utils'

// Mock UI components
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
  Button: ({ children, onClick, disabled, className }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) => (
    <button data-testid="button" onClick={onClick} disabled={disabled} className={className}>{children}</button>
  ),
}))

jest.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

jest.mock('@/components/ui/label', () => ({
  Label: (props: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props} />,
}))

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// Mock @aliimam/icons
jest.mock('@aliimam/icons', () => ({
  ArrowDown2Filled: ({ className }: { className?: string }) => <svg data-testid="arrow-down" className={className} />,
  ArrowRight2Filled: ({ className }: { className?: string }) => <svg data-testid="arrow-right" className={className} />,
  HierarchyFilled: ({ className }: { className?: string }) => <svg data-testid="hierarchy" className={className} />,
  RecordCircleFilled: ({ className }: { className?: string }) => <svg data-testid="record" className={className} />,
  AddFilled: ({ className }: { className?: string }) => <svg data-testid="add" className={className} />,
  RotateLeftFilled: ({ className }: { className?: string }) => <svg data-testid="rotate" className={className} />,
  TrashFilled: ({ className }: { className?: string }) => <svg data-testid="trash" className={className} />,
  TickCircleFilled: ({ className }: { className?: string }) => <svg data-testid="tick" className={className} />,
  CopyFilled: ({ className }: { className?: string }) => <svg data-testid="copy" className={className} />,
  DangerFilled: ({ className }: { className?: string }) => <svg data-testid="danger" className={className} />,
  SearchNormalFilled: ({ className }: { className?: string }) => <svg data-testid="search" className={className} />,
  ArrowUp2Filled: ({ className }: { className?: string }) => <svg data-testid="arrow-up" className={className} />,
  SendFilled: ({ className }: { className?: string }) => <svg data-testid="send" className={className} />,
  CommandSquareFilled: ({ className }: { className?: string }) => <svg data-testid="command" className={className} />,
  DataFilled: ({ className }: { className?: string }) => <svg data-testid="data" className={className} />,
  RefreshFilled: ({ className }: { className?: string }) => <svg data-testid="refresh" className={className} />,
  ActivityFilled: ({ className }: { className?: string }) => <svg data-testid="activity" className={className} />,
  DocumentTextFilled: ({ className }: { className?: string }) => <svg data-testid="doc" className={className} />,
  BotMessageSquare: ({ className }: { className?: string }) => <svg data-testid="bot" className={className} />,
  ClockFilled: ({ className }: { className?: string }) => <svg data-testid="clock" className={className} />,
  ArrowLeft2Filled: ({ className }: { className?: string }) => <svg data-testid="arrow-left" className={className} />,
}))

// Mock CompactHistoryTimeline
jest.mock('../chain-history-timeline', () => ({
  CompactHistoryTimeline: ({ commits, onSelectCommit }: { commits: Array<{ hash: string; short: string; message: string }>; onSelectCommit?: (c: unknown) => void }) => (
    <div data-testid="compact-timeline">
      {commits.map((c) => (
        <button key={c.hash} data-testid={`commit-${c.short}`} onClick={() => onSelectCommit?.(c)}>
          {c.short} {c.message}
        </button>
      ))}
    </div>
  ),
}))

// Mock ChainBranchManager
jest.mock('../chain-branch-manager', () => ({
  ChainBranchManager: ({ branches, currentBranch }: { branches: Array<{ name: string; current: boolean }>; currentBranch: string }) => (
    <div data-testid="branch-manager">
      <span data-testid="current-branch">{currentBranch}</span>
      {branches.map((b) => (
        <div key={b.name} data-testid={`branch-${b.name}`}>
          {b.name} {b.current ? "(current)" : ""}
        </div>
      ))}
    </div>
  ),
}))

// Mock JsonDiffViewer
jest.mock('../chain-diff-view', () => ({
  JsonDiffViewer: ({ oldValue, newValue }: { oldValue: Record<string, unknown>; newValue: Record<string, unknown> }) => (
    <div data-testid="json-diff">
      diff: {JSON.stringify(Object.keys(oldValue))} → {JSON.stringify(Object.keys(newValue))}
    </div>
  ),
}))

// Mock useChainVersionControl
const mockVC = {
  isRepo: false,
  status: null as unknown,
  commits: [] as unknown[],
  branches: [] as unknown[],
  currentBranch: '',
  diff: null,
  mergeResult: null,
  loading: false,
  error: null as string | null,
  initRepo: jest.fn(),
  commit: jest.fn(),
  getHistory: jest.fn(),
  getDiff: jest.fn(),
  getCommit: jest.fn(),
  revert: jest.fn(),
  getBranches: jest.fn(),
  createBranch: jest.fn(),
  switchBranch: jest.fn(),
  deleteBranch: jest.fn(),
  compareBranches: jest.fn(),
  mergeBranch: jest.fn(),
  abortMerge: jest.fn(),
  refreshStatus: jest.fn(),
  refresh: jest.fn(),
}

jest.mock('@/hooks/use-chain-version-control', () => ({
  useChainVersionControl: () => mockVC,
}))

describe('ChainVersionPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVC.isRepo = false
    mockVC.status = null
    mockVC.commits = []
    mockVC.branches = []
    mockVC.currentBranch = ''
    mockVC.loading = false
    mockVC.error = null
  })

  it('renders collapsed by default', () => {
    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    expect(screen.getByText('version control')).toBeInTheDocument()
    expect(screen.getByText('not initialized')).toBeInTheDocument()
  })

  it('shows init CTA when no repo exists', () => {
    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    fireEvent.click(screen.getByText('version control'))

    expect(screen.getByText('No version history for this chain yet.')).toBeInTheDocument()
    expect(screen.getByText('Initialize Version Control')).toBeInTheDocument()
  })

  it('calls initRepo when init button clicked', () => {
    mockVC.initRepo.mockResolvedValue(undefined)

    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    fireEvent.click(screen.getByText('version control'))
    fireEvent.click(screen.getByText('Initialize Version Control'))

    expect(mockVC.initRepo).toHaveBeenCalledWith('main')
  })

  it('shows branch name in header when repo exists', () => {
    mockVC.isRepo = true
    mockVC.currentBranch = 'develop'

    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    expect(screen.getByText('develop')).toBeInTheDocument()
  })

  it('shows error state', () => {
    mockVC.error = 'something went wrong'

    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    fireEvent.click(screen.getByText('version control'))

    expect(screen.getByText('something went wrong')).toBeInTheDocument()
  })

  it('shows repo status when expanded and repo exists', async () => {
    mockVC.isRepo = true
    mockVC.currentBranch = 'main'
    mockVC.status = { hasChanges: false, ahead: 2, behind: 0 }

    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    fireEvent.click(screen.getByText('version control'))

    await waitFor(() => {
      expect(screen.getByText(/clean/)).toBeInTheDocument()
    })
    expect(screen.getByText('2 ahead')).toBeInTheDocument()
  })

  it('shows commits and branches when repo has data', async () => {
    mockVC.isRepo = true
    mockVC.currentBranch = 'main'
    mockVC.commits = [
      { hash: 'abc123', short: 'abc1234', author: 'test', date: '2026-05-14', message: 'initial commit', body: '' },
    ]
    mockVC.branches = [
      { name: 'main', current: true },
      { name: 'feature', current: false },
    ]

    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    fireEvent.click(screen.getByText('version control'))

    await waitFor(() => {
      expect(screen.getByTestId('compact-timeline')).toBeInTheDocument()
    })
    expect(screen.getByTestId('branch-manager')).toBeInTheDocument()
    expect(screen.getByText(/initial commit/)).toBeInTheDocument()
  })

  it('fetches history and branches when expanded', async () => {
    mockVC.isRepo = true

    renderWithNamespace(<ChainVersionPanel chainId="test-chain" chainName="Test Chain" />)

    fireEvent.click(screen.getByText('version control'))

    await waitFor(() => {
      expect(mockVC.getHistory).toHaveBeenCalledWith(10)
      expect(mockVC.getBranches).toHaveBeenCalled()
    })
  })
})
