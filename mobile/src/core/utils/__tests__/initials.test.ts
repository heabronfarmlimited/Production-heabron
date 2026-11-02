import { initials } from '../format';

/**
 * Initials stand in for a missing or broken image. A cooperative without a
 * logo used to render as an empty coloured circle, so a list of them was a
 * column of identical blanks.
 */
describe('initials', () => {
  it('takes the first letter of the first two words', () => {
    expect(initials('Oju Farmers Cooperative')).toBe('OF');
    expect(initials('Ada Nwosu')).toBe('AN');
  });

  it('handles a single word', () => {
    expect(initials('Heabron')).toBe('H');
  });

  it('ignores extra whitespace', () => {
    expect(initials('  Oju   Farmers  ')).toBe('OF');
  });

  it('is empty for nothing, rather than crashing or printing "undefined"', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(initials(value)).toBe('');
    }
  });

  it('uppercases a lowercase name', () => {
    expect(initials('oju farmers')).toBe('OF');
  });

  it('survives a name of punctuation', () => {
    // Not useful initials, but it must not throw — the name comes from a
    // free-text field an agent typed.
    expect(() => initials('— —')).not.toThrow();
  });
});
