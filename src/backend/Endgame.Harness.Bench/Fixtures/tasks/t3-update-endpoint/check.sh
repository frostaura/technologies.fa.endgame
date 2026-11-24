set -e
grep -rlE "PutAsJsonAsync|HttpMethod\.Put|PutAsync" tests --include=*.cs | grep -v /Hidden/ >/dev/null || { echo "CHECK FAIL: agent added no test that calls PUT"; exit 1; }
