import { render, screen } from '@testing-library/react';
import App from './App';

test('renders next session button', () => {
  render(<App />);
  const buttonElement = screen.getByText(/next session/i);
  expect(buttonElement).toBeInTheDocument();
});
