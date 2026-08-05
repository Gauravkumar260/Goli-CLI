# Goli-CLI Accessibility Audit Report

Generated: 2026-07-06T18:39:49.303Z
Last reviewed: 2026-07-13 (regenerate with `npm run a11y:audit` for current numbers)

## Scope

This audit covers the **default Tokyo Night Dark theme only**. The 19
other built-in themes (`dark`, `high-contrast`, `dracula`, `solarized-dark`,
`solarized-light`, `github-dark`, `github-light`, `atom-one-dark`, `nord`,
`monokai`, `ayu-dark`, `ayu-light`, `googlecode-light`, `xcode-light`,
`shades-of-purple-dark`, `holiday-dark`, `ansi-dark`, `ansi-light`,
`github-dark-colorblind`, `github-light-colorblind`) are NOT covered —
they should be re-audited before any "all themes pass WCAG AA" claim is
made in marketing copy.

## Summary

- **Color tokens audited:** 10
- **Contrast pairs tested:** 20 (each token vs black + white terminal backgrounds)
- **WCAG 2.1 AA (>= 4.5:1, normal text):** 12 pass, 8 fail
- **WCAG 2.1 AA Large (>= 3:1, large text):** 12 pass, 8 fail
- **Component files with issues:** 0

## Color Contrast Results

| Foreground                    | Background                  | Ratio   | AA (4.5:1) | AA Large (3:1) |
| ----------------------------- | --------------------------- | ------- | ---------- | -------------- |
| fg (#c0caf5) [normal]         | terminal-bg (#000000)       | 13.01:1 | ✅ PASS    | ✅ PASS        |
| fg (#c0caf5) [normal]         | terminal-bg-white (#ffffff) | 1.61:1  | ❌ FAIL    | ❌ FAIL        |
| blue (#7aa2f7) [normal]       | terminal-bg (#000000)       | 8.34:1  | ✅ PASS    | ✅ PASS        |
| blue (#7aa2f7) [normal]       | terminal-bg-white (#ffffff) | 2.52:1  | ❌ FAIL    | ❌ FAIL        |
| green (#9ece6a) [normal]      | terminal-bg (#000000)       | 11.49:1 | ✅ PASS    | ✅ PASS        |
| green (#9ece6a) [normal]      | terminal-bg-white (#ffffff) | 1.83:1  | ❌ FAIL    | ❌ FAIL        |
| red (#f7768e) [normal]        | terminal-bg (#000000)       | 7.94:1  | ✅ PASS    | ✅ PASS        |
| red (#f7768e) [normal]        | terminal-bg-white (#ffffff) | 2.65:1  | ❌ FAIL    | ❌ FAIL        |
| yellow (#e0af68) [normal]     | terminal-bg (#000000)       | 10.50:1 | ✅ PASS    | ✅ PASS        |
| yellow (#e0af68) [normal]     | terminal-bg-white (#ffffff) | 2.00:1  | ❌ FAIL    | ❌ FAIL        |
| purple (#bb9af7) [normal]     | terminal-bg (#000000)       | 9.08:1  | ✅ PASS    | ✅ PASS        |
| purple (#bb9af7) [normal]     | terminal-bg-white (#ffffff) | 2.31:1  | ❌ FAIL    | ❌ FAIL        |
| teal (#73daca) [normal]       | terminal-bg (#000000)       | 12.61:1 | ✅ PASS    | ✅ PASS        |
| teal (#73daca) [normal]       | terminal-bg-white (#ffffff) | 1.67:1  | ❌ FAIL    | ❌ FAIL        |
| gray (#565f89) [large]        | terminal-bg (#000000)       | 3.39:1  | ✅ PASS    | ✅ PASS        |
| gray (#565f89) [large]        | terminal-bg-white (#ffffff) | 6.19:1  | ✅ PASS    | ✅ PASS        |
| border (#414868) [decorative] | terminal-bg (#000000)       | 2.35:1  | ✅ PASS    | ✅ PASS        |
| border (#414868) [decorative] | terminal-bg-white (#ffffff) | 8.93:1  | ✅ PASS    | ✅ PASS        |
| orange (#ff9e64) [normal]     | terminal-bg (#000000)       | 10.33:1 | ✅ PASS    | ✅ PASS        |
| orange (#ff9e64) [normal]     | terminal-bg-white (#ffffff) | 2.03:1  | ❌ FAIL    | ❌ FAIL        |

## Component Audit

✅ No component-level accessibility issues found.

## Notes

- **WCAG 2.1 AA** requires >= 4.5:1 contrast for normal text, >= 3:1 for large text (>= 18pt or 14pt bold).
- **Terminal background assumptions:** we test against pure black (#000000) and pure white (#ffffff). Real terminals may use a wider variety of background colors; the tokens use the Tokyo Night Dark palette which is designed for dark terminals.
- **Ink/React for terminals** does not have a full accessibility tree like web React. Screen-reader compatibility depends on the terminal emulator. We audit:
  - Color contrast (above)
  - Hard-coded color strings that bypass the theme tokens (component audit)
  - Icon-only labels without text fallback (planned; not yet implemented in this audit)

## Recommendations

- Review the following tokens for AA compliance on white backgrounds: fg, blue, green, red, yellow, purple, teal, orange. (Note: most TUI apps target dark terminals; failure on white background is informational.)
