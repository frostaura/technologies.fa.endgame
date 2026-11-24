// Relative to the page's <base>: works under /org/division/project/ and at a subdomain's root.
fetch("api/notes").then((r) => r.json()).then((notes) => {
  document.getElementById("notes").textContent = notes.join(", ");
});
