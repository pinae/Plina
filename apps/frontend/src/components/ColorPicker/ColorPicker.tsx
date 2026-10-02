import { Box, Button, ButtonBase, FormControl, FormHelperText, FormLabel } from '@mui/material';

import { TASK_COLOR_PALETTE } from '../../utils/taskColors.ts';

interface TaskColorPickerProps {
    /** The chosen color; null = none (inherit, or automatic for a project). */
    value: string | null;
    /** What the task shows without a chosen color; null = not known yet (a
     *  new project gets its automatic color when saved). */
    inheritedColor: string | null;
    /** Projects (top-level tasks) get an automatic color instead of inheriting. */
    topLevel: boolean;
    onChange: (color: string | null) => void;
}

const SIZE = 24;

/** A round color sample; dashed and empty while the color is not known. */
function Swatch({ color, testId }: { color: string | null; testId?: string }) {
    return (
        <Box
            component="span" aria-hidden data-testid={testId}
            style={color ? { backgroundColor: color } : undefined}
            sx={{
                display: 'inline-block', width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: color ? 'none' : '1px dashed currentColor',
            }}
        />
    );
}

/**
 * The task's color (§4.4): "From parent" (a project: "Automatic"), a palette
 * of swatches that keep white text readable, or any custom color.
 */
export function TaskColorPicker({ value, inheritedColor, topLevel, onChange }: TaskColorPickerProps) {
    const custom = value !== null && !TASK_COLOR_PALETTE.some(swatch => swatch.hex === value);
    const helper = value !== null ? 'Subtasks without a color of their own show it too.'
        : !topLevel ? 'Same as its parent.'
            : inheritedColor ? 'A color unlike the other projects’, picked automatically.'
                : 'A color unlike the other projects’ is picked when you save.';
    return (
        <FormControl component="fieldset">
            <FormLabel component="legend" sx={{ mb: 1 }}>Color</FormLabel>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                <Button
                    size="small" aria-pressed={value === null}
                    variant={value === null ? 'contained' : 'outlined'}
                    startIcon={<Swatch color={inheritedColor} testId="inherited-swatch" />}
                    onClick={() => onChange(null)}
                >
                    {topLevel ? 'Automatic' : 'From parent'}
                </Button>
                {TASK_COLOR_PALETTE.map(({ name, hex }) => (
                    <ButtonBase
                        key={hex} aria-label={name} title={name} aria-pressed={value === hex}
                        onClick={() => onChange(hex)}
                        style={{ backgroundColor: hex }}
                        sx={{
                            width: SIZE, height: SIZE, borderRadius: '50%',
                            outline: value === hex ? '2px solid' : 'none', outlineColor: 'text.primary', outlineOffset: 2,
                            '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
                        }}
                    />
                ))}
                {/* A label around the native picker: clicking it opens the
                    browser's color dialog. */}
                <Button
                    component="label" size="small" variant={custom ? 'contained' : 'outlined'}
                    startIcon={custom ? <Swatch color={value} testId="custom-swatch" /> : undefined}
                >
                    Custom…
                    <Box
                        component="input" type="color" aria-label="Custom color"
                        value={value ?? inheritedColor ?? '#539dad'}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
                        sx={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', p: 0, border: 0 }}
                    />
                </Button>
            </Box>
            <FormHelperText>{helper}</FormHelperText>
        </FormControl>
    );
}
