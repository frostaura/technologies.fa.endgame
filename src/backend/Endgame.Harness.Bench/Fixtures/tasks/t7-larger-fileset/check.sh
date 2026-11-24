set -e
grep -rl "api/genres" tests --include=*.cs | grep -v /Hidden/ >/dev/null || { echo "CHECK FAIL: agent added no test for /api/genres"; exit 1; }
