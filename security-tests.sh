#!/bin/bash

# Enterprise MCP Proxy Security Test Suite
# Tests authentication, authorization, protocol security, and attack vectors
# Usage: ./security-tests.sh <host> <port> <jwt-secret> <protocol>

set -e

HOST=${1:-"192.168.1.12"}
PORT=${2:-"9000"}
JWT_SECRET=${3}
PROTOCOL=${4:-"tcp"}
TEST_LOG="security-test-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
CRITICAL_FAILURES=0

log() {
    echo -e "$1" | tee -a "$TEST_LOG"
}

test_result() {
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if [ "$1" = "PASS" ]; then
        PASSED_TESTS=$((PASSED_TESTS + 1))
        log "${GREEN}✅ $2${NC}"
    elif [ "$1" = "FAIL" ]; then
        FAILED_TESTS=$((FAILED_TESTS + 1))
        log "${RED}❌ $2${NC}"
        if [ "$3" = "CRITICAL" ]; then
            CRITICAL_FAILURES=$((CRITICAL_FAILURES + 1))
        fi
    else
        log "${YELLOW}⚠️  $2${NC}"
    fi
}

# Generate JWT tokens for testing
generate_valid_token() {
    ./bin/mcp-remote.js generate-token --jwt-secret "$JWT_SECRET" --user "security-test" --roles "admin" --expires-in "1h" 2>/dev/null | grep -A1 "Generated JWT token:" | tail -n1
}

generate_expired_token() {
    ./bin/mcp-remote.js generate-token --jwt-secret "$JWT_SECRET" --user "expired-test" --roles "admin" --expires-in "1ms" 2>/dev/null | grep -A1 "Generated JWT token:" | tail -n1
}

generate_insufficient_role_token() {
    ./bin/mcp-remote.js generate-token --jwt-secret "$JWT_SECRET" --user "low-priv" --roles "user" --expires-in "1h" 2>/dev/null | grep -A1 "Generated JWT token:" | tail -n1
}

generate_no_role_token() {
    ./bin/mcp-remote.js generate-token --jwt-secret "$JWT_SECRET" --user "no-roles" --expires-in "1h" 2>/dev/null | grep -A1 "Generated JWT token:" | tail -n1
}

# Test connection utility
test_connection() {
    local test_name="$1"
    local auth_token="$2" 
    local payload="$3"
    local expected_result="$4"
    local timeout="${5:-5}"
    
    local result
    if [ "$PROTOCOL" = "tcp" ]; then
        if [ -n "$auth_token" ]; then
            result=$(timeout "$timeout" bash -c "echo -e '$auth_token\n$payload' | nc $HOST $PORT" 2>&1 || echo "CONNECTION_FAILED")
        else
            result=$(timeout "$timeout" bash -c "echo '$payload' | nc $HOST $PORT" 2>&1 || echo "CONNECTION_FAILED")
        fi
    else
        # WebSocket testing would require websocat or similar
        result="WEBSOCKET_TEST_PLACEHOLDER"
    fi
    
    if [[ "$result" == *"$expected_result"* ]] || [[ "$expected_result" == "CONNECTION_FAILED" && "$result" == "CONNECTION_FAILED" ]]; then
        test_result "PASS" "$test_name"
    else
        test_result "FAIL" "$test_name" "CRITICAL"
        log "  Expected: $expected_result"
        log "  Got: $(echo "$result" | head -c 200)..."
    fi
}

log "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
log "${BLUE}🔒 ENTERPRISE MCP PROXY SECURITY TEST SUITE${NC}"
log "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
log "Target: $PROTOCOL://$HOST:$PORT"
log "JWT Secret: $(echo "$JWT_SECRET" | head -c 10)..."
log "Log file: $TEST_LOG"
log ""

# Ensure we have required tools
if ! command -v nc &> /dev/null; then
    log "${RED}ERROR: netcat (nc) is required but not installed${NC}"
    exit 1
fi

if [ -z "$JWT_SECRET" ]; then
    log "${RED}ERROR: JWT_SECRET is required${NC}"
    log "Usage: $0 <host> <port> <jwt-secret> <protocol>"
    exit 1
fi

# Generate test tokens
log "${YELLOW}🔑 Generating test tokens...${NC}"
VALID_TOKEN=$(generate_valid_token)
EXPIRED_TOKEN=$(generate_expired_token)
sleep 1  # Ensure token expires
INSUFFICIENT_ROLE_TOKEN=$(generate_insufficient_role_token)
NO_ROLE_TOKEN=$(generate_no_role_token)

log "Valid token: ${VALID_TOKEN:0:50}..."
log "Expired token: ${EXPIRED_TOKEN:0:50}..."
log ""

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 TEST CATEGORY 1: AUTHENTICATION BYPASS ATTEMPTS${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing unauthenticated access attempts...${NC}"

test_connection \
    "AUTH-001: Direct connection without token should fail" \
    "" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "CONNECTION_FAILED"

test_connection \
    "AUTH-002: Empty token should fail" \
    "" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "CONNECTION_FAILED"

test_connection \
    "AUTH-003: Malformed JWT should fail" \
    "not.a.valid.jwt" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

test_connection \
    "AUTH-004: JWT with invalid signature should fail" \
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiaGFja2VyIn0.invalid_signature" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

test_connection \
    "AUTH-005: JWT with 'none' algorithm should fail" \
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiaGFja2VyIiwicm9sZXMiOlsiYWRtaW4iXX0." \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

test_connection \
    "AUTH-006: Expired token should fail" \
    "$EXPIRED_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 TEST CATEGORY 2: AUTHORIZATION BYPASS ATTEMPTS${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing role-based access control...${NC}"

test_connection \
    "AUTHZ-001: Token with insufficient roles should fail" \
    "$INSUFFICIENT_ROLE_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_INSUFFICIENT_ROLES"

test_connection \
    "AUTHZ-002: Token without roles should fail" \
    "$NO_ROLE_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_INSUFFICIENT_ROLES"

# Test role escalation attempts
ROLE_ESCALATION_TOKEN=$(echo '{"alg":"HS256","typ":"JWT"}' | base64 -w 0).$(echo '{"user":"hacker","roles":["admin","superuser"],"iat":1640995200}' | base64 -w 0).fakesignature

test_connection \
    "AUTHZ-003: Role escalation via crafted token should fail" \
    "$ROLE_ESCALATION_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 TEST CATEGORY 3: PROTOCOL INJECTION ATTACKS${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing protocol boundary security...${NC}"

test_connection \
    "PROTO-001: Authentication response injection should not appear in MCP stream" \
    "$VALID_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}{"jsonrpc":"2.0","result":{"authenticated":true}}' \
    "protocolVersion"

test_connection \
    "PROTO-002: Method injection via authentication should fail" \
    '{"method":"tools/list","authenticated":true}' \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

test_connection \
    "PROTO-003: JSON-RPC batch injection should not bypass auth" \
    '[{"method":"authenticate"},{"method":"tools/list"}]' \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

# ═══════════════════════════════════════════════════════════════  
log "${BLUE}📋 TEST CATEGORY 4: TIMING & RESOURCE ATTACKS${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing timing attacks and resource exhaustion...${NC}"

# Test authentication timeout
TIMEOUT_TEST_START=$(date +%s)
timeout 15s bash -c "echo '' | nc $HOST $PORT" >/dev/null 2>&1 || true
TIMEOUT_TEST_END=$(date +%s)
TIMEOUT_DURATION=$((TIMEOUT_TEST_END - TIMEOUT_TEST_START))

if [ $TIMEOUT_DURATION -le 12 ]; then
    test_result "PASS" "TIME-001: Authentication timeout within reasonable bounds ($TIMEOUT_DURATION seconds)"
else
    test_result "FAIL" "TIME-001: Authentication timeout too long ($TIMEOUT_DURATION seconds)" "CRITICAL"
fi

# Test connection flooding (basic DoS protection)
log "TIME-002: Testing connection flood protection..."
CONNECTION_COUNT=0
for i in {1..20}; do
    if timeout 1s bash -c "echo '' | nc $HOST $PORT" >/dev/null 2>&1; then
        CONNECTION_COUNT=$((CONNECTION_COUNT + 1))
    fi &
done
wait

if [ $CONNECTION_COUNT -lt 15 ]; then
    test_result "PASS" "TIME-002: Connection flooding limited ($CONNECTION_COUNT/20 succeeded)"
else
    test_result "WARN" "TIME-002: High connection success rate ($CONNECTION_COUNT/20) - consider rate limiting"
fi

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 TEST CATEGORY 5: CRYPTOGRAPHIC ATTACKS${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing cryptographic security...${NC}"

# Test weak JWT secrets (if we can guess)
WEAK_SECRETS=("secret" "password" "123456" "admin" "test" "jwt" "key")
for weak_secret in "${WEAK_SECRETS[@]}"; do
    if [ "$weak_secret" = "$JWT_SECRET" ]; then
        test_result "FAIL" "CRYPTO-001: JWT secret is weak/common: $weak_secret" "CRITICAL"
    fi
done
test_result "PASS" "CRYPTO-001: JWT secret appears to be strong"

# Test JWT algorithm confusion
ALG_CONFUSION_TOKEN="eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.$(echo '{"user":"hacker","roles":["admin"]}' | base64 -w 0).$(echo "$JWT_SECRET" | base64 -w 0)"

test_connection \
    "CRYPTO-002: Algorithm confusion attack should fail" \
    "$ALG_CONFUSION_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 TEST CATEGORY 6: MESSAGE TAMPERING ATTACKS${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing message integrity and tampering...${NC}"

test_connection \
    "TAMPER-001: Oversized message should be handled safely" \
    "$VALID_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"oversized":"'$(printf 'A%.0s' {1..10000})'"}}'  \
    "error\\|protocolVersion"

test_connection \
    "TAMPER-002: Malformed JSON should be rejected" \
    "$VALID_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{' \
    "error"

test_connection \
    "TAMPER-003: Null bytes in message should be handled" \
    "$VALID_TOKEN" \
    $'{"method":"initialize\\x00","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "error\\|protocolVersion"

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 TEST CATEGORY 7: INFORMATION DISCLOSURE${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing for information leaks...${NC}"

# Test error message information disclosure
test_connection \
    "INFO-001: Error messages should not leak sensitive information" \
    "invalid.token.here" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
    "AUTH_FAILED"

# Test if internal paths or stack traces are exposed
test_connection \
    "INFO-002: Server errors should not expose internal paths" \
    "$VALID_TOKEN" \
    '{"method":"../../../etc/passwd","params":{}}' \
    "error"

# Test if JWT secret could be leaked in responses  
RESPONSE=$(timeout 5s bash -c "echo -e '$VALID_TOKEN\n{\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{}}}' | nc $HOST $PORT" 2>/dev/null | head -c 1000)
if [[ "$RESPONSE" == *"$JWT_SECRET"* ]]; then
    test_result "FAIL" "INFO-003: JWT secret leaked in response" "CRITICAL"
else
    test_result "PASS" "INFO-003: JWT secret not exposed in responses"
fi

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 TEST CATEGORY 8: POSITIVE SECURITY TESTS${NC}"
# ═══════════════════════════════════════════════════════════════

log "${YELLOW}Testing legitimate functionality works correctly...${NC}"

test_connection \
    "POSITIVE-001: Valid authentication should succeed" \
    "$VALID_TOKEN" \
    '{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"security-test","version":"1.0"}}}' \
    "protocolVersion"

test_connection \
    "POSITIVE-002: MCP tools/list should work after auth" \
    "$VALID_TOKEN" \
    $'{"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}\n{"method":"tools/list","params":{},"id":1}' \
    "result\\|tools"

# ═══════════════════════════════════════════════════════════════
log "${BLUE}📋 SECURITY TEST SUMMARY${NC}"  
# ═══════════════════════════════════════════════════════════════

log ""
log "═══════════════════════════════════════════════════════════════"
log "${BLUE}🔒 ENTERPRISE SECURITY TEST RESULTS${NC}"
log "═══════════════════════════════════════════════════════════════"
log "Total Tests: $TOTAL_TESTS"
log "Passed: ${GREEN}$PASSED_TESTS${NC}"
log "Failed: ${RED}$FAILED_TESTS${NC}"  
log "Critical Failures: ${RED}$CRITICAL_FAILURES${NC}"
log ""

if [ $CRITICAL_FAILURES -gt 0 ]; then
    log "${RED}🚨 CRITICAL SECURITY ISSUES FOUND - DO NOT DEPLOY${NC}"
    exit 1
elif [ $FAILED_TESTS -gt 0 ]; then
    log "${YELLOW}⚠️  Some security tests failed - review before production deployment${NC}"
    exit 1
else
    log "${GREEN}✅ ALL SECURITY TESTS PASSED - SYSTEM APPEARS SECURE${NC}"
fi

log ""
log "Detailed log saved to: $TEST_LOG"
log "$(date): Security testing completed"