import { buildInstructions } from '../prompts';

describe('buildInstructions', () => {
  const now = new Date(2026, 9, 21, 8, 30);

  it('includes the local date and nutrition tracking rules', () => {
    const prompt = buildInstructions({ hasHealthContext: false, now });

    expect(prompt).toContain('Today is 2026-10-21');
    expect(prompt).toContain('Nutrition estimate');
    expect(prompt).toContain('Day total');
    expect(prompt).toContain('calories (kcal)');
    expect(prompt).toContain('protein (g)');
    expect(prompt).toContain('carbohydrate (g)');
    expect(prompt).toContain('fat (g)');
    expect(prompt).toContain('every food the user has reported');
  });

  it('covers weight-loss, weight-gain, and maintenance meal plans', () => {
    const prompt = buildInstructions({ hasHealthContext: false, now });

    expect(prompt).toContain('weight loss');
    expect(prompt).toContain('calorie deficit');
    expect(prompt).toContain('weight gain');
    expect(prompt).toContain('calorie surplus');
    expect(prompt).toContain('maintenance');
    expect(prompt).toContain('balanced intake');
  });

  it('does not assume health data when sharing is off', () => {
    const prompt = buildInstructions({ hasHealthContext: false, now });

    expect(prompt).toContain('No health data has been shared');
    expect(prompt).not.toContain('Treat that summary as the ground truth');
  });

  it('uses the shared-data rules when health context is present', () => {
    const prompt = buildInstructions({ hasHealthContext: true, now });

    expect(prompt).toContain('Treat that summary as the ground truth');
    expect(prompt).not.toContain('No health data has been shared');
  });
});
