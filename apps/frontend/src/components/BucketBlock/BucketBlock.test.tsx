import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { BucketBlock } from './BucketBlock.tsx';
import type { DayZone } from '../../utils/planToWeek.ts';

const zone: DayZone = {
    id: 'b1', start: new Date('2026-07-08T09:00:00'), end: new Date('2026-07-08T13:00:00'),
    color: '#539dad', label: 'Deep Work', persisted: true, typeId: 1,
    topMinutes: 540, heightMinutes: 240,
};

describe('BucketBlock', () => {
    afterEach(cleanup);

    it('positions itself from the zone minutes and shows the label', () => {
        render(<BucketBlock zone={zone} columnHeight={1440} />);
        const block = screen.getByTestId('bucket-zone');
        // 1440px column: 1px per minute -> top 540px, height 240px.
        expect(block).toHaveStyle({ top: '540px', height: '240px' });
        expect(screen.getByText('Deep Work')).toBeInTheDocument();
    });

    it('calls onEdit on a plain click (no drag)', () => {
        const onEdit = vi.fn();
        render(<BucketBlock zone={zone} columnHeight={1440} onEdit={onEdit} />);
        const block = screen.getByTestId('bucket-zone');
        fireEvent.mouseDown(block, { clientY: 100, button: 0 });
        fireEvent.mouseUp(window, { clientY: 100 });
        expect(onEdit).toHaveBeenCalledWith(zone);
    });

    it('commits a move when the body is dragged', () => {
        const onChange = vi.fn();
        render(<BucketBlock zone={zone} columnHeight={1440} onChange={onChange} />);
        const block = screen.getByTestId('bucket-zone');
        // Drag down 60px (=60min at this zoom): 09:00 -> 10:00.
        fireEvent.mouseDown(block, { clientY: 100, button: 0 });
        fireEvent.mouseMove(window, { clientY: 160 });
        fireEvent.mouseUp(window, { clientY: 160 });
        expect(onChange).toHaveBeenCalledWith(zone, 600, 240);
    });

    it('commits a duration change when the bottom handle is dragged', () => {
        const onChange = vi.fn();
        render(<BucketBlock zone={zone} columnHeight={1440} onChange={onChange} />);
        const handle = screen.getByTestId('bucket-resize-bottom');
        // Drag the bottom edge down 60px: duration 240 -> 300.
        fireEvent.mouseDown(handle, { clientY: 780, button: 0 });
        fireEvent.mouseMove(window, { clientY: 840 });
        fireEvent.mouseUp(window, { clientY: 840 });
        expect(onChange).toHaveBeenCalledWith(zone, 540, 300);
    });
});
