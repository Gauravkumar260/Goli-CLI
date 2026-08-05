# Goli-CLI Themes

Goli-CLI ships with **20 built-in themes** (skins) plus a special
`no-color` accessibility theme and full support for user-defined YAML
skins. Themes control colors, box border styles, and the prompt character
across the entire TUI.

All themes **hot-reload live** — switching with `/theme` or
`GOLI_SKIN` applies immediately with no restart.

## Selecting a theme

There are four ways to pick a theme:

```bash
# 1. Environment variable — persists across launches
GOLI_SKIN=dracula npm run goli -- wakeup

# 2. CLI flag (one-shot, overrides GOLI_SKIN)
npm run goli -- --skin nord wakeup

# 3. Inside the TUI: /theme opens the ThemeDialog overlay
#    ↑/↓ navigate · Enter selects · Esc dismisses
/theme

# 4. Direct /theme <name> command (applies instantly)
/theme dracula

# From the shell: list / inspect themes
npm run goli -- skin list
npm run goli -- skin show monokai
```

### `GOLI_SKIN` for persistence

`/theme` switches the theme **live** for the current session, but the
choice is lost on exit. To make a theme persistent across launches, set
`GOLI_SKIN` in your `.env` or shell profile:

```bash
# .env (or ~/.bashrc / ~/.zshrc)
GOLI_SKIN=dracula
```

The `/theme` dialog reminds you of this with a hint at the bottom:
_"Set GOLI_SKIN=<name> to persist."_

### Resolution order

When the TUI launches, the active skin is resolved in this order:

1. `--skin <name>` CLI flag
2. `GOLI_SKIN` env var
3. `NO_COLOR` env var (any value) → forces `no-color` skin
4. `default` (Tokyo Night Dark)

## Built-in themes (20)

The 20 built-in themes are defined as constants in
`packages/cli/src/tui/theme/skin-engine.ts` and exported via
`BUILTIN_SKIN_NAMES`.

### Dark themes (12)

| Name                    | Foreground | Background | Style            | Description                                      |
| ----------------------- | ---------- | ---------- | ---------------- | ------------------------------------------------ |
| `default`               | `#c0caf5`  | `#1a1b26`  | Tokyo Night Dark | The standard Goli-CLI palette                    |
| `dark`                  | `#e6e6e6`  | `#1e1e1e`  | Dark Warm        | A warmer alternative dark palette                |
| `high-contrast`         | `#ffffff`  | `#000000`  | WCAG AAA         | Black background + white text + bright accents   |
| `dracula`               | `#f8f8f2`  | `#282a36`  | Dracula          | Classic dark theme with pink/purple/cyan accents |
| `solarized-dark`        | `#93a1a1`  | `#002b36`  | Solarized Dark   | Ethan Schoonover's precision palette             |
| `github-dark`           | `#c9d1d9`  | `#0d1117`  | GitHub Dark      | Official Primer dark palette                     |
| `atom-one-dark`         | `#abb2bf`  | `#282c34`  | Atom One Dark    | The default Atom editor dark theme               |
| `nord`                  | `#d8dee9`  | `#2e3440`  | Nord             | Arctic north-bluish palette                      |
| `monokai`               | `#f8f8f2`  | `#272822`  | Monokai          | The classic text-editor color scheme             |
| `ayu-dark`              | `#aeaca6`  | `#0b0e14`  | Ayu Dark         | Soft warm dark palette with pastel accents       |
| `shades-of-purple-dark` | `#e3dfff`  | `#1e1e3f`  | Shades of Purple | Vibrant purple-heavy dark theme                  |
| `holiday-dark`          | `#f0f8ff`  | `#00210e`  | Holiday Dark     | Festive green-and-red holiday theme              |

### Light themes (5)

| Name               | Foreground | Background | Style            | Description                              |
| ------------------ | ---------- | ---------- | ---------------- | ---------------------------------------- |
| `solarized-light`  | `#586e75`  | `#fdf6e3`  | Solarized Light  | Warm cream background with muted accents |
| `github-light`     | `#1f2328`  | `#ffffff`  | GitHub Light     | Official Primer light palette            |
| `ayu-light`        | `#5c6166`  | `#f8f9fa`  | Ayu Light        | Warm light palette with muted accents    |
| `googlecode-light` | `#444444`  | `#ffffff`  | Googlecode Light | Minimal light theme with high contrast   |
| `xcode-light`      | `#444444`  | `#ffffff`  | Xcode Light      | Classic Mac IDE light theme              |

> `ansi-light` is intentionally excluded from this table — it belongs
> to the ANSI themes family below (uses the terminal's native 16-color
> palette rather than truecolor RGB values).

### ANSI themes (2)

The two ANSI themes use only the terminal's native 16-color palette, so
they work on any terminal (including those without truecolor support).
They are also the recommended choice for `NO_COLOR` environments and
for users who want to inherit the terminal emulator's color scheme
rather than override it.

| Name         | Foreground | Background | Description                                      |
| ------------ | ---------- | ---------- | ------------------------------------------------ |
| `ansi-dark`  | `#ffffff`  | `#000000`  | Uses the terminal's native 16-color ANSI palette |
| `ansi-light` | `#000000`  | `#ffffff`  | Native ANSI palette on light background          |

> **Note on theme count:** Some docs reference "21 built-in themes"
> (which counts `ansi-light` twice — once under Light themes and once
> under ANSI themes). The canonical count is **20 built-in themes + 1
> special `no-color` accessibility theme**. The two ANSI themes are
> listed in their own section above and are not double-counted in the
> Light themes total.

### Colorblind-accessible themes (2)

| Name                      | Foreground | Background | Description                                                              |
| ------------------------- | ---------- | ---------- | ------------------------------------------------------------------------ |
| `github-dark-colorblind`  | `#e6edf3`  | `#0d1117`  | GitHub's dark theme optimized for colorblind users (blue/orange accents) |
| `github-light-colorblind` | `#1f2328`  | `#ffffff`  | GitHub's light theme optimized for colorblind users                      |

### `no-color` (special accessibility theme)

Beyond the 20 built-ins, a 21st entry — `no-color` — is available via
`/theme no-color` or by setting the `NO_COLOR` environment variable. It
empties every color token so Ink falls back to the terminal's default
foreground, satisfying the [NO_COLOR convention](https://no-color.org/).
It is hidden from the default `skin list` output but appears in the
`ThemeDialog` for discoverability.

## Live hot-reload (no restart needed)

Switching themes with `/theme`, `/theme <name>`, or the `ThemeDialog`
overlay applies the new palette **immediately** — there is no restart,
no flicker, no broken render. This is implemented by three pieces working
together:

1. **Mutable token map** (`packages/cli/src/tui/theme/tokens.ts`):
   the exported `T` object is mutated in place by `applySkinToTokens()`
   so every component that reads `T.red` / `T.blue` / etc. on render
   picks up the new colors automatically.

2. **Version counter** (`themeVersionCounter` in `tokens.ts`): each
   `applySkinToTokens()` call increments the counter and notifies all
   subscribers.

3. **`useThemeVersion()` hook** (`packages/cli/src/tui/hooks/useThemeVersion.ts`):
   the top-level `App` component subscribes; the counter bump triggers
   a re-render that propagates the new `T` values down the tree.

`applySkinToTokens()` also writes the new border style to the mutable
`B.borderStyle` token (see [Border styles](#border-styles) below), so
borders switch in the same render pass as colors.

## The `/theme` command and `ThemeDialog` overlay

Typing `/theme` (no argument) inside the TUI opens the `ThemeDialog`
overlay (`packages/cli/src/tui/components/dialogs/ThemeDialog.tsx`):

```
┌─ Themes (21) ─────────────────────────────────────────┐
│ ▶ default            (active)                          │
│   dark                                                │
│   high-contrast                                       │
│   dracula                                             │
│   …                                                   │
│   no-color                                            │
│                                                       │
│ Selected: default (current)                           │
│ ↑↓ navigate · Enter select · Esc dismiss              │
│ (Takes effect on next launch. Set GOLI_SKIN=default   │
│  to persist.)                                         │
└───────────────────────────────────────────────────────┘
```

- **↑/↓** navigate
- **Enter** applies the highlighted theme live (calls
  `applySkinToTokens()` and pushes a system message confirming the
  switch)
- **Esc** dismisses without changing

A direct `/theme <name>` command (e.g. `/theme nord`) skips the dialog
and applies the theme immediately.

## Border styles

Each skin carries a `borderStyle` field that controls the look of every
`<Box borderStyle={...}>` in the TUI — splash, header, dialogs, message
bubbles, queued-messages tray, etc. The seven supported styles map
directly to [Ink's box border styles](https://github.com/vadimdemedes/ink#borders):

| Style          | Look (top edge) | Notes                             |
| -------------- | --------------- | --------------------------------- |
| `single`       | `─────`         | Default for most editor themes    |
| `double`       | `═════`         | Heavy double-line border          |
| `round`        | `╭─────`        | Default for Tokyo Night / Dracula |
| `bold`         | `━━━━━`         | Used by `high-contrast`           |
| `singleDouble` | `╓═════`        | Single top, double sides          |
| `classic`      | `┌─────`        | Sharp ASCII corners               |
| `arrow`        | `▼─────`        | Arrow-notch top-left corner       |

Border styles are **applied live** alongside colors. The mutable `B`
token in `tokens.ts` holds the active style; components should call
`getBorderStyle()` rather than hardcoding `'round'`.

## Color tokens

Each skin defines 10 color tokens (the keys of the `T` map):

| Token    | Usage                                   |
| -------- | --------------------------------------- |
| `fg`     | Foreground text (body)                  |
| `blue`   | Blue accent (links, info)               |
| `green`  | Green accent (success, user messages)   |
| `red`    | Red accent (errors, failures)           |
| `yellow` | Yellow accent (warnings)                |
| `purple` | Purple accent (headings, tools)         |
| `teal`   | Teal accent (active suggestions, lists) |
| `gray`   | Gray (dim labels, secondary text)       |
| `border` | Box borders, separators                 |
| `orange` | Orange accent (highlights)              |

## User-defined skins

Create a YAML file in `~/.goli/skins/<name>.yaml`:

```yaml
name: my-skin
description: My custom skin
colors:
  fg: "#e0e0e0"
  blue: "#5fafff"
  green: "#7fdf7f"
  red: "#ff7f7f"
  yellow: "#ffff7f"
  purple: "#ff7fff"
  teal: "#7fffff"
  gray: "#808080"
  border: "#404040"
  orange: "#ffaf7f"
borderStyle: round # single|double|round|bold|singleDouble|classic|arrow
promptStyle: ">" # the prompt character
```

Then select it:

```bash
GOLI_SKIN=my-skin npm run goli -- wakeup
# or
npm run goli -- --skin my-skin wakeup
# or inside the TUI
/theme my-skin
```

User skins are auto-discovered — `goli skin list` and the `ThemeDialog`
both scan `~/.goli/skins/*.yaml` on every invocation.

### Minimal YAML parser

The skin engine includes a minimal YAML parser (no external dependency).
It supports:

- `key: value` (string, with optional quotes)
- Nested maps under `colors:`
- Comments (`#` at line start or preceded by whitespace, but **not**
  inside hex color values like `#ffffff`)

It does **not** support: arrays, multiline strings, anchors, flow style.
For anything fancier, drop a `.json` file with the same shape — the
loader accepts both formats.

## `NO_COLOR` for accessibility

Setting the standard `NO_COLOR` environment variable (any value, per the
[no-color.org convention](https://no-color.org/)) activates the
`no-color` skin, which empties every color token so the TUI renders in
the terminal's default foreground/background. This is the simplest way
to maximize compatibility with screen readers, monochrome terminals,
and accessibility-conscious setups.

```bash
NO_COLOR=1 npm run goli -- wakeup
```

`NO_COLOR` also implicitly enables the TUI's screen-reader layout
(`ScreenReaderAppLayout`) — a linear, decoration-free layout with no
box-drawing characters or animations.

## Color downsampling (`resolveColor`)

Not every terminal speaks 24-bit truecolor. The `resolveColor()` helper
in `tokens.ts` downsamples each hex color to whatever the active
terminal can render, so themes look correct everywhere:

| Terminal capability | Behavior                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Truecolor (24-bit)  | Returns the hex unchanged — zero visual difference.                                          |
| 256-color           | Maps to the nearest xterm-256 cube entry via a precomputed lookup table (`HEX_TO_XTERM256`). |
| 16-color            | Maps to the nearest ANSI base color name (`red`, `green`, `blue`, …) via `HEX_TO_ANSI16`.    |
| Dumb / no color     | Falls back to the original hex; the terminal does its own match.                             |

Terminal capability is detected once at startup by
`detectCapabilities()` in `packages/cli/src/tui/lib/capabilities.ts`
and cached for the process lifetime. The detection logic inspects
`$COLORTERM`, `$TERM`, `$TERM_PROGRAM`, and a handful of known
terminal-specific env vars to decide between truecolor / 256 / 16.

The precomputed maps are tuned for the Tokyo Night palette but work
well for every built-in theme — the warm/cool separation between
blue/teal/green and the warning hue of yellow/orange/red is preserved.

## WCAG AA compliance

All 20 built-in themes pass WCAG 2.1 AA for foreground text (≥4.5:1
contrast on the intended background). The `high-contrast` theme passes
AAA (≥7:1).

Accent colors meet AA Large (≥3:1) where possible. Some editor themes
(Dracula, Monokai, Nord, Solarized) have a few low-contrast accents by
original design — these are documented in the individual skin
definitions. See `docs/a11y-report.md` for the full audit.

## See also

- [Getting Started](../getting-started.md) — install, configure, first run.
- [TUI Architecture](../tui/architecture.md) — component tree, performance,
  state management.
- [A11y Report](../a11y-report.md) — full accessibility audit.
