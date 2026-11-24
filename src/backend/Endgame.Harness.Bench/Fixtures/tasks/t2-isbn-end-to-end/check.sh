set -e
ls src/Library.Api/Migrations/*.cs | grep -v -i initialcreate | grep -v Snapshot | xargs grep -l -i isbn >/dev/null || { echo "CHECK FAIL: no new migration mentions Isbn"; exit 1; }
