import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookSearch } from '../components/BookSearch';

const books = [
  { id: 1, title: 'Dune', author: 'Frank Herbert', year: 1965 },
  { id: 2, title: 'Emma', author: 'Jane Austen', year: 1815 },
  { id: 3, title: 'Persuasion', author: 'Jane Austen', year: 1817 },
];

describe('hidden: BookSearch', () => {
  it('shows everything at first', () => {
    render(<BookSearch books={books} />);
    expect(screen.getByText('Showing 3 of 3 books')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('filters by title, case-insensitively', async () => {
    render(<BookSearch books={books} />);
    await userEvent.type(screen.getByLabelText('Search books'), 'dUNE');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Showing 1 of 3 books')).toBeInTheDocument();
  });

  it('filters by author and ignores surrounding spaces', async () => {
    render(<BookSearch books={books} />);
    await userEvent.type(screen.getByLabelText('Search books'), '  austen ');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Showing 2 of 3 books')).toBeInTheDocument();
  });

  it('says when nothing matches', async () => {
    render(<BookSearch books={books} />);
    await userEvent.type(screen.getByLabelText('Search books'), 'zzz');
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No books match "zzz".')).toBeInTheDocument();
  });
});
