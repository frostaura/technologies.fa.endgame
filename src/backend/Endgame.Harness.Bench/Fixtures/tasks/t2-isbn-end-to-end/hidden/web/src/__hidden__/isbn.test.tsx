import { render, screen } from '@testing-library/react';
import { BookList } from '../components/BookList';

const books = [
  { id: 1, title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: '978-0441013593' },
  { id: 2, title: 'Emma', author: 'Jane Austen', year: 1815, isbn: null },
];

describe('hidden: isbn in BookList', () => {
  it('shows the ISBN only for books that have one', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<BookList books={books as any} />);
    expect(screen.getByText(/ISBN: 978-0441013593/)).toBeInTheDocument();
    expect(screen.getAllByText(/ISBN/)).toHaveLength(1);
  });
});
