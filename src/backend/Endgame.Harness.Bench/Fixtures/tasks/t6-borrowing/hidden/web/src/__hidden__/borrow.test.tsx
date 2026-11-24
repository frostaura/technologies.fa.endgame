import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1 });
const dune = { id: 1, title: 'Dune', author: 'Frank Herbert', year: 1965, isAvailable: true, dueDate: null };
const emma = { id: 2, title: 'Emma', author: 'Jane Austen', year: 1815, isAvailable: false, dueDate: '2030-01-05' };

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

describe('hidden: borrowing in the UI', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('borrows and returns through the API', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push(`${method} ${url}`);
      if (method === 'GET' && url.startsWith('/api/books')) return json(page([dune, emma]));
      if (method === 'POST' && url === '/api/books/1/borrow') return json({ ...dune, isAvailable: false, dueDate: '2030-02-01' });
      if (method === 'POST' && url === '/api/books/2/return') return json({ ...emma, isAvailable: true, dueDate: null });
      return json({ code: 'unexpected', message: url }, 500);
    }));

    render(<App />);
    const duneItem = (await screen.findByText('Dune')).closest('li')!;
    const emmaItem = screen.getByText('Emma').closest('li')!;
    expect(within(duneItem).getAllByText(/Available/).length).toBeGreaterThan(0);
    expect(within(emmaItem).getAllByText(/On loan until 2030-01-05/).length).toBeGreaterThan(0);

    await userEvent.click(within(duneItem).getByRole('button', { name: 'Borrow' }));
    expect((await within(duneItem).findAllByText(/On loan until 2030-02-01/)).length).toBeGreaterThan(0);
    expect(within(duneItem).getByRole('button', { name: 'Return' })).toBeInTheDocument();

    await userEvent.click(within(emmaItem).getByRole('button', { name: 'Return' }));
    expect((await within(emmaItem).findAllByText(/Available/)).length).toBeGreaterThan(0);
    expect(within(emmaItem).getByRole('button', { name: 'Borrow' })).toBeInTheDocument();

    expect(calls).toContain('POST /api/books/1/borrow');
    expect(calls).toContain('POST /api/books/2/return');
  });
});
