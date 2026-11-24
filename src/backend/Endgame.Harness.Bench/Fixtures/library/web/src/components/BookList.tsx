import type { Book } from '../types';

interface BookListProps {
  books: Book[];
}

export function BookList({ books }: BookListProps) {
  if (books.length === 0) {
    return <p>No books yet.</p>;
  }
  return (
    <ul aria-label="Books">
      {books.map((book) => (
        <li key={book.id}>
          <strong>{book.title}</strong> — {book.author} ({book.year})
        </li>
      ))}
    </ul>
  );
}
