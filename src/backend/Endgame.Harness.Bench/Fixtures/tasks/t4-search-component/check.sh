set -e
grep -q "BookSearch" web/src/App.tsx || { echo "CHECK FAIL: App does not use BookSearch"; exit 1; }
grep -rl "BookSearch" web/src --include=*.test.tsx | grep -v __hidden__ >/dev/null || { echo "CHECK FAIL: agent added no BookSearch test"; exit 1; }
