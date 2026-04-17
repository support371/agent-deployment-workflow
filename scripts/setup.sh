#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# GEM Agent Builder — one-command bootstrap
#
# Discovers tokens, creates a Vercel deploy hook, generates the
# auth token, writes .env.local, and pushes every variable to the
# linked Vercel project (production environment).
#
# Idempotent. Safe to re-run.
# ──────────────────────────────────────────────────────────────
set -euo pipefail

# ── pretty output ─────────────────────────────────────────────
C_TEAL=$'\033[38;5;43m'
C_DIM=$'\033[2m'
C_WARN=$'\033[38;5;215m'
C_ERR=$'\033[38;5;203m'
C_OK=$'\033[38;5;43m'
C_RESET=$'\033[0m'

step()  { printf '%s▸%s %s\n'            "$C_TEAL" "$C_RESET" "$1"; }
ok()    { printf '%s✓%s %s\n'            "$C_OK"   "$C_RESET" "$1"; }
warn()  { printf '%s!%s %s\n'            "$C_WARN" "$C_RESET" "$1"; }
err()   { printf '%s✗%s %s\n' "$C_ERR" "$C_RESET" "$1" >&2; }
dim()   { printf '%s  %s%s\n'            "$C_DIM"  "$1" "$C_RESET"; }
hr()    { printf '%s────────────────────────────────────────────%s\n' "$C_DIM" "$C_RESET"; }

banner() {
  printf '\n'
  printf '%s  ╔══════════════════════════════════════════╗%s\n' "$C_TEAL" "$C_RESET"
  printf '%s  ║        GEM Agent Builder · Setup         ║%s\n' "$C_TEAL" "$C_RESET"
  printf '%s  ╚══════════════════════════════════════════╝%s\n' "$C_TEAL" "$C_RESET"
  printf '\n'
}

# ── working directory ─────────────────────────────────────────
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
ENV_FILE="$ROOT/.env.local"

banner
dim "root: $ROOT"

# ── load existing .env.local so re-runs are idempotent ────────
declare -A EXISTING=()
if [[ -f "$ENV_FILE" ]]; then
  while IFS='=' read -r key val; do
    # skip blanks & comments
    [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
    # strip quotes around value
    val="${val%\"}"; val="${val#\"}"
    val="${val%\'}"; val="${val#\'}"
    EXISTING["$key"]="$val"
  done < <(grep -E '^[A-Z_][A-Z0-9_]*=' "$ENV_FILE" || true)
  ok ".env.local loaded ($(wc -l < "$ENV_FILE" | tr -d ' ') lines)"
else
  dim ".env.local does not exist yet — will create"
fi
hr

# ── helper: get env var with override precedence ──────────────
# precedence: existing .env.local  >  shell env  >  empty
lookup() {
  local key="$1"
  if [[ -n "${EXISTING[$key]:-}" ]]; then
    printf '%s' "${EXISTING[$key]}"
  elif [[ -n "${!key:-}" ]]; then
    printf '%s' "${!key}"
  fi
}

# ─────────────────────────────────────────────────────────────
# 1. ANTHROPIC_API_KEY — prompt if missing
# ─────────────────────────────────────────────────────────────
step "Anthropic API key"
ANTHROPIC_API_KEY="$(lookup ANTHROPIC_API_KEY)"
if [[ -z "$ANTHROPIC_API_KEY" ]]; then
  if [[ -t 0 ]]; then
    printf '  Paste your Anthropic API key (sk-ant-…): '
    read -r -s ANTHROPIC_API_KEY
    printf '\n'
  else
    warn "ANTHROPIC_API_KEY not set and stdin is not a TTY — skipping prompt"
  fi
fi
if [[ -n "$ANTHROPIC_API_KEY" ]]; then
  ok "ANTHROPIC_API_KEY set (${#ANTHROPIC_API_KEY} chars)"
else
  warn "ANTHROPIC_API_KEY is empty — agent will refuse to start"
fi

ANTHROPIC_MODEL="$(lookup ANTHROPIC_MODEL)"
ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-sonnet-4-20250514}"
ok "ANTHROPIC_MODEL = $ANTHROPIC_MODEL"
hr

# ─────────────────────────────────────────────────────────────
# 2. Vercel — read project link + CLI auth token
# ─────────────────────────────────────────────────────────────
step "Vercel project link"
VERCEL_PROJECT_ID=""
VERCEL_TEAM_ID=""
VERCEL_PROJECT_NAME=""
if [[ -f "$ROOT/.vercel/project.json" ]]; then
  VERCEL_PROJECT_ID="$(node -e "console.log(require('./.vercel/project.json').projectId || '')" 2>/dev/null || true)"
  VERCEL_TEAM_ID="$(node -e "console.log(require('./.vercel/project.json').orgId || '')" 2>/dev/null || true)"
  VERCEL_PROJECT_NAME="$(node -e "console.log(require('./.vercel/project.json').projectName || '')" 2>/dev/null || true)"
fi
if [[ -n "$VERCEL_PROJECT_ID" && -n "$VERCEL_TEAM_ID" ]]; then
  ok "linked project: ${VERCEL_PROJECT_NAME:-<unknown>} ($VERCEL_PROJECT_ID)"
  ok "team: $VERCEL_TEAM_ID"
else
  warn "not linked — run \`vercel link\` first to enable deploy hook + env push"
fi

step "Vercel auth token"
VERCEL_TOKEN="$(lookup VERCEL_TOKEN)"
# Locations Vercel CLI stores its token — try in order
for CANDIDATE in \
  "$HOME/.local/share/com.vercel.cli/auth.json" \
  "$HOME/.config/vercel/auth.json" \
  "$HOME/Library/Application Support/com.vercel.cli/auth.json"
do
  if [[ -z "$VERCEL_TOKEN" && -f "$CANDIDATE" ]]; then
    VERCEL_TOKEN="$(node -e "try{console.log(require(process.argv[1]).token||'')}catch(e){}" "$CANDIDATE" 2>/dev/null || true)"
    [[ -n "$VERCEL_TOKEN" ]] && dim "read from $CANDIDATE"
  fi
done
if [[ -n "$VERCEL_TOKEN" ]]; then
  ok "VERCEL_TOKEN discovered"
else
  warn "no Vercel auth token — deploy hook creation + env push will be skipped"
  dim "run \`vercel login\` then re-run \`npm run setup\`"
fi
hr

# ─────────────────────────────────────────────────────────────
# 3. Vercel deploy hook — reuse or create (idempotent)
#
#    Vercel's POST /v1/projects/{id}/deploy-hooks returns the
#    full project object; the hook lives at link.deployHooks[].
#    We also GET the project first so re-runs reuse the existing
#    gem-agent hook instead of creating duplicates.
# ─────────────────────────────────────────────────────────────
step "Vercel deploy hook"
VERCEL_DEPLOY_HOOK_URL="$(lookup VERCEL_DEPLOY_HOOK_URL)"

# Extract the gem-agent hook URL from a Vercel project JSON blob.
# Matches either top-level `url` / `deployHook.url` or the newest
# entry in `link.deployHooks[]` named gem-agent on branch main.
extract_hook_url() {
  node -e '
    let s="";
    process.stdin.on("data", d => s += d);
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(s);
        if (j.url)               return console.log(j.url);
        if (j.deployHook?.url)   return console.log(j.deployHook.url);
        const hooks = j?.link?.deployHooks || j?.deployHooks || [];
        const match = hooks
          .filter(h => h.name === "gem-agent" && h.ref === "main")
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
        if (match?.url) console.log(match.url);
      } catch (_) {}
    });
  ' 2>/dev/null || true
}

if [[ -n "$VERCEL_TOKEN" && -n "$VERCEL_PROJECT_ID" && -n "$VERCEL_TEAM_ID" ]]; then
  # 3a. Look for an existing gem-agent hook
  PROJECT_JSON="$(curl -sS \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v9/projects/$VERCEL_PROJECT_ID?teamId=$VERCEL_TEAM_ID" \
    2>/dev/null || true)"
  EXISTING_HOOK="$(printf '%s' "$PROJECT_JSON" | extract_hook_url)"

  if [[ -n "$EXISTING_HOOK" ]]; then
    VERCEL_DEPLOY_HOOK_URL="$EXISTING_HOOK"
    ok "reusing existing gem-agent deploy hook"
  else
    dim "creating gem-agent deploy hook on branch main…"
    HOOK_RESPONSE="$(curl -sS \
      -X POST \
      -H "Authorization: Bearer $VERCEL_TOKEN" \
      -H "Content-Type: application/json" \
      "https://api.vercel.com/v1/projects/$VERCEL_PROJECT_ID/deploy-hooks?teamId=$VERCEL_TEAM_ID" \
      -d '{"name":"gem-agent","ref":"main"}' 2>/dev/null || true)"
    HOOK_URL="$(printf '%s' "$HOOK_RESPONSE" | extract_hook_url)"
    if [[ -n "$HOOK_URL" ]]; then
      VERCEL_DEPLOY_HOOK_URL="$HOOK_URL"
      ok "deploy hook created"
    else
      warn "deploy hook creation failed"
      dim "$(printf '%s' "$HOOK_RESPONSE" | head -c 200)"
    fi
  fi
elif [[ -n "$VERCEL_DEPLOY_HOOK_URL" ]]; then
  ok "deploy hook preserved from existing .env.local"
else
  warn "skipped (need VERCEL_TOKEN + linked project)"
fi
[[ -n "$VERCEL_DEPLOY_HOOK_URL" ]] && dim "url: ${VERCEL_DEPLOY_HOOK_URL:0:60}…"
hr

# ─────────────────────────────────────────────────────────────
# 4. GitHub — PAT + default owner via gh CLI
# ─────────────────────────────────────────────────────────────
step "GitHub credentials"
GITHUB_TOKEN="$(lookup GITHUB_TOKEN)"
GITHUB_DEFAULT_OWNER="$(lookup GITHUB_DEFAULT_OWNER)"

if command -v gh >/dev/null 2>&1; then
  if [[ -z "$GITHUB_TOKEN" ]]; then
    GITHUB_TOKEN="$(gh auth token 2>/dev/null || true)"
    [[ -n "$GITHUB_TOKEN" ]] && dim "read from gh auth token"
  fi
  if [[ -z "$GITHUB_DEFAULT_OWNER" ]]; then
    GITHUB_DEFAULT_OWNER="$(gh api user --jq .login 2>/dev/null || true)"
    [[ -n "$GITHUB_DEFAULT_OWNER" ]] && dim "read from gh api user"
  fi
else
  warn "gh CLI not installed — PR flow will be disabled"
fi

if [[ -n "$GITHUB_TOKEN" ]]; then
  ok "GITHUB_TOKEN set (${#GITHUB_TOKEN} chars)"
else
  warn "GITHUB_TOKEN unset — PR creation disabled"
fi
[[ -n "$GITHUB_DEFAULT_OWNER" ]] && ok "GITHUB_DEFAULT_OWNER = $GITHUB_DEFAULT_OWNER" || true
hr

# ─────────────────────────────────────────────────────────────
# 5. GEM agent bearer token — generate once, preserve forever
# ─────────────────────────────────────────────────────────────
step "Agent auth token"
GEM_AGENT_TOKEN="$(lookup GEM_AGENT_TOKEN)"
if [[ -z "$GEM_AGENT_TOKEN" ]]; then
  if command -v openssl >/dev/null 2>&1; then
    GEM_AGENT_TOKEN="$(openssl rand -hex 32)"
    ok "generated new GEM_AGENT_TOKEN (64 hex chars)"
  else
    GEM_AGENT_TOKEN="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
    ok "generated new GEM_AGENT_TOKEN via node:crypto"
  fi
else
  ok "GEM_AGENT_TOKEN preserved from existing .env.local"
fi
hr

# ─────────────────────────────────────────────────────────────
# 6. Write .env.local atomically
# ─────────────────────────────────────────────────────────────
step "Writing .env.local"
TMP_ENV="$(mktemp)"
{
  printf '# ── GEM Agent Builder ─ generated by scripts/setup.sh ──\n'
  printf '# Re-run: npm run setup (safe, idempotent)\n'
  printf '# Date:    %s\n\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

  printf '# Agent model provider: anthropic | openai\n'
  printf 'AGENT_PROVIDER=anthropic\n\n'

  printf '# Claude API\n'
  printf 'ANTHROPIC_API_KEY=%s\n' "$ANTHROPIC_API_KEY"
  printf 'ANTHROPIC_MODEL=%s\n\n' "$ANTHROPIC_MODEL"

  printf '# Vercel Sandbox (OIDC in prod, token fallback locally)\n'
  printf 'VERCEL_TOKEN=%s\n'      "$VERCEL_TOKEN"
  printf 'VERCEL_TEAM_ID=%s\n'    "$VERCEL_TEAM_ID"
  printf 'VERCEL_PROJECT_ID=%s\n\n' "$VERCEL_PROJECT_ID"

  printf '# Deploy hook — triggers production deploy on green build\n'
  printf 'VERCEL_DEPLOY_HOOK_URL=%s\n\n' "$VERCEL_DEPLOY_HOOK_URL"

  printf '# GitHub PR flow\n'
  printf 'GITHUB_TOKEN=%s\n'         "$GITHUB_TOKEN"
  printf 'GITHUB_DEFAULT_OWNER=%s\n\n' "$GITHUB_DEFAULT_OWNER"

  printf '# Bearer token for /api/agent and /api/deploy\n'
  printf 'GEM_AGENT_TOKEN=%s\n' "$GEM_AGENT_TOKEN"
} > "$TMP_ENV"
mv "$TMP_ENV" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "wrote $ENV_FILE (mode 600)"
hr

# ─────────────────────────────────────────────────────────────
# 7. Push every variable to Vercel production env
# ─────────────────────────────────────────────────────────────
push_var() {
  local key="$1" val="$2"
  [[ -z "$val" ]] && { dim "skip $key (empty)"; return; }
  # rm is best-effort (silently fail if not present)
  vercel env rm "$key" production --yes >/dev/null 2>&1 || true
  if printf '%s' "$val" | vercel env add "$key" production >/dev/null 2>&1; then
    ok "pushed $key"
  else
    warn "failed to push $key"
  fi
}

step "Syncing variables to Vercel production"
if command -v vercel >/dev/null 2>&1 && [[ -n "$VERCEL_PROJECT_ID" ]]; then
  push_var AGENT_PROVIDER          "anthropic"
  push_var ANTHROPIC_API_KEY       "$ANTHROPIC_API_KEY"
  push_var ANTHROPIC_MODEL         "$ANTHROPIC_MODEL"
  push_var VERCEL_DEPLOY_HOOK_URL  "$VERCEL_DEPLOY_HOOK_URL"
  push_var GITHUB_TOKEN            "$GITHUB_TOKEN"
  push_var GITHUB_DEFAULT_OWNER    "$GITHUB_DEFAULT_OWNER"
  push_var GEM_AGENT_TOKEN         "$GEM_AGENT_TOKEN"
  # VERCEL_TOKEN / TEAM_ID / PROJECT_ID / OIDC are injected by Vercel at runtime — never push
else
  warn "vercel CLI missing or project not linked — env push skipped"
  dim "install:  npm i -g vercel    link:  vercel link"
fi
hr

# ─────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────
printf '\n%s  Setup complete.%s\n\n' "$C_OK" "$C_RESET"
printf '  Next steps:\n'
printf '    %snpm run dev%s             # local dev server\n' "$C_TEAL" "$C_RESET"
printf '    %svercel --prod%s           # production deploy\n' "$C_TEAL" "$C_RESET"
printf '\n'
