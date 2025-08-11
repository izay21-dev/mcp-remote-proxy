#!/bin/bash

# MCP Proxy Security Test Runner
# Executes comprehensive security testing suite
# Usage: ./run-security-tests.sh <host> <port> <jwt-secret> <protocol>

set -e

HOST=${1:-"localhost"}
PORT=${2:-"9000"}
JWT_SECRET=${3}
PROTOCOL=${4:-"tcp"}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}🔒 MCP PROXY COMPREHENSIVE SECURITY TESTING SUITE${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "Target: ${YELLOW}$PROTOCOL://$HOST:$PORT${NC}"
echo -e "Test Suite Version: ${YELLOW}Enterprise v1.0${NC}"
echo -e "Timestamp: ${YELLOW}$(date)${NC}"
echo ""

if [ -z "$JWT_SECRET" ]; then
    echo -e "${RED}ERROR: JWT_SECRET is required${NC}"
    echo "Usage: $0 <host> <port> <jwt-secret> <protocol>"
    echo ""
    echo "Example:"
    echo "  $0 localhost 9000 \"your-jwt-secret-here\" tcp"
    exit 1
fi

# Check if required files exist
if [ ! -f "./security-tests.sh" ]; then
    echo -e "${RED}ERROR: security-tests.sh not found${NC}"
    exit 1
fi

if [ ! -f "./advanced-security-tests.sh" ]; then
    echo -e "${RED}ERROR: advanced-security-tests.sh not found${NC}"
    exit 1
fi

# Check if netcat is available
if ! command -v nc &> /dev/null; then
    echo -e "${RED}ERROR: netcat (nc) is required but not installed${NC}"
    echo "Install with: apt-get install netcat-traditional (Linux) or brew install netcat (macOS)"
    exit 1
fi

echo -e "${BLUE}🔧 Pre-flight checks passed${NC}"
echo ""

# Test connectivity
echo -e "${YELLOW}Testing connectivity to $HOST:$PORT...${NC}"
if timeout 3s bash -c "</dev/tcp/$HOST/$PORT"; then
    echo -e "${GREEN}✅ Target is reachable${NC}"
else
    echo -e "${RED}❌ Cannot connect to $HOST:$PORT${NC}"
    echo "Ensure your MCP proxy server is running:"
    echo "  ./bin/mcp-remote.js server $PROTOCOL --port $PORT --jwt-secret \"$JWT_SECRET\" --require-roles admin -- your-command"
    exit 1
fi
echo ""

# Create results directory
RESULTS_DIR="security-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"
echo -e "${BLUE}Results will be saved to: $RESULTS_DIR/${NC}"
echo ""

# Run basic security tests
echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${PURPLE}🛡️  PHASE 1: BASIC SECURITY TESTING${NC}"
echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

BASIC_EXIT_CODE=0
if ./security-tests.sh "$HOST" "$PORT" "$JWT_SECRET" "$PROTOCOL"; then
    echo -e "${GREEN}✅ Basic security tests completed successfully${NC}"
else
    BASIC_EXIT_CODE=$?
    echo -e "${RED}❌ Basic security tests found issues (exit code: $BASIC_EXIT_CODE)${NC}"
fi

# Move basic test logs to results directory
mv security-test-*.log "$RESULTS_DIR/" 2>/dev/null || true

echo ""

# Run advanced security tests
echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${PURPLE}🔬 PHASE 2: ADVANCED SECURITY TESTING${NC}"
echo -e "${PURPLE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

ADVANCED_EXIT_CODE=0
if ./advanced-security-tests.sh "$HOST" "$PORT" "$JWT_SECRET" "$PROTOCOL"; then
    echo -e "${GREEN}✅ Advanced security tests completed successfully${NC}"
else
    ADVANCED_EXIT_CODE=$?
    echo -e "${RED}❌ Advanced security tests found issues (exit code: $ADVANCED_EXIT_CODE)${NC}"
fi

# Move advanced test logs to results directory  
mv advanced-security-*.log "$RESULTS_DIR/" 2>/dev/null || true

echo ""

# Generate summary report
SUMMARY_FILE="$RESULTS_DIR/security-summary.txt"
echo "MCP Proxy Security Test Summary" > "$SUMMARY_FILE"
echo "===============================" >> "$SUMMARY_FILE"
echo "Test Date: $(date)" >> "$SUMMARY_FILE"
echo "Target: $PROTOCOL://$HOST:$PORT" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"
echo "Basic Security Tests: $([ $BASIC_EXIT_CODE -eq 0 ] && echo "PASSED" || echo "FAILED (code: $BASIC_EXIT_CODE)")" >> "$SUMMARY_FILE"
echo "Advanced Security Tests: $([ $ADVANCED_EXIT_CODE -eq 0 ] && echo "PASSED" || echo "FAILED (code: $ADVANCED_EXIT_CODE)")" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

# Final assessment
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}📊 FINAL SECURITY ASSESSMENT${NC}"  
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo ""

OVERALL_STATUS="UNKNOWN"
OVERALL_EXIT_CODE=0

if [ $BASIC_EXIT_CODE -eq 0 ] && [ $ADVANCED_EXIT_CODE -eq 0 ]; then
    OVERALL_STATUS="SECURE"
    OVERALL_EXIT_CODE=0
    echo -e "${GREEN}🎉 OVERALL STATUS: SECURE${NC}"
    echo -e "${GREEN}✅ All security tests passed${NC}"
    echo -e "${GREEN}✅ System appears ready for production deployment${NC}"
    echo "Overall Status: SECURE - Ready for Production" >> "$SUMMARY_FILE"
elif [ $ADVANCED_EXIT_CODE -eq 2 ]; then
    OVERALL_STATUS="CRITICAL COMPLIANCE ISSUES"
    OVERALL_EXIT_CODE=2
    echo -e "${RED}🚨 OVERALL STATUS: CRITICAL COMPLIANCE ISSUES${NC}"
    echo -e "${RED}❌ Compliance failures detected${NC}"
    echo -e "${RED}❌ DO NOT DEPLOY TO PRODUCTION${NC}"
    echo "Overall Status: CRITICAL - Do Not Deploy" >> "$SUMMARY_FILE"
elif [ $BASIC_EXIT_CODE -ne 0 ] || [ $ADVANCED_EXIT_CODE -ne 0 ]; then
    OVERALL_STATUS="SECURITY ISSUES DETECTED"
    OVERALL_EXIT_CODE=1
    echo -e "${YELLOW}⚠️  OVERALL STATUS: SECURITY ISSUES DETECTED${NC}"
    echo -e "${YELLOW}⚠️  Some security tests failed${NC}"
    echo -e "${YELLOW}⚠️  Review and fix issues before production deployment${NC}"
    echo "Overall Status: ISSUES DETECTED - Review Required" >> "$SUMMARY_FILE"
fi

echo ""
echo -e "${BLUE}📁 Test Results Location:${NC}"
echo -e "  Directory: ${YELLOW}$RESULTS_DIR/${NC}"
echo -e "  Summary: ${YELLOW}$SUMMARY_FILE${NC}"
echo -e "  Logs: ${YELLOW}$RESULTS_DIR/*.log${NC}"

echo ""
echo -e "${BLUE}📋 Next Steps:${NC}"
if [ $OVERALL_EXIT_CODE -eq 0 ]; then
    echo "  1. Review test logs for any warnings"
    echo "  2. Implement TLS/SSL for production"
    echo "  3. Set up security monitoring"
    echo "  4. Schedule regular security assessments"
elif [ $OVERALL_EXIT_CODE -eq 2 ]; then
    echo "  1. 🚨 IMMEDIATE: Address all compliance failures"
    echo "  2. Re-run tests after fixes"
    echo "  3. Do not deploy until all critical issues resolved"
else
    echo "  1. Review failed tests in detail"
    echo "  2. Implement recommended security fixes"
    echo "  3. Re-run security tests to verify fixes"
    echo "  4. Consider additional security hardening"
fi

echo ""
echo -e "${CYAN}Security testing completed at $(date)${NC}"
echo -e "${CYAN}Thank you for prioritizing security! 🔒${NC}"

exit $OVERALL_EXIT_CODE