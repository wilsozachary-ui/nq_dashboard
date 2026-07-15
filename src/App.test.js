import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the primary Topstep workspace tab', () => {
  render(<App />);
  expect(screen.getByRole('tab', { name: /topstep/i })).toBeInTheDocument();
});
