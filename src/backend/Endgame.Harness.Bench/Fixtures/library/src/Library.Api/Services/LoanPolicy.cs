namespace Library.Api.Services;

/// <summary>Library lending rules, bound from the "LoanPolicy" configuration section.</summary>
public class LoanPolicy
{
    public const string Section = "LoanPolicy";

    /// <summary>How many days a borrowed book may be kept.</summary>
    public int LoanDays { get; set; } = 7;
}
