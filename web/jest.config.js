/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  rootDir: '.',  // explicitly set root to web directory
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: [
    '**/__tests__/**/*.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
  ],
  testPathIgnorePatterns: [
    '<rootDir>/e2e/',
    '__tests__/mocks/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/.next/',
    '<rootDir>/../.claude/',
    '<rootDir>/../.trash/',
    '<rootDir>/../node_modules/',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!(msw|until-async|@mswjs|@dicebear|better-auth|@aliimam))',
  ],
  collectCoverageFrom: [
    'components/**/*.{js,jsx,ts,tsx}',
    'app/**/*.{js,jsx,ts,tsx}',
    'lib/**/*.{js,jsx,ts,tsx}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!**/.next/**',
  ],
  // haste options to prevent scanning outside rootDir
  haste: {
    enableSymlinks: false,
  },
}

module.exports = createJestConfig(customJestConfig)
