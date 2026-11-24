set -e
ls src/Library.Api/Migrations/*.cs | grep -v -i initialcreate | grep -v Snapshot | grep -q . || { echo "CHECK FAIL: no new migration"; exit 1; }
