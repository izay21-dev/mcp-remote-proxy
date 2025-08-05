// Test setup file
import { jest } from '@jest/globals';

// Global test setup
beforeEach(() => {
  // Reset environment variables
  delete process.env.DEBUG;
});

afterEach(() => {
  // Clear all mocks after each test
  jest.clearAllMocks();
});

// Extend Jest matchers if needed
export {};