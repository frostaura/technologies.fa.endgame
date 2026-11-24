namespace Endgame.Domain;

/// <summary>An invariant of the domain was violated. The message says which one.</summary>
public sealed class DomainException(string message) : Exception(message);
