import '@testing-library/jest-dom'
import { createContext } from 'react'

// Mock Request/Response globals for Next.js server components
class MockRequest {
  constructor(url, options = {}) {
    this.url = url
    this.method = options.method || 'GET'
    this.headers = new MockHeaders(options.headers)
    this.body = options.body || null
    this.signal = options.signal
  }
  async json() {
    if (typeof this.body === 'string') {
      return JSON.parse(this.body)
    }
    return this.body
  }
  async text() {
    return typeof this.body === 'string' ? this.body : JSON.stringify(this.body)
  }
}

class MockResponse {
  constructor(body, options = {}) {
    this.body = body
    this.status = options.status || 200
    this.ok = this.status >= 200 && this.status < 300
    this.statusText = options.statusText || 'OK'
    this.headers = new MockHeaders(options.headers)
  }
  static json(body, options = {}) {
    const response = new MockResponse(JSON.stringify(body), options)
    response.json = async () => body
    return response
  }
  async json() {
    return JSON.parse(this.body)
  }
}

class MockHeaders {
  constructor(init = {}) {
    this.map = new Map()
    if (init instanceof MockHeaders) {
      init.map.forEach((value, key) => this.set(key, value))
    } else if (Array.isArray(init)) {
      init.forEach(([key, value]) => this.set(key, value))
    } else if (typeof init === 'object') {
      Object.entries(init).forEach(([key, value]) => this.set(key, value))
    }
  }
  set(key, value) {
    this.map.set(String(key).toLowerCase(), String(value))
  }
  get(key) {
    return this.map.get(String(key).toLowerCase()) ?? null
  }
  has(key) {
    return this.map.has(String(key).toLowerCase())
  }
  delete(key) {
    this.map.delete(String(key).toLowerCase())
  }
  forEach(callback) {
    this.map.forEach((value, key) => callback(value, key, this))
  }
}

global.Request = MockRequest
global.Response = MockResponse
global.Headers = MockHeaders

// Export for use in tests
global.MockRequest = MockRequest
global.MockResponse = MockResponse
global.MockHeaders = MockHeaders

// Mock NextResponse
global.NextResponse = {
  json: (body, options = {}) => {
    const response = MockResponse.json(body, options)
    response.status = options.status || 200
    return response
  },
}

// Mock NextRequest
global.NextRequest = MockRequest

// Mock better-auth to avoid ESM import issues in tests
jest.mock('better-auth', () => ({
  createAuthClient: () => ({
    signIn: { email: jest.fn() },
    signOut: { action: jest.fn() },
    useSession: () => ({ data: null, isPending: false }),
    organization: {
      setActive: jest.fn(),
      list: jest.fn(() => ({ data: [] })),
    },
  }),
  betterAuth: jest.fn(() => ({
    handler: jest.fn(),
    server: { $Infer: {} },
  })),
}))

// Mock better-auth ESM submodules
jest.mock('better-auth/next-js', () => ({
  nextCookies: jest.fn(),
}))

jest.mock('better-auth/plugins', () => ({
  organization: jest.fn(() => ({
    handler: jest.fn(),
  })),
  bearer: jest.fn(() => ({
    handler: jest.fn(),
  })),
}))

jest.mock('better-auth/plugins/access', () => ({
  createAccessControl: jest.fn(() => ({
    newRole: jest.fn(() => ({})),
  })),
}))

// NOTE: better-sqlite3 is NOT mocked globally to allow integration tests
// to use real database operations. Tests that need a mock should mock it
// in their own file using jest.mock('better-sqlite3', ...)

// Mock namespace-context with a test-only provider
const TestNamespaceContext = createContext({
  namespaceId: 'default',
  setNamespaceId: () => {},
  namespaces: [{ id: 'default', name: 'Default' }],
})

jest.mock('@/lib/namespace-context', () => {
  const contextValue = {
    namespaceId: 'default',
    setNamespaceId: () => {},
    namespaces: [{ id: 'default', name: 'Default' }],
  }
  return {
    NamespaceProvider: ({ children }) => (
      <TestNamespaceContext.Provider value={contextValue}>
        {children}
      </TestNamespaceContext.Provider>
    ),
    useNamespace: () => contextValue,
    DEFAULT_VALUE: contextValue,
  }
})

global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() { return [] }
  unobserve() {}
}

global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
}

global.requestAnimationFrame = (callback) => setTimeout(callback, 0)
global.cancelAnimationFrame = (id) => clearTimeout(id)

const realSetInterval = global.setInterval.bind(global)
const realClearInterval = global.clearInterval.bind(global)

global.setInterval = (callback, delay, ...args) => {
  const id = realSetInterval(callback, delay, ...args)
  if (typeof id?.unref === 'function') {
    id.unref()
  }
  return id
}

global.clearInterval = (id) => {
  realClearInterval(id)
}
