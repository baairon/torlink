#!/usr/bin/env bash
# Smoke tests for torzlink.sh / torzlink.ps1 — see docs/follow-ups-launchers.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0
SKIP=0
FIXTURE=""
MOCK_BIN=""

pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $1" >&2
  FAIL=$((FAIL + 1))
}

skip() {
  echo "SKIP: $1"
  SKIP=$((SKIP + 1))
}

cleanup_fixture() {
  if [[ -n "$FIXTURE" && -d "$FIXTURE" ]]; then
    rm -rf "$FIXTURE"
    FIXTURE=""
  fi
}

setup_fixture() {
  cleanup_fixture
  FIXTURE="$(mktemp -d)"
  MOCK_BIN="$FIXTURE/mock_bin"
  mkdir -p "$MOCK_BIN" "$FIXTURE/packaging/docker"

  cp "$ROOT/torzlink.sh" "$FIXTURE/"
  cp "$ROOT/torzlink.ps1" "$FIXTURE/"
  cp "$ROOT/packaging/docker/docker-compose.yml" "$FIXTURE/packaging/docker/"

  write_unix_mock() {
    local name="$1"
    local body="$2"
    printf '%s\n' "$body" >"$MOCK_BIN/$name"
    chmod +x "$MOCK_BIN/$name"
  }

  write_win_mock() {
    local name="$1"
    local body="$2"
    printf '%s\r\n' "$body" >"$MOCK_BIN/${name}.cmd"
  }

  local docker_body='#!/usr/bin/env bash
echo "docker $*" >>"${DOCKER_LOG:-/dev/null}"
if [[ "$1" == "compose" && "$2" == "version" ]]; then
  exit 0
fi
if [[ "$1" == "compose" ]]; then
  exit 0
fi
exit 0'

  local npm_body='#!/usr/bin/env bash
echo "npm $*" >>"${NPM_LOG:-/dev/null}"
exit 0'

  local node_body='#!/usr/bin/env bash
exit 0'

  write_unix_mock docker "$docker_body"
  write_unix_mock npm "$npm_body"
  write_unix_mock node "$node_body"

  # pwsh on Windows resolves docker/npm/node via PATHEXT (.cmd), not extensionless bash scripts.
  write_win_mock docker '@echo off
echo docker %*>>"%DOCKER_LOG%"
if "%1"=="compose" if "%2"=="version" exit /b 0
if "%1"=="compose" exit /b 0
exit /b 0'

  write_win_mock npm '@echo off
echo npm %*>>"%NPM_LOG%"
exit /b 0'

  write_win_mock node '@echo off
exit /b 0'
}

run_in_fixture() {
  (
    cd "$FIXTURE"
    export PATH="$MOCK_BIN:$PATH"
    # Relative paths so Windows .cmd mocks write beside the fixture (cmd cannot use MSYS /tmp paths).
    export NPM_LOG="npm.log"
    export DOCKER_LOG="docker.log"
    : >"$NPM_LOG"
    : >"$DOCKER_LOG"
    "$@"
  )
}

test_static_contract() {
  echo "--- static contract ---"

  if grep -q 'while true' "$ROOT/torzlink.sh" && grep -q 'Invalid option' "$ROOT/torzlink.sh"; then
    pass "bash menu loop re-prompts on invalid input (source)"
  else
    fail "bash menu loop missing invalid-option handling"
  fi

  if grep -q 'while ($true)' "$ROOT/torzlink.ps1" && grep -q 'Invalid option' "$ROOT/torzlink.ps1"; then
    pass "PowerShell menu loop re-prompts on invalid input (source)"
  else
    fail "PowerShell menu loop missing invalid-option handling"
  fi

  if grep -q 'docker compose -f packaging/docker/docker-compose.yml build --quiet torzlink' "$ROOT/torzlink.sh" \
    && grep -q 'docker compose -f packaging/docker/docker-compose.yml run --rm -it torzlink' "$ROOT/torzlink.sh"; then
    pass "bash Docker path uses quiet compose build then run"
  else
    fail "bash Docker path does not match expected compose invocation"
  fi

  if grep -q 'docker compose -f \$composeFile build --quiet torzlink' "$ROOT/torzlink.ps1" \
    && grep -q 'docker compose -f \$composeFile run --rm -it torzlink' "$ROOT/torzlink.ps1"; then
    pass "PowerShell Docker path uses quiet compose build then run"
  else
    fail "PowerShell Docker path does not match expected compose invocation"
  fi

  if grep -qF -- '--web|-w|3) mode=web' "$ROOT/torzlink.sh" \
    && grep -q 'npm run serve' "$ROOT/torzlink.sh"; then
    pass "bash exposes --web and invokes npm run serve"
  else
    fail "bash web mode missing (--web / npm run serve)"
  fi

  if grep -qF -- '[switch]$Web' "$ROOT/torzlink.ps1" \
    && grep -q 'npm run serve' "$ROOT/torzlink.ps1"; then
    pass "PowerShell exposes -Web and invokes npm run serve"
  else
    fail "PowerShell web mode missing (-Web / npm run serve)"
  fi
}

test_bash_native_bypass() {
  echo "--- bash --native bypass ---"
  setup_fixture
  if run_in_fixture bash ./torzlink.sh --native; then
    if grep -q 'run launch' "$FIXTURE/npm.log"; then
      pass "bash --native invokes npm run launch"
    else
      fail "bash --native did not invoke npm run launch"
    fi
  else
    fail "bash --native exited non-zero"
  fi
}

test_bash_docker_bypass() {
  echo "--- bash --docker bypass ---"
  setup_fixture
  if run_in_fixture bash ./torzlink.sh --docker </dev/null; then
    if grep -q 'compose' "$FIXTURE/docker.log" && grep -q 'docker-compose.yml' "$FIXTURE/docker.log"; then
      pass "bash --docker invokes docker compose"
    else
      fail "bash --docker did not invoke docker compose"
    fi
    if [[ -s "$FIXTURE/npm.log" ]]; then
      fail "bash --docker must not invoke npm"
    else
      pass "bash --docker does not invoke npm"
    fi
  else
    fail "bash --docker exited non-zero"
  fi
}

test_bash_web_bypass() {
  echo "--- bash --web bypass ---"
  setup_fixture
  if run_in_fixture bash ./torzlink.sh --web; then
    if grep -q 'run serve' "$FIXTURE/npm.log"; then
      pass "bash --web invokes npm run serve"
    else
      fail "bash --web did not invoke npm run serve"
    fi
  else
    fail "bash --web exited non-zero"
  fi
}

test_bash_missing_env() {
  echo "--- bash missing .env ---"
  setup_fixture
  [[ ! -f "$FIXTURE/.env" ]] || fail "fixture should start without .env"
  if run_in_fixture bash ./torzlink.sh --docker </dev/null; then
    if [[ -f "$FIXTURE/.env" ]]; then
      pass "bash --docker creates empty .env when missing (non-interactive)"
    else
      fail "bash --docker did not create .env"
    fi
  else
    fail "bash --docker with missing .env exited non-zero"
  fi
}

test_bash_no_tty() {
  echo "--- bash no TTY ---"
  setup_fixture
  local out rc
  set +e
  out="$(run_in_fixture bash ./torzlink.sh </dev/null 2>&1)"
  rc=$?
  set -e
  if [[ $rc -eq 1 ]] && echo "$out" | grep -q 'No TTY'; then
    pass "bash without TTY or flags exits 1 with clear message"
  else
    fail "bash without TTY expected exit 1 (got $rc)"
  fi
}

test_bash_invalid_menu_runtime() {
  echo "--- bash invalid menu (runtime, needs PTY) ---"
  if ! command -v script >/dev/null 2>&1; then
    skip "bash invalid menu runtime: script(1) not available"
    return
  fi

  setup_fixture
  local out rc
  set +e
  out="$(
    cd "$FIXTURE"
    export PATH="$MOCK_BIN:$PATH"
    export NPM_LOG="npm.log"
    export DOCKER_LOG="docker.log"
    : >"$NPM_LOG"
    printf 'x\n1\n' | script -q -c "bash ./torzlink.sh" /dev/null 2>&1
  )"
  rc=$?
  set -e

  if [[ $rc -eq 0 ]] && echo "$out" | grep -q 'Invalid option' && grep -q 'run launch' "$FIXTURE/npm.log"; then
    pass "bash invalid menu re-prompts then accepts valid choice"
  else
    fail "bash invalid menu runtime test failed (exit $rc)"
  fi
}

test_ps1_docker_bypass() {
  echo "--- PowerShell -Docker bypass ---"
  if ! command -v pwsh >/dev/null 2>&1; then
    skip "PowerShell tests: pwsh not found"
    return
  fi

  setup_fixture
  if run_in_fixture pwsh -NoProfile -File ./torzlink.ps1 -Docker </dev/null; then
    if grep -q 'compose' "$FIXTURE/docker.log"; then
      pass "PowerShell -Docker invokes docker compose"
    else
      fail "PowerShell -Docker did not invoke docker compose"
    fi
    if [[ -s "$FIXTURE/npm.log" ]]; then
      fail "PowerShell -Docker must not invoke npm"
    else
      pass "PowerShell -Docker does not invoke npm"
    fi
  else
    fail "PowerShell -Docker exited non-zero"
  fi
}

test_ps1_native_bypass() {
  echo "--- PowerShell -Native bypass ---"
  if ! command -v pwsh >/dev/null 2>&1; then
    skip "PowerShell -Native: pwsh not found"
    return
  fi

  setup_fixture
  if run_in_fixture pwsh -NoProfile -File ./torzlink.ps1 -Native; then
    if grep -q 'run launch' "$FIXTURE/npm.log"; then
      pass "PowerShell -Native invokes npm run launch"
    else
      fail "PowerShell -Native did not invoke npm run launch"
    fi
  else
    fail "PowerShell -Native exited non-zero"
  fi
}

test_ps1_web_bypass() {
  echo "--- PowerShell -Web bypass ---"
  if ! command -v pwsh >/dev/null 2>&1; then
    skip "PowerShell -Web: pwsh not found"
    return
  fi

  setup_fixture
  if run_in_fixture pwsh -NoProfile -File ./torzlink.ps1 -Web; then
    if grep -q 'run serve' "$FIXTURE/npm.log"; then
      pass "PowerShell -Web invokes npm run serve"
    else
      fail "PowerShell -Web did not invoke npm run serve"
    fi
  else
    fail "PowerShell -Web exited non-zero"
  fi
}

test_ps1_missing_env() {
  echo "--- PowerShell missing .env ---"
  if ! command -v pwsh >/dev/null 2>&1; then
    skip "PowerShell missing .env: pwsh not found"
    return
  fi

  setup_fixture
  if run_in_fixture pwsh -NoProfile -File ./torzlink.ps1 -Docker </dev/null; then
    if [[ -f "$FIXTURE/.env" ]]; then
      pass "PowerShell -Docker creates empty .env when missing (non-interactive)"
    else
      fail "PowerShell -Docker did not create .env"
    fi
  else
    fail "PowerShell -Docker with missing .env exited non-zero"
  fi
}

test_ps1_no_tty() {
  echo "--- PowerShell no TTY ---"
  if ! command -v pwsh >/dev/null 2>&1; then
    skip "PowerShell no TTY: pwsh not found"
    return
  fi

  setup_fixture
  local out rc
  set +e
  out="$(run_in_fixture pwsh -NoProfile -File ./torzlink.ps1 </dev/null 2>&1)"
  rc=$?
  set -e
  if [[ $rc -eq 1 ]] && echo "$out" | grep -q 'No TTY'; then
    pass "PowerShell without TTY or flags exits 1 with clear message"
  else
    fail "PowerShell without TTY expected exit 1 (got $rc)"
  fi
}

trap cleanup_fixture EXIT

main() {
  echo "Launcher smoke tests (repo: $ROOT)"
  echo ""

  test_static_contract
  test_bash_native_bypass
  test_bash_docker_bypass
  test_bash_web_bypass
  test_bash_missing_env
  test_bash_no_tty
  test_bash_invalid_menu_runtime
  test_ps1_native_bypass
  test_ps1_docker_bypass
  test_ps1_web_bypass
  test_ps1_missing_env
  test_ps1_no_tty

  echo ""
  echo "Results: $PASS passed, $FAIL failed, $SKIP skipped"
  if [[ $FAIL -gt 0 ]]; then
    exit 1
  fi
}

main "$@"
