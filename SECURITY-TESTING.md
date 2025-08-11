# Enterprise MCP Proxy Security Testing Suite

## Overview

This comprehensive security testing suite validates the MCP Remote Proxy against enterprise security standards, compliance requirements, and common attack vectors. The tests are designed for corporate deployment validation and continuous security assessment.

## Test Categories

### 🔒 Basic Security Tests (`security-tests.sh`)

1. **Authentication Bypass Attempts**
   - Unauthenticated access attempts
   - Malformed JWT tokens
   - Invalid signature attacks
   - Algorithm confusion attacks
   - Expired token validation

2. **Authorization Bypass Attempts**
   - Role-based access control validation
   - Privilege escalation attempts
   - Insufficient role testing

3. **Protocol Injection Attacks**
   - Authentication response injection
   - Method injection attempts
   - JSON-RPC batch injection

4. **Timing & Resource Attacks**
   - Authentication timeout validation
   - Connection flooding protection
   - Resource exhaustion tests

5. **Cryptographic Security**
   - JWT secret strength validation
   - Algorithm confusion prevention
   - Weak secret detection

6. **Message Tampering**
   - Oversized message handling
   - Malformed JSON rejection
   - Null byte injection

7. **Information Disclosure**
   - Error message analysis
   - Internal path exposure
   - JWT secret leakage

8. **Positive Security Tests**
   - Valid authentication flows
   - Legitimate MCP operations

### 🛡️ Advanced Security Tests (`advanced-security-tests.sh`)

1. **OWASP Top 10 Compliance**
   - A01: Broken Access Control
   - A02: Cryptographic Failures
   - A03: Injection Attacks
   - A05: Security Misconfiguration
   - A06: Vulnerable Components
   - A07: Authentication Failures

2. **Enterprise Compliance**
   - SOC 2 Type II requirements
   - GDPR compliance validation
   - ISO 27001 standards

3. **Business Logic Attacks**
   - Workflow bypass attempts
   - Parameter pollution
   - Logic flaw exploitation

4. **Performance & DoS Attacks**
   - Large payload handling
   - Nested JSON attacks
   - Connection exhaustion

5. **Side-Channel Attacks**
   - Timing attack analysis
   - Information leakage via timing

## Usage Instructions

### Prerequisites

```bash
# Ensure required tools are installed
sudo apt-get install netcat-traditional  # or netcat-openbsd
# or on macOS:
brew install netcat

# Build the MCP proxy
npm run build
```

### Running Basic Security Tests

```bash
# Start your MCP proxy server first
./bin/mcp-remote.js server tcp --port 9000 \
  --jwt-secret "your-strong-secret-here" \
  --require-roles admin \
  -- your-mcp-server-command

# Run basic security tests
./security-tests.sh 192.168.1.12 9000 "your-strong-secret-here" tcp
```

### Running Advanced Security Tests

```bash
# Run advanced/compliance tests
./advanced-security-tests.sh 192.168.1.12 9000 "your-strong-secret-here" tcp
```

### WebSocket Testing

```bash
# For WebSocket protocol testing
./security-tests.sh localhost 9000 "your-secret" ws
./advanced-security-tests.sh localhost 9000 "your-secret" ws
```

## Test Results Interpretation

### Exit Codes
- `0`: All tests passed - system appears secure
- `1`: Some security tests failed - review required
- `2`: Critical compliance issues found - do not deploy

### Risk Levels
- **LOW**: >80% tests passed, no compliance issues
- **MEDIUM**: 60-80% tests passed, minor issues
- **HIGH**: <60% tests passed or compliance failures

### Log Files
- `security-test-YYYYMMDD-HHMMSS.log`: Basic security test results
- `advanced-security-YYYYMMDD-HHMMSS.log`: Advanced test results

## Security Checklist for Production Deployment

### ✅ Authentication & Authorization
- [ ] Strong JWT secrets (>256 bits entropy)
- [ ] Role-based access control implemented
- [ ] Token expiration properly enforced
- [ ] Authentication timeout configured
- [ ] No default credentials present

### ✅ Protocol Security  
- [ ] TLS/SSL encryption in production
- [ ] Authentication responses filtered from MCP stream
- [ ] Proper message boundary handling
- [ ] Input validation for all parameters
- [ ] JSON injection protection

### ✅ Infrastructure Security
- [ ] Rate limiting implemented
- [ ] Connection limits configured  
- [ ] DDoS protection in place
- [ ] Error messages don't leak sensitive info
- [ ] Debug information disabled in production

### ✅ Compliance Requirements
- [ ] Security event logging configured
- [ ] Access control documentation complete
- [ ] PII handling compliance verified
- [ ] Regular security assessments scheduled
- [ ] Incident response procedures defined

## Common Security Issues & Fixes

### Issue: Authentication Bypass
**Symptoms**: Tests AUTH-001 through AUTH-006 fail
**Fix**: Ensure JWT secret is properly configured and validation is working

### Issue: Role Escalation
**Symptoms**: Tests AUTHZ-001, AUTHZ-002 fail  
**Fix**: Verify role-based access control implementation

### Issue: Protocol Injection
**Symptoms**: Tests PROTO-001 through PROTO-003 fail
**Fix**: Ensure authentication responses are filtered from MCP stream

### Issue: Information Disclosure
**Symptoms**: Tests INFO-001 through INFO-003 fail
**Fix**: Sanitize error messages, avoid exposing internal details

### Issue: DoS Vulnerabilities  
**Symptoms**: Tests DOS-001 through DOS-003 fail
**Fix**: Implement payload size limits, connection throttling

## Automated Security Testing

### CI/CD Integration

```yaml
# .github/workflows/security.yml
name: Security Tests
on: [push, pull_request]
jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Node.js
        uses: actions/setup-node@v2
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
      - name: Start test server
        run: |
          ./bin/mcp-remote.js server tcp --port 9000 \
            --jwt-secret "${{ secrets.TEST_JWT_SECRET }}" \
            --require-roles admin \
            -- echo '{"result":{"protocolVersion":"2024-11-05","capabilities":{}}}' &
          sleep 2
      - name: Run security tests
        run: |
          ./security-tests.sh localhost 9000 "${{ secrets.TEST_JWT_SECRET }}" tcp
          ./advanced-security-tests.sh localhost 9000 "${{ secrets.TEST_JWT_SECRET }}" tcp
```

### Scheduled Security Scans

```bash
#!/bin/bash
# /etc/cron.weekly/mcp-security-scan

cd /path/to/mcp-remote-proxy
./security-tests.sh production-host 9000 "$PROD_JWT_SECRET" tcp
./advanced-security-tests.sh production-host 9000 "$PROD_JWT_SECRET" tcp

# Send results to security team
mail -s "Weekly MCP Security Scan Results" security@company.com < security-test-*.log
```

## Security Best Practices

### JWT Secret Management
```bash
# Generate cryptographically strong secrets
./bin/mcp-remote.js generate-secret --bits 512

# Store in environment variables, not code
export MCP_JWT_SECRET="$(./bin/mcp-remote.js generate-secret --bits 256)"
```

### Production Configuration
```bash
# Use strong authentication
./bin/mcp-remote.js server tcp \
  --port 9000 \
  --jwt-secret "$MCP_JWT_SECRET" \
  --require-roles "admin" \
  --permissions-config "/path/to/permissions.json" \
  -- your-secure-mcp-server

# Monitor logs for security events
tail -f /var/log/mcp-proxy.log | grep -E "(AUTH_FAILED|INSUFFICIENT_ROLES|ERROR)"
```

### Network Security
```bash
# Use firewall rules
iptables -A INPUT -p tcp --dport 9000 -s trusted-network/24 -j ACCEPT
iptables -A INPUT -p tcp --dport 9000 -j DROP

# Use reverse proxy with TLS
nginx configuration:
location /mcp {
    proxy_pass http://localhost:9000;
    proxy_ssl_verify on;
    proxy_ssl_trusted_certificate /path/to/ca.crt;
}
```

## Reporting Security Issues

If you discover security vulnerabilities:

1. **Do NOT** create public GitHub issues
2. Email security details to: [your-security-email]
3. Include:
   - Detailed vulnerability description
   - Steps to reproduce
   - Potential impact assessment
   - Suggested fixes (if any)

## Security Testing Schedule

### Development
- Run basic security tests on every commit
- Run advanced tests on every release candidate

### Staging  
- Full security suite weekly
- Penetration testing monthly

### Production
- Monitoring-based security validation daily
- Full security assessment quarterly
- External security audit annually

---

**Security is everyone's responsibility. Regular testing and monitoring are essential for maintaining a secure MCP deployment.**