import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TimeScale } from './TimeScale.tsx';

const labels = () => screen.getAllByTestId('time-scale-label');

describe('TimeScale', () => {
    it('labels every hour on a tall column', () => {
        render(<TimeScale columnHeight={24 * 34} />);
        expect(labels().map(l => l.textContent)).toEqual(
            Array.from({ length: 23 }, (_, i) => `${String(i + 1).padStart(2, '0')}:00`),
        );
    });

    it('labels every fourth hour on a very slim column', () => {
        render(<TimeScale columnHeight={24 * 6.5} />);
        expect(labels().map(l => l.textContent)).toEqual(['04:00', '08:00', '12:00', '16:00', '20:00']);
    });

    it('puts each label on the line of its time', () => {
        render(<TimeScale columnHeight={1440} />); // 1 px per minute
        const noon = labels().find(l => l.textContent === '12:00')!;
        expect(noon).toHaveStyle({ top: '720px' });
    });

    it('is as tall as the day columns', () => {
        render(<TimeScale columnHeight={500} />);
        expect(screen.getByTestId('time-scale')).toHaveStyle({ height: '500px' });
    });
});
