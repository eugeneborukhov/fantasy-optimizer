import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the tables', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /names table/i })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /optimal lineup/i })).toBeInTheDocument();
});
