using System.Collections.Concurrent;
using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;

namespace Endgame.Edge;

/// <summary>A data-protection key ring that lives and dies with the process.</summary>
internal sealed class InMemoryXmlRepository : IXmlRepository
{
    private readonly ConcurrentQueue<XElement> elements = new();

    public IReadOnlyCollection<XElement> GetAllElements() => elements.Select(e => new XElement(e)).ToList();

    public void StoreElement(XElement element, string friendlyName) => elements.Enqueue(new XElement(element));
}
