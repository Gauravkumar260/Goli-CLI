/**
 * components/dialogs/AboutDialog.tsx — About / version info dialog (T-058).
 *
 * Reference: gemini-cli's `AboutBox.tsx`. Shows version, license, homepage,
 * and a brief description. Dismissed by Esc or Enter.
 *
 * @module tui/components/dialogs/AboutDialog
 */
import React from 'react';
import { Box, Text } from 'ink';
import { T } from '../../theme/tokens.js';

interface Props {
  cols: number;
  onDismiss: () => void;
}

/** Version constant (mirrors package.json). */
// P3-30 fix: import APP_VERSION from constants.ts (was hardcoded
// to '0.2.0-phase2', which drifted from cli.tsx's '1.0.0' and
// SplashBox's APP_VERSION).
import { APP_VERSION as VERSION } from '../../../constants.js';

/**
 * About dialog. Shows version + license + homepage + brief description.
 * Press Esc or Enter to dismiss.
 */
export function AboutDialog({ cols, onDismiss: _onDismiss }: Props): React.ReactElement {
  const innerW = Math.min(cols - 4, 60);
  return (
    <Box
      borderStyle="round"
      borderColor={T.teal}
      paddingX={1}
      width={cols}
      flexDirection="column"
    >
      <Box width={innerW} justifyContent="center">
        <Text color={T.teal} bold>About Goli-CLI</Text>
      </Box>
      <Box width={innerW} marginTop={1}>
        <Text>
          <Text color={T.purple} bold>Goli-CLI</Text>
          <Text> v{VERSION}</Text>
        </Text>
      </Box>
      <Box width={innerW}>
        <Text color={T.gray}>Production-grade multi-agent software engineering tool.</Text>
      </Box>
      <Box width={innerW} marginTop={1}>
        <Text>
          <Text color={T.gray}>License: </Text>
          <Text color={T.green}>MIT</Text>
        </Text>
      </Box>
      <Box width={innerW}>
        <Text>
          <Text color={T.gray}>Homepage: </Text>
          <Text color={T.blue}>https://github.com/goli-cli/goli-cli</Text>
        </Text>
      </Box>
      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>11-agent swarm (Scout → Documenter) for complex, autonomous dev tasks.</Text>
      </Box>
      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>Built with TypeScript + Ink (React for terminals).</Text>
      </Box>
      <Box width={innerW} marginTop={1}>
        <Text color={T.gray}>Press </Text>
        <Text color={T.green}>Esc</Text>
        <Text color={T.gray}> or </Text>
        <Text color={T.green}>Enter</Text>
        <Text color={T.gray}> to close</Text>
      </Box>
    </Box>
  );
}

/** Exported version constant (mirrors package.json version). */
export { VERSION as ABOUT_VERSION };
