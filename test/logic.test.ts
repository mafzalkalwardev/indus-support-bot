import { expect, it } from 'vitest';
import { answerFromDocs } from '../src/logic';

it('notices when the question is outside the docs', () => {
  expect(answerFromDocs('How does verification work?', 'SMTP verification of lists').grounded).toBe(true);
  expect(answerFromDocs('What is the weather?', 'SMTP verification of lists').grounded).toBe(false);
});
