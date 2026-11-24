set -e
test -f src/Library.Api/Endpoints/BookEndpoints.cs || { echo "CHECK FAIL: Endpoints/BookEndpoints.cs missing"; exit 1; }
if grep -nE "\.Map(Get|Post|Put|Delete|Patch|Methods|Group)\(" src/Library.Api/Program.cs; then echo "CHECK FAIL: Program.cs still registers endpoints"; exit 1; fi
grep -q "MapBookEndpoints()" src/Library.Api/Program.cs || { echo "CHECK FAIL: Program.cs does not call MapBookEndpoints()"; exit 1; }
grep -q 'MapGroup("/api/books")' src/Library.Api/Endpoints/BookEndpoints.cs || { echo "CHECK FAIL: no /api/books route group"; exit 1; }
