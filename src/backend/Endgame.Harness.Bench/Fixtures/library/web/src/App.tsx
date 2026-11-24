import { useEffect, useState } from 'react';
import { listBooks } from './api';
import { BookList } from './components/BookList';
import type { Book } from './types';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; books: Book[] };

export default function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    listBooks()
      .then((page) => setState({ status: 'ready', books: page.items }))
      .catch((e: Error) => setState({ status: 'error', message: e.message }));
  }, []);

  return (
    <main>
      <h1>Library</h1>
      {state.status === 'loading' && <p>Loading…</p>}
      {state.status === 'error' && <p role="alert">{state.message}</p>}
      {state.status === 'ready' && <BookList books={state.books} />}
    </main>
  );
}
