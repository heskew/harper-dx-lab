#!/usr/bin/env bash
set -euo pipefail

# aggregate-findings.sh — Generate a summary dashboard from all review files
#
# Usage: ./aggregate-findings.sh [reviews-dir]
#
# Reads all review markdown files and outputs a summary with:
# - Overall pass rates per tier
# - Timing trends
# - Findings by severity
# - Worker performance leaderboard

REVIEWS_DIR="${1:-$(dirname "$0")/../reviews}"

if [[ ! -d "$REVIEWS_DIR" ]]; then
    echo "Error: Reviews directory not found: $REVIEWS_DIR"
    exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "  DX Lab Dashboard — $(date +%Y-%m-%d)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Count reviews
REVIEW_COUNT=$(ls "$REVIEWS_DIR"/*.md 2>/dev/null | wc -l | tr -d ' ')
echo "Reviews found: $REVIEW_COUNT"
echo ""

# Extract results from each review
echo "── Tier Results ────────────────────────────────────────────"
printf "%-12s %-10s %-12s %-10s %s\n" "Tier" "Iteration" "Pass Rate" "Avg Time" "Key Finding"
printf "%-12s %-10s %-12s %-10s %s\n" "────" "─────────" "─────────" "────────" "───────────"

for review in "$REVIEWS_DIR"/*.md; do
    filename=$(basename "$review")

    # Extract tier number
    tier=$(grep -m1 "| Tier |" "$review" | sed 's/.*| Tier | //' | sed 's/ |.*//' | head -1 || echo "?")

    # Extract iteration
    iteration=$(grep -m1 "| Expert Iteration |" "$review" | sed 's/.*| Expert Iteration | //' | sed 's/ |.*//' | head -1 || echo "0")

    # Extract result line
    result=$(grep -m1 "^## Result:" "$review" | sed 's/## Result: //' || echo "?")

    # Extract average time from worker table (look for ~NNm or ~NN min patterns)
    times=$(grep -oE '~[0-9]+ min' "$review" | grep -oE '[0-9]+' || true)
    if [[ -n "$times" ]]; then
        count=0
        total=0
        for t in $times; do
            total=$((total + t))
            count=$((count + 1))
        done
        if [[ $count -gt 0 ]]; then
            avg=$((total / count))
            avg_time="~${avg} min"
        else
            avg_time="?"
        fi
    else
        avg_time="?"
    fi

    # Truncate tier description for display
    tier_short=$(echo "$tier" | head -c 30)

    printf "%-12s %-10s %-12s %-10s\n" "$tier_short" "$iteration" "$result" "$avg_time"
done

echo ""

# Aggregate pass/fail counts
echo "── Overall Stats ───────────────────────────────────────────"
total_pass=0
total_fail=0
total_lost=0

for review in "$REVIEWS_DIR"/*.md; do
    # Count PASS/FAIL in worker tables
    passes=$(grep -c "| PASS" "$review" 2>/dev/null || echo 0)
    fails=$(grep -c "| \*\*FAIL\*\*\|| FAIL" "$review" 2>/dev/null || echo 0)
    lost=$(grep -c "| \*\*LOST\*\*\|| LOST" "$review" 2>/dev/null || echo 0)
    total_pass=$((total_pass + passes))
    total_fail=$((total_fail + fails))
    total_lost=$((total_lost + lost))
done

total=$((total_pass + total_fail + total_lost))
if [[ $total -gt 0 ]]; then
    pass_pct=$((total_pass * 100 / total))
else
    pass_pct=0
fi

echo "Total workers:  $total"
echo "Passed:         $total_pass ($pass_pct%)"
echo "Failed:         $total_fail"
echo "Lost:           $total_lost"
echo ""

# List all doc gaps found
echo "── Findings ────────────────────────────────────────────────"
echo ""
echo "Searching reviews for documented gaps and issues..."
echo ""

for review in "$REVIEWS_DIR"/*.md; do
    filename=$(basename "$review" .md)
    gaps=$(grep -c "doc.gap\|Doc Gap\|documentation gap\|doc_gap\|platform.limitation\|Platform Limitation" "$review" 2>/dev/null || echo 0)
    if [[ "$gaps" -gt 0 ]]; then
        echo "  $filename: $gaps findings referenced"
    fi
done

echo ""
echo "── Review Files ────────────────────────────────────────────"
for review in "$REVIEWS_DIR"/*.md; do
    filename=$(basename "$review")
    lines=$(wc -l < "$review" | tr -d ' ')
    echo "  $filename ($lines lines)"
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Full findings report: findings/dx-lab-findings-*.md"
echo "═══════════════════════════════════════════════════════════"
