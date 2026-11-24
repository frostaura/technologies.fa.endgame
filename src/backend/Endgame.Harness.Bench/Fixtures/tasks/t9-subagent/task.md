`src/Library.Api/Legacy/` holds thirty handler classes kept from the old v1 service. Some of them are obsolete (marked with `[Obsolete]`); each class names the route it served in its `Route` constant.

Add `GET /api/deprecated-routes`, returning the routes of the obsolete handlers only, as a JSON array of strings sorted in ordinal order. Do not change the legacy classes.

This is a survey of many files: hand the survey to a sub-agent with `spawn` (read-only tools are enough for it) and build the endpoint from its report, so your own context stays small. Add an xUnit test for the endpoint. All tests must pass.
