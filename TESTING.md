# Testing Guide

This document describes the testing setup and usage for the MCP Remote Proxy project.

## Test Structure

The test suite is organized into the following categories:

### Unit Tests
- **Authentication Tests** (`tests/__tests__/auth.test.ts`)
  - JWT secret generation
  - JWT token creation and verification  
  - Role-based access control validation

- **Permissions Tests** (`tests/__tests__/permissions.test.ts`)
  - Configuration loading and validation
  - Method permission checking
  - MCP message parsing
  - Error response generation

- **Utility Tests** (`tests/__tests__/utils.test.ts`)
  - Debug logging functionality
  - Argument parsing logic
  - Reconnection backoff calculations
  - Protocol and port validation

### Integration Tests
- **Full System Tests** (`tests/__tests__/integration.test.ts`)
  - End-to-end testing with MCP filesystem server
  - TCP and WebSocket proxy functionality
  - Authentication flow testing
  - Error handling scenarios

*Note: Integration tests are currently marked as `.skip()` as they require the MCP filesystem server to be properly set up in the test environment.*

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only  
```bash
npm run test:integration
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

## Test Configuration

- **Jest Configuration**: `jest.config.cjs`
- **Test Setup**: `tests/setup.ts`
- **Timeout**: 30 seconds for integration tests

## Dependencies

### Testing Framework
- **Jest**: Test framework and runner
- **@jest/globals**: Modern Jest imports
- **ts-jest**: TypeScript support for Jest
- **@types/jest**: TypeScript definitions

### Test Dependencies
- **@modelcontextprotocol/server-filesystem**: MCP filesystem server for integration testing

## Test Coverage

The test suite covers:
- ✅ JWT authentication and token management
- ✅ Role-based permissions system
- ✅ MCP message parsing and validation
- ✅ Configuration loading and error handling
- ✅ Utility functions and argument parsing
- ⚠️ Integration with MCP servers (partially implemented)

## Adding New Tests

1. **Unit Tests**: Add test files in `tests/__tests__/` following the pattern `*.test.ts`
2. **Integration Tests**: Add integration scenarios to `integration.test.ts`
3. **Test Utilities**: Shared test utilities can be added to `tests/` directory

## Continuous Integration

Tests are configured to run automatically before the build process via the `pretest` script.

## Known Limitations

1. Integration tests require external MCP server processes
2. Some network-dependent tests may be flaky in CI environments
3. File system tests create temporary files that are cleaned up after each test

## Troubleshooting

### Common Issues

1. **Port conflicts**: Integration tests use ports 9001-9002. Ensure these are available.
2. **Timeout errors**: Increase Jest timeout if tests are running slowly.
3. **Module resolution**: Ensure all TypeScript paths are correctly configured.

### Debug Mode

Enable debug logging in tests by setting the `DEBUG` environment variable:
```bash
DEBUG=true npm test
```