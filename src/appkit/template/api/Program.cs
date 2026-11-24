using App.Data;
using App.Notes;

var builder = WebApplication.CreateBuilder(args);
builder.AddEndgameApp<AppDb>();

var app = builder.Build();
var api = app.UseEndgameApp(); // everything under api/ is mapped on this group
api.MapNotes();
app.Run();

/// <summary>The entry point, visible to the tests' EndgameAppFactory.</summary>
public partial class Program;
