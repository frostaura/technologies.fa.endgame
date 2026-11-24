import { render, screen } from '@testing-library/react';
import { BookList } from './BookList';

const books = [
  { id: 1, title: 'Dune', author: 'Frank Herbert', year: 1965 },
  { id: 2, title: 'Emma', author: 'Jane Austen', year: 1815 },
];

describe('BookList', () => {
  it('renders every book', () => {
    render(<BookList books={books} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Dune')).toBeInTheDocument();
  });

  it('shows an empty state', () => {
    render(<BookList books={[]} />);
    expect(screen.getByText('No books yet.')).toBeInTheDocument();
  });
});
