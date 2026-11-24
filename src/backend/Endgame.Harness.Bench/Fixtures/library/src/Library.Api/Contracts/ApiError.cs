namespace Library.Api.Contracts;

/// <summary>
/// The one error body this API returns. Every 4xx response carries a machine-readable code and a
/// human-readable message. Codes are snake_case.
/// </summary>
public record ApiError(string Code, string Message);
