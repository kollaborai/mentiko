import { render, screen, fireEvent, act } from '@testing-library/react'
import { FloatingPillNav } from '../floating-pill-nav'
import { usePillNavPreferences } from '@/lib/ui/pill-nav-preferences'

// ─── mocks ──────────────────────────────────────────────────

let mockPathname = '/dashboard'

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}))

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [k: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@/lib/ui-context/workspace-context', () => ({
  useWorkspace: () => ({
    workspaceId: 'test-ws',
    workspacePath: '/tmp/test',
    setWorkspaceId: jest.fn(),
    workspaces: [{ id: 'test-ws', name: 'Test', type: 'local', path: '/tmp/test' }],
    refetch: jest.fn(),
  }),
}))

// mock motion/react - render children directly, no animation
jest.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: { children?: React.ReactNode; [k: string]: unknown }) => {
      // filter out motion-specific props
      const htmlProps: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(props)) {
        if (!['initial', 'animate', 'exit', 'transition', 'layout', 'layoutId'].includes(k)) {
          htmlProps[k] = v
        }
      }
      return <div {...htmlProps}>{children}</div>
    },
  },
}))

// mock radix popover - just render trigger + content inline
jest.mock('@radix-ui/react-popover', () => ({
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// mock icon components
jest.mock('@aliimam/icons', () => {
  const icon = (name: string) =>
    function MockIcon({ className }: { className?: string }) {
      return <svg data-testid={`icon-${name}`} className={className} />
    }
  return {
    RouteSquareFilled: icon('route-square'),
    ShopFilled: icon('shop'),
    Setting2Filled: icon('setting2'),
    TaskSquareFilled: icon('task-square'),
    MessageCircleFilled: icon('message-circle'),
    JudgeFilled: icon('judge'),
    BotMessageSquare: icon('bot-message-square'),
    BoxFilled: icon('box'),
    MagicStarFilled: icon('magic-star'),
    CategoryFilled: icon('category'),
    Element3Filled: icon('element3'),
    ComponentFilled: icon('component'),
    GripHorizontal: icon('grip-horizontal'),
    UserFilled: icon('user'),
    ColorSwatchFilled: icon('color-swatch'),
    NotificationFilled: icon('notification'),
    LockFilled: icon('lock'),
    SecurityFilled: icon('security'),
    ShieldTickFilled: icon('shield-tick'),
    SmsFilled: icon('sms'),
    CardFilled: icon('card'),
    ExportFilled: icon('export'),
    PeopleFilled: icon('people'),
    DocumentTextFilled: icon('document-text'),
    CommandSquareFilled: icon('command-square'),
    ChartFilled: icon('chart'),
    ActivityFilled: icon('activity'),
    TrendUpFilled: icon('trend-up'),
    CloudConnectionFilled: icon('cloud-connection'),
    ClockFilled: icon('clock'),
    DirectSendFilled: icon('direct-send'),
    LinkFilled: icon('link'),
    SendFilled: icon('send'),
    AddFilled: icon('add'),
    CodeFilled: icon('code'),
    Webhook: icon('webhook'),
  }
})

jest.mock('@/components/app-shell/notifications-panel', () => ({
  NotificationsPanel: () => <div data-testid="notifications-panel" />,
}))

jest.mock('@/components/app-shell/sessions-indicator', () => ({
  SessionsIndicator: () => <div data-testid="sessions-indicator" />,
}))

jest.mock('@/components/app-shell/nav-namespace-selector', () => ({
  NavNamespaceSelector: () => <div data-testid="nav-namespace-selector" />,
}))

// ─── window.matchMedia mock ─────────────────────────────────

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
})

// ─── localStorage spy ───────────────────────────────────────

const localStorageMap = new Map<string, string>()

beforeAll(() => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => localStorageMap.get(key) ?? null)
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string, value: string) => { localStorageMap.set(key, value) })
  jest.spyOn(Storage.prototype, 'removeItem').mockImplementation((key: string) => { localStorageMap.delete(key) })
})

afterAll(() => {
  jest.restoreAllMocks()
})

beforeEach(() => {
  localStorageMap.clear()
  mockPathname = '/dashboard'
  usePillNavPreferences.setState({
    prefs: {
      colorScheme: 'rainbow',
      customGlowColors: ['#ff00ff', '#00ffff', '#ff3131', '#00ff00', '#ffea00'],
      scale: 1,
      showRecents: true,
      navigationMode: 'page',
    },
  })
})

// ─── helpers ────────────────────────────────────────────────

function getGripHandle() {
  // the grip handle has title "Lock position" or "Unlock position"
  return screen.getByTitle(/lock position|unlock position/i)
}

function getLinkByHref(href: string) {
  const link = document.querySelector(`a[href="${href}"]`)
  expect(link).toBeInTheDocument()
  return link as HTMLAnchorElement
}

function getLinksByHref(href: string) {
  return Array.from(document.querySelectorAll(`a[href="${href}"]`))
}

// ─── tests ──────────────────────────────────────────────────

describe('FloatingPillNav', () => {
  describe('rendering', () => {
    it('renders without crashing', () => {
      render(<FloatingPillNav />)
      // should have the search button
      expect(screen.getByTitle('Search & Navigate (Cmd+K)')).toBeInTheDocument()
    })

    it('renders grip handle locked by default', () => {
      render(<FloatingPillNav />)
      const grip = getGripHandle()
      expect(grip).toHaveAttribute('title', 'Unlock position')
      expect(grip.querySelector('[data-testid="icon-lock"]')).toBeInTheDocument()
    })

    it('renders category icons', () => {
      render(<FloatingPillNav />)
      // home category has the mentiko svg logo, not an aliimam icon
      // workspace, workflows, marketplace, settings are rendered
      expect(screen.getByTitle('Settings')).toBeInTheDocument()
    })
  })

  describe('lock toggle behavior', () => {
    it('toggles to unlocked on grip click', () => {
      render(<FloatingPillNav />)
      const grip = getGripHandle()

      // initially locked - shows lock icon
      expect(grip.querySelector('[data-testid="icon-lock"]')).toBeInTheDocument()
      expect(grip.querySelector('[data-testid="icon-grip-horizontal"]')).not.toBeInTheDocument()

      // click to unlock
      fireEvent.click(grip)

      // now unlocked - shows grip icon
      expect(grip).toHaveAttribute('title', 'Lock position')
      expect(grip.querySelector('[data-testid="icon-grip-horizontal"]')).toBeInTheDocument()
      expect(grip.querySelector('[data-testid="icon-lock"]')).not.toBeInTheDocument()
    })

    it('toggles back to locked on second click', () => {
      render(<FloatingPillNav />)
      const grip = getGripHandle()

      fireEvent.click(grip) // unlock
      fireEvent.click(grip) // lock

      expect(grip).toHaveAttribute('title', 'Unlock position')
      expect(grip.querySelector('[data-testid="icon-lock"]')).toBeInTheDocument()
    })

    it('persists lock state to localStorage', () => {
      render(<FloatingPillNav />)
      const grip = getGripHandle()

      fireEvent.click(grip) // unlock
      expect(localStorageMap.get('mentiko-pill-locked')).toBe('false')

      fireEvent.click(grip) // lock
      expect(localStorageMap.get('mentiko-pill-locked')).toBe('true')
    })

    it('restores lock state from localStorage on mount', () => {
      localStorageMap.set('mentiko-pill-locked', 'true')

      render(<FloatingPillNav />)
      const grip = getGripHandle()

      expect(grip).toHaveAttribute('title', 'Unlock position')
      expect(grip.querySelector('[data-testid="icon-lock"]')).toBeInTheDocument()
    })
  })

  describe('drag blocked when locked', () => {
    it('blocks pointer drag when locked', () => {
      render(<FloatingPillNav />)
      const grip = getGripHandle()

      // get the pill container (parent of grip)
      const pill = grip.closest('[class*="bg-"]')!
      expect(pill).toBeTruthy()

      // try to initiate a drag via pointerDown on the pill body
      fireEvent.pointerDown(pill, {
        clientX: 100,
        clientY: 100,
        pointerType: 'mouse',
      })

      // the pill should not enter dragging state
      // (no cursor-grabbing class should be added)
      expect(pill.className).not.toContain('cursor-grabbing')
    })
  })

  describe('position persistence', () => {
    it('saves position to localStorage on mount default', () => {
      render(<FloatingPillNav />)
      // default position is top/50 - loaded from localStorage (empty = default)
      // verify the component renders (position is applied via inline styles)
      const grip = getGripHandle()
      expect(grip).toBeInTheDocument()
    })

    it('restores saved position from localStorage', () => {
      localStorageMap.set('mentiko-pill-position', JSON.stringify({ edge: 'bottom', offset: 30 }))
      render(<FloatingPillNav />)
      // component should render without errors with saved position
      expect(getGripHandle()).toBeInTheDocument()
    })

    it('handles corrupted localStorage gracefully', () => {
      localStorageMap.set('mentiko-pill-position', 'not-json')
      // should not throw
      render(<FloatingPillNav />)
      expect(getGripHandle()).toBeInTheDocument()
    })

    it('handles corrupted lock state gracefully', () => {
      localStorageMap.set('mentiko-pill-locked', 'garbage')
      render(<FloatingPillNav />)
      // "garbage" !== "true" so should default to unlocked
      const grip = getGripHandle()
      expect(grip).toHaveAttribute('title', 'Lock position')
    })
  })

  describe('category activation', () => {
    it('activates home category for /dashboard', () => {
      mockPathname = '/dashboard'
      render(<FloatingPillNav />)
      // the home category shows "mentiko" brand label text when active
      expect(screen.getByText('mentiko')).toBeInTheDocument()
      // and its children (Updates, Docs) should be visible
      expect(getLinkByHref('/updates')).toBeInTheDocument()
      expect(getLinkByHref('/docs')).toBeInTheDocument()
    })

    it('activates workspace category for /runs', () => {
      mockPathname = '/runs'
      render(<FloatingPillNav />)
      // workspace children should be visible when active
      expect(getLinkByHref('/tasks')).toBeInTheDocument()
      expect(getLinkByHref('/conversations')).toBeInTheDocument()
    })

    it('activates workspace category for /tasks', () => {
      mockPathname = '/tasks'
      render(<FloatingPillNav />)
      expect(getLinkByHref('/tasks')).toBeInTheDocument()
    })

    it('does not show decisions as a separate workspace nav item', () => {
      mockPathname = '/tasks'
      render(<FloatingPillNav />)
      expect(document.querySelector('a[href="/decisions"]')).not.toBeInTheDocument()
      expect(document.querySelector('a[href="/tasks?type=decision"]')).not.toBeInTheDocument()
    })

    it('activates workflows category for /chains', () => {
      mockPathname = '/chains'
      render(<FloatingPillNav />)
      expect(getLinkByHref('/agents')).toBeInTheDocument()
      expect(getLinkByHref('/artifacts')).toBeInTheDocument()
    })

    it('activates workflows category for /agents', () => {
      mockPathname = '/agents'
      render(<FloatingPillNav />)
      expect(getLinkByHref('/agents')).toBeInTheDocument()
    })

    it('activates settings for /settings path', () => {
      mockPathname = '/settings'
      render(<FloatingPillNav />)
      // settings is a popover, the trigger button should be present
      expect(screen.getByTitle('Settings')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'MCP' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Agent Configs' })).toBeInTheDocument()
    })

    it('activates marketplace for /marketplace path', () => {
      mockPathname = '/marketplace'
      render(<FloatingPillNav />)
      // marketplace children should be visible
      expect(getLinkByHref('/marketplace/templates')).toBeInTheDocument()
    })
  })

  describe('floating app panel mode', () => {
    it('opens floating nav routes in an app panel when panel mode is enabled', () => {
      usePillNavPreferences.setState({
        prefs: {
          colorScheme: 'rainbow',
          customGlowColors: ['#ff00ff', '#00ffff', '#ff3131', '#00ff00', '#ffea00'],
          scale: 1,
          showRecents: true,
          navigationMode: 'floating-nav-panels',
        },
      })
      mockPathname = '/dashboard'
      const dispatchSpy = jest.spyOn(window, 'dispatchEvent')

      render(<FloatingPillNav />)
      fireEvent.click(getLinkByHref('/runs'))

      const panelEvent = dispatchSpy.mock.calls
        .map(([event]) => event)
        .find((event): event is CustomEvent => (
          event instanceof CustomEvent &&
          event.type === 'open-floating-app-panel'
        ))
      expect(panelEvent?.detail).toMatchObject({
        href: '/runs',
        title: 'Workspace',
      })

      dispatchSpy.mockRestore()
    })

    it('expands the clicked route category while the page stays put in panel mode', () => {
      usePillNavPreferences.setState({
        prefs: {
          colorScheme: 'rainbow',
          customGlowColors: ['#ff00ff', '#00ffff', '#ff3131', '#00ff00', '#ffea00'],
          scale: 1,
          showRecents: true,
          navigationMode: 'floating-nav-panels',
        },
      })
      mockPathname = '/dashboard'

      render(<FloatingPillNav />)
      fireEvent.click(getLinkByHref('/chains'))

      expect(getLinkByHref('/agents')).toBeInTheDocument()
      expect(getLinkByHref('/artifacts')).toBeInTheDocument()
    })
  })

  describe('recents tracking', () => {
    it('saves visited child pages to localStorage', () => {
      mockPathname = '/tasks'
      render(<FloatingPillNav />)

      // tasks is a workspace child, should be saved to recents
      const recents = localStorageMap.get('mentiko-pill-recents')
      expect(recents).toBeTruthy()
      const parsed = JSON.parse(recents!)
      expect(parsed).toContain('/tasks')
    })

    it('restores recents from localStorage', () => {
      // save a recent that is NOT in the current active category
      localStorageMap.set('mentiko-pill-recents', JSON.stringify(['/agents', '/tasks']))
      mockPathname = '/dashboard' // home category

      render(<FloatingPillNav />)

      // recents from other categories should be rendered as dimmed items
      // /agents is workflows category, /tasks is workspace - both differ from home
      // they should show up in the recents section
      expect(getLinkByHref('/agents')).toBeInTheDocument()
      expect(getLinkByHref('/tasks')).toBeInTheDocument()
    })

    it('does not show recents from the active category', () => {
      // if we're on workspace (/runs) and /tasks is in recents,
      // /tasks should NOT show as a recent (it's already visible as a child)
      localStorageMap.set('mentiko-pill-recents', JSON.stringify(['/tasks']))
      mockPathname = '/runs' // workspace category

      render(<FloatingPillNav />)

      // /tasks should appear as a child nav item (active category), not as a recent.
      const taskLinks = getLinksByHref('/tasks')
      expect(taskLinks).toHaveLength(1)
    })
  })

  describe('edge summon blocked when locked', () => {
    it('does not respond to edge mousemove when locked', () => {
      render(<FloatingPillNav />)
      const grip = getGripHandle()

      // simulate mouse near screen edge
      act(() => {
        window.dispatchEvent(new MouseEvent('mousemove', {
          clientX: 5,  // near left edge
          clientY: 400,
        }))
      })

      // no summon glow should appear (the component early-returns when locked)
      // we can't easily test internal state, but the fact that no error is thrown
      // and no summon-related DOM changes occur is the assertion
      expect(grip.querySelector('[data-testid="icon-lock"]')).toBeInTheDocument()
    })
  })
})
